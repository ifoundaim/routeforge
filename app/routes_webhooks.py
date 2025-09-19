import secrets
import hmac
import json
from hashlib import sha256
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
import httpx
from pydantic import BaseModel, AnyUrl
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .middleware import get_request_user, json_error_response
from .auth.magic import SessionUser, is_auth_enabled
from .auth.accounts import ensure_demo_user
from .models import Webhook


router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class WebhookCreate(BaseModel):
    url: AnyUrl
    event: str
    secret: Optional[str] = None


class WebhookOut(BaseModel):
    id: int
    url: str
    event: str
    active: bool
    secret: str


def _error(request: Request, code: str, status: int = 400):
    return json_error_response(request, code, status_code=status)


def _require_user(request: Request, db: Session) -> Optional[SessionUser]:
    user = get_request_user(request)
    if is_auth_enabled():
        return user
    demo = ensure_demo_user(db)
    demo_user: SessionUser = {"user_id": int(demo.id), "email": demo.email, "name": demo.name}
    request.state.user = demo_user
    return demo_user


@router.get("", response_model=List[WebhookOut])
def list_webhooks(request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]
    rows = db.execute(select(Webhook).where(Webhook.user_id == user_id)).scalars().all()
    return [
        WebhookOut(
            id=r.id,
            url=r.url,
            event=r.event,
            active=bool(int(r.active or 0)),
            secret=r.secret,
        )
        for r in rows
    ]


@router.post("", response_model=WebhookOut)
def create_webhook(payload: WebhookCreate, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]
    # Allow client-provided secret; otherwise generate one
    secret_value = (payload.secret or "").strip() or secrets.token_hex(16)
    row = Webhook(user_id=user_id, url=str(payload.url), event=payload.event, secret=secret_value, active=1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return WebhookOut(id=row.id, url=row.url, event=row.event, active=True, secret=row.secret)


@router.post("/{webhook_id}/toggle")
def toggle_webhook(webhook_id: int, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]

    row = db.execute(select(Webhook).where(Webhook.user_id == user_id, Webhook.id == webhook_id)).scalar_one_or_none()
    if row is None:
        return _error(request, "not_found", status=404)
    row.active = 0 if int(row.active or 0) == 1 else 1
    db.add(row)
    db.commit()
    return {"ok": True, "active": bool(int(row.active or 0))}



@router.delete("/{webhook_id}")
def delete_webhook(webhook_id: int, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]

    row = db.execute(select(Webhook).where(Webhook.user_id == user_id, Webhook.id == webhook_id)).scalar_one_or_none()
    if row is None:
        return _error(request, "not_found", status=404)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/{webhook_id}/test")
def test_webhook(webhook_id: int, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]

    row = db.execute(select(Webhook).where(Webhook.user_id == user_id, Webhook.id == webhook_id)).scalar_one_or_none()
    if row is None:
        return _error(request, "not_found", status=404)

    # Build a small sample payload based on event
    now = datetime.now(timezone.utc)
    if row.event == "route_hit":
        payload = {"route_id": 123, "slug": "demo", "ts": now.isoformat()}
    elif row.event == "release_published":
        payload = {"release_id": 456, "project_id": 42, "ts": now.isoformat()}
    else:
        payload = {"event": row.event, "ts": now.isoformat()}

    body = json.dumps(payload).encode("utf-8")
    signature = hmac.new(row.secret.encode("utf-8"), body, sha256).hexdigest()

    headers = {
        "content-type": "application/json",
        "X-RF-Webhook-Event": row.event,
        "X-RF-Webhook-Sign": signature,
    }

    status_code = 0
    ok = False
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            resp = client.post(row.url, content=body, headers=headers)
            status_code = int(resp.status_code)
            ok = 200 <= status_code < 300
    except Exception:
        status_code = 0
        ok = False

    # Return result, including a truncated preview of the payload
    preview = json.dumps(payload)
    if len(preview) > 240:
        preview = preview[:240] + "…"

    return {
        "ok": ok,
        "status": status_code,
        "ts": now.isoformat(),
        "payload_preview": preview,
    }

