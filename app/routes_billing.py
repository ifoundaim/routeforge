"""Demo billing routes to toggle in-memory entitlements."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .auth.magic import get_session_user, is_auth_enabled
from .entitlements import is_pro, set_pro


logger = logging.getLogger("routeforge.billing")

router = APIRouter(tags=["billing"])


class UpgradePayload(BaseModel):
    pro: bool


def _resolve_user_id(request: Request) -> Optional[str]:
    if not is_auth_enabled():
        return None

    session_user = get_session_user(request)
    if session_user is None:
        return None

    user_id = session_user.get("user_id")
    if isinstance(user_id, int):
        return str(user_id)
    if isinstance(user_id, str) and user_id.strip():
        return user_id

    email = session_user.get("email")
    if isinstance(email, str) and email.strip():
        return email

    return None


@router.get("/api/entitlements")
def get_entitlements(request: Request):
    """Return the current entitlement flags for the active demo user."""
    user_id = _resolve_user_id(request)
    value = is_pro(user_id)
    return {"pro": value}


@router.post("/dev/upgrade")
def upgrade_entitlement(payload: UpgradePayload, request: Request):
    """Toggle the Pro entitlement for the active demo user.

    When magic-link auth is enabled we require a logged-in demo user, otherwise any
    caller can flip the flag (useful for local demos).
    """
    if is_auth_enabled():
        session_user = get_session_user(request)
        if session_user is None:
            raise HTTPException(status_code=401, detail="auth_required")

    user_id = _resolve_user_id(request)
    value = set_pro(user_id, payload.pro)
    logger.info("Entitlement updated for %s -> pro=%s", user_id or "guest", value)
    return {"pro": value}
