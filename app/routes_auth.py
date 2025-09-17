"""Authentication routes for magic-link flows and session inspection."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from starlette.responses import Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .auth.accounts import get_or_create_user_by_email
from .auth.magic import (
    ExpiredMagicLink,
    InvalidMagicLink,
    UsedMagicLink,
    clear_cookie,
    get_session_user,
    is_auth_enabled,
    is_email_enabled,
    request_link as issue_magic_link,
    set_cookie,
    verify_token,
)
from .db import get_db
from .middleware import json_error_response


logger = logging.getLogger("routeforge.auth.routes")

router = APIRouter(prefix="/auth", tags=["auth"])


class RequestLinkPayload(BaseModel):
    email: EmailStr


class MeResponse(BaseModel):
    email: EmailStr
    name: str | None = None


def _require_auth_enabled() -> None:
    if not is_auth_enabled():
        raise HTTPException(status_code=404, detail="not_found")


@router.post("/request-link")
def request_magic_link(payload: RequestLinkPayload, request: Request) -> JSONResponse:
    _require_auth_enabled()

    try:
        link = issue_magic_link(request, payload.email)
    except ValueError as exc:
        return json_error_response(request, "invalid_email", status_code=422, detail=str(exc))

    if is_email_enabled():
        logger.info("Magic login link for %s: %s", payload.email.lower(), link)
        return JSONResponse(status_code=202, content={"detail": "link_sent"})
    else:
        logger.info(
            "EMAIL_ENABLED=0; magic login link (not sent) for %s: %s",
            payload.email.lower(),
            link,
        )
        # In dev mode, return the link so the SPA can auto-redirect
        return JSONResponse(status_code=202, content={"detail": "link_sent", "dev_link": link})


@router.get("/callback")
def auth_callback(token: str, request: Request, db: Session = Depends(get_db)):
    _require_auth_enabled()

    try:
        email = verify_token(request, token)
    except ExpiredMagicLink:
        return json_error_response(request, "expired_token", status_code=400, detail="Magic link expired.")
    except UsedMagicLink:
        return json_error_response(request, "token_already_used", status_code=400, detail="Token already used.")
    except InvalidMagicLink:
        return json_error_response(request, "invalid_token", status_code=400, detail="Invalid magic link token.")

    user = get_or_create_user_by_email(db, email=email)

    response = RedirectResponse(url="/app", status_code=302)
    set_cookie(response, request, {"user_id": user.id, "email": user.email, "name": user.name})
    logger.info("User login success id=%s email=%s", user.id, user.email)
    return response


@router.get("/me", response_model=MeResponse)
def read_me(request: Request):
    _require_auth_enabled()

    user = get_session_user(request)
    if user is None:
        return json_error_response(request, "auth_required", status_code=401, detail="Authentication required.")

    return {"email": user.get("email"), "name": user.get("name")}


@router.post("/logout", status_code=204)
def logout(request: Request):
    _require_auth_enabled()

    response = Response(status_code=204)
    clear_cookie(response, request)
    return response


@router.get("/dev-login")
def dev_login(request: Request, email: EmailStr) -> PlainTextResponse:
    _require_auth_enabled()

    try:
        link = issue_magic_link(request, email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Dev magic login URL for %s: %s", email.lower(), link)
    return PlainTextResponse("Magic link generated; check server logs.")
