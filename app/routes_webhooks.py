import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
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


class WebhookOut(BaseModel):
    id: int
    url: str
    event: str
    active: bool


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
    return [WebhookOut(id=r.id, url=r.url, event=r.event, active=bool(int(r.active or 0))) for r in rows]


@router.post("", response_model=WebhookOut)
def create_webhook(payload: WebhookCreate, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]
    secret = secrets.token_hex(16)
    row = Webhook(user_id=user_id, url=str(payload.url), event=payload.event, secret=secret, active=1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return WebhookOut(id=row.id, url=row.url, event=row.event, active=True)


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


