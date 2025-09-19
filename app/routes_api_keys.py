import os
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import APIKey
from .middleware import get_request_user, json_error_response
from .auth.magic import SessionUser, is_auth_enabled
from .auth.accounts import ensure_demo_user


router = APIRouter(prefix="/api/keys", tags=["api-keys"])


class APIKeyOut(BaseModel):
    key_id: str
    active: bool
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None


class APIKeyCreateOut(BaseModel):
    key_id: str
    secret: str


def _require_user(request: Request, db: Session) -> Optional[SessionUser]:
    user = get_request_user(request)
    if is_auth_enabled():
        return user
    demo = ensure_demo_user(db)
    demo_user: SessionUser = {"user_id": int(demo.id), "email": demo.email, "name": demo.name}
    request.state.user = demo_user
    return demo_user


def _error(request: Request, code: str, status: int = 400):
    return json_error_response(request, code, status_code=status)


@router.get("", response_model=List[APIKeyOut])
def list_keys(request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]
    rows = db.execute(select(APIKey).where(APIKey.user_id == user_id)).scalars().all()
    return [
        APIKeyOut(key_id=row.key_id, active=bool(int(row.active or 0)), created_at=str(row.created_at), last_used_at=str(row.last_used_at) if row.last_used_at else None)
        for row in rows
    ]


@router.post("", response_model=APIKeyCreateOut)
def create_key(request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]

    key_id = secrets.token_hex(8)
    secret = secrets.token_hex(16)

    row = APIKey(user_id=user_id, key_id=key_id, secret_hash=secret, active=1)
    db.add(row)
    db.commit()
    return APIKeyCreateOut(key_id=key_id, secret=secret)


@router.post("/revoke")
def revoke_key(payload: dict, request: Request, db: Session = Depends(get_db)):
    session_user = _require_user(request, db)
    if session_user is None:
        return _error(request, "auth_required", status=401)
    user_id = int(session_user["user_id"])  # type: ignore[index]

    key_id = (payload or {}).get("key_id")
    if not key_id:
        return _error(request, "invalid_key_id", status=422)

    row = db.execute(select(APIKey).where(APIKey.user_id == user_id, APIKey.key_id == key_id)).scalar_one_or_none()
    if row is None:
        return _error(request, "not_found", status=404)
    row.active = 0
    db.add(row)
    db.commit()
    return {"ok": True}


