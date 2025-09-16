import hashlib
import logging
import os
import threading
from typing import Optional, Set, TypedDict, cast

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp


logger = logging.getLogger("routeforge.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE_NAME = "routeforge_session"
SESSION_MAX_AGE = 60 * 60 * 12  # 12 hours for demo
TOKEN_TTL_SECONDS = 60 * 5  # magic links valid for 5 minutes
SERIALIZER_SALT = "routeforge.magiclink.v1"


class SessionUser(TypedDict):
    email: str
    user_id: str


class MagicLinkError(Exception):
    """Base exception for magic link failures."""


class ExpiredMagicLink(MagicLinkError):
    """Raised when a link has expired."""


class InvalidMagicLink(MagicLinkError):
    """Raised when a token fails signature validation."""


class UsedMagicLink(MagicLinkError):
    """Raised when a token has already been redeemed."""


class MagicAuthManager:
    """Simple in-memory manager for issuing and consuming magic links."""

    def __init__(self, secret_key: str, token_ttl: int = TOKEN_TTL_SECONDS) -> None:
        self._serializer = URLSafeTimedSerializer(secret_key=secret_key, salt=SERIALIZER_SALT)
        self._token_ttl = token_ttl
        self._issued: Set[str] = set()
        self._lock = threading.Lock()

    def issue_link(self, request: Request, email: str) -> str:
        normalized = email.strip().lower()
        if not normalized:
            raise ValueError("email is required")

        token = self._serializer.dumps({"email": normalized})
        with self._lock:
            self._issued.add(token)

        base = str(request.url_for("magic_auth_callback"))
        return f"{base}?token={token}"

    def consume(self, token: str) -> SessionUser:
        try:
            data = self._serializer.loads(token, max_age=self._token_ttl)
        except SignatureExpired as exc:  # pragma: no cover - simple control flow
            raise ExpiredMagicLink from exc
        except BadSignature as exc:  # pragma: no cover - simple control flow
            raise InvalidMagicLink from exc

        with self._lock:
            if token not in self._issued:
                raise UsedMagicLink
            self._issued.remove(token)

        email = data.get("email")
        if not isinstance(email, str) or not email:
            raise InvalidMagicLink

        normalized = email.strip().lower()
        user_id = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        return {"email": normalized, "user_id": user_id}


def is_auth_enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "0") == "1"


def _session_secret() -> str:
    explicit = os.getenv("AUTH_SESSION_SECRET")
    if explicit:
        return explicit

    # Fall back to any existing secret and finally a hard-coded dev value.
    return os.getenv("SESSION_SECRET") or os.getenv("SECRET_KEY") or "routeforge-dev-secret"


def ensure_magic(app: ASGIApp) -> Optional[MagicAuthManager]:
    if not is_auth_enabled():
        return None

    state = getattr(app, "state", None)
    if state is None:
        return None

    existing = getattr(state, "magic_auth", None)
    if isinstance(existing, MagicAuthManager):
        return existing

    secret = _session_secret()
    manager = MagicAuthManager(secret)

    if hasattr(app, "add_middleware"):
        app.add_middleware(
            SessionMiddleware,
            secret_key=secret,
            session_cookie=SESSION_COOKIE_NAME,
            max_age=SESSION_MAX_AGE,
            same_site="lax",
            https_only=False,
        )

    state.magic_auth = manager
    logger.info("Magic auth enabled; session cookie '%s' active", SESSION_COOKIE_NAME)
    return manager


def get_magic_manager(request: Request) -> Optional[MagicAuthManager]:
    manager = getattr(request.app.state, "magic_auth", None)
    if isinstance(manager, MagicAuthManager):
        return manager
    return None


def set_session_user(request: Request, user: SessionUser) -> None:
    try:
        session = request.session
    except RuntimeError:  # pragma: no cover - SessionMiddleware guarantees availability when enabled
        raise HTTPException(status_code=500, detail="session_unavailable")

    session["user"] = dict(user)


def get_session_user(request: Request) -> Optional[SessionUser]:
    try:
        raw_session = request.session
    except RuntimeError:
        return None

    raw = raw_session.get("user")
    if not isinstance(raw, dict):
        return None

    email = raw.get("email")
    user_id = raw.get("user_id")
    if not isinstance(email, str) or not isinstance(user_id, str):
        return None

    # SessionMiddleware returns mutable dict, but we only expose typed view.
    return cast(SessionUser, {"email": email, "user_id": user_id})


@router.get("/dev-login")
def dev_login(request: Request, email: str) -> PlainTextResponse:
    manager = get_magic_manager(request)
    if manager is None:
        raise HTTPException(status_code=404, detail="not_found")

    try:
        magic_url = manager.issue_link(request, email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Dev magic login URL for %s: %s", email.strip().lower(), magic_url)
    return PlainTextResponse("Magic link generated; check server logs.")


@router.get("/magic", name="magic_auth_callback")
def magic_callback(request: Request, token: str) -> JSONResponse:
    manager = get_magic_manager(request)
    if manager is None:
        raise HTTPException(status_code=404, detail="not_found")

    try:
        user = manager.consume(token)
    except ExpiredMagicLink:
        raise HTTPException(status_code=400, detail="expired_token")
    except UsedMagicLink:
        raise HTTPException(status_code=400, detail="token_already_used")
    except InvalidMagicLink:
        raise HTTPException(status_code=400, detail="invalid_token")

    set_session_user(request, user)
    return JSONResponse({"detail": "login_ok"})
