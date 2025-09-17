"""Magic-link manager and session cookie helpers."""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional, Set, TypedDict, cast
from urllib.parse import urlparse

from fastapi import Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from starlette.responses import Response
from starlette.types import ASGIApp


logger = logging.getLogger("routeforge.auth")

SESSION_COOKIE_NAME = "routeforge_session"
SESSION_MAX_AGE = 60 * 60 * 12  # 12 hours
TOKEN_TTL_SECONDS = 60 * 10  # magic links valid for 10 minutes
MAGIC_SERIALIZER_SALT = "routeforge.magiclink.v2"
SESSION_SERIALIZER_SALT = "routeforge.session.v1"


class SessionUser(TypedDict, total=False):
    user_id: int
    email: str
    name: Optional[str]


class MagicLinkError(Exception):
    """Base exception for magic link failures."""


class ExpiredMagicLink(MagicLinkError):
    """Raised when a link has expired."""


class InvalidMagicLink(MagicLinkError):
    """Raised when a token fails signature validation."""


class UsedMagicLink(MagicLinkError):
    """Raised when a token has already been redeemed."""


def is_auth_enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "0") == "1"


def is_email_enabled() -> bool:
    return os.getenv("EMAIL_ENABLED", "0") == "1"


def _session_secret() -> str:
    secret = os.getenv("SESSION_SECRET")
    if not secret:
        raise RuntimeError("SESSION_SECRET must be set when auth is enabled")
    return secret


def _app_base_url() -> str:
    base = os.getenv("APP_BASE_URL")
    if not base:
        raise RuntimeError("APP_BASE_URL must be set when auth is enabled")
    cleaned = base.rstrip("/")
    if not cleaned:
        raise RuntimeError("APP_BASE_URL is invalid")
    return cleaned


def _looks_like_localhost(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return True

    host = (parsed.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return True
    if host.endswith(".local"):
        return True
    return False


class MagicAuthManager:
    """Manage magic-link tokens and session cookies."""

    def __init__(self, secret_key: str, app_base_url: str) -> None:
        self._link_serializer = URLSafeTimedSerializer(secret_key=secret_key, salt=MAGIC_SERIALIZER_SALT)
        self._session_serializer = URLSafeTimedSerializer(secret_key=secret_key, salt=SESSION_SERIALIZER_SALT)
        self._token_ttl = TOKEN_TTL_SECONDS
        self._session_max_age = SESSION_MAX_AGE
        self._issued: Set[str] = set()
        self._lock = threading.Lock()
        self._base_url = app_base_url
        self._secure_cookie = not _looks_like_localhost(app_base_url)

    @property
    def secure_cookie(self) -> bool:
        return self._secure_cookie

    def issue_link(self, email: str) -> str:
        normalized = (email or "").strip().lower()
        if not normalized:
            raise ValueError("email is required")

        token = self._link_serializer.dumps({"email": normalized})
        with self._lock:
            self._issued.add(token)

        return f"{self._base_url}/auth/callback?token={token}"

    def consume(self, token: str) -> str:
        if not token:
            raise InvalidMagicLink

        try:
            data = self._link_serializer.loads(token, max_age=self._token_ttl)
        except SignatureExpired as exc:  # pragma: no cover - simple control flow
            raise ExpiredMagicLink from exc
        except BadSignature as exc:  # pragma: no cover - simple control flow
            raise InvalidMagicLink from exc

        with self._lock:
            if token not in self._issued:
                raise UsedMagicLink
            self._issued.remove(token)

        email = data.get("email") if isinstance(data, dict) else None
        normalized = (email or "").strip().lower()
        if not normalized:
            raise InvalidMagicLink

        return normalized

    def encode_session(self, user: SessionUser) -> str:
        user_id_raw = user.get("user_id")
        if user_id_raw is None:
            raise ValueError("user_id is required for the session cookie")
        try:
            user_id = int(user_id_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("user_id must be an integer") from exc

        email = (user.get("email") or "").strip().lower()
        if not email:
            raise ValueError("email is required for the session cookie")

        payload = {"user_id": user_id, "email": email}
        name = user.get("name")
        if isinstance(name, str) and name.strip():
            payload["name"] = name.strip()

        return self._session_serializer.dumps(payload)

    def decode_session(self, raw: str) -> Optional[SessionUser]:
        if not raw:
            return None
        try:
            data = self._session_serializer.loads(raw, max_age=self._session_max_age)
        except (BadSignature, SignatureExpired):  # pragma: no cover - defensive path
            logger.info("Rejected invalid session cookie")
            return None

        if not isinstance(data, dict):
            return None

        user_id = data.get("user_id")
        email = data.get("email")
        try:
            user_id_int = int(user_id)
        except (TypeError, ValueError):
            return None

        if not isinstance(email, str) or not email:
            return None

        name_val = data.get("name")
        name = name_val if isinstance(name_val, str) and name_val.strip() else None
        return cast(SessionUser, {"user_id": user_id_int, "email": email.strip().lower(), "name": name})

    def set_cookie(self, response: Response, user: SessionUser) -> None:
        value = self.encode_session(user)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=value,
            max_age=self._session_max_age,
            expires=self._session_max_age,
            httponly=True,
            secure=self._secure_cookie,
            samesite="lax",
            path="/",
        )

    def clear_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/",
            httponly=True,
            samesite="lax",
            secure=self._secure_cookie,
        )

    def read_cookie(self, request: Request) -> Optional[SessionUser]:
        raw = request.cookies.get(SESSION_COOKIE_NAME)
        if not raw:
            return None
        return self.decode_session(raw)


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
    base_url = _app_base_url()
    manager = MagicAuthManager(secret_key=secret, app_base_url=base_url)
    setattr(state, "magic_auth", manager)
    logger.info(
        "Magic auth enabled; session cookie '%s' secure=%s", SESSION_COOKIE_NAME, manager.secure_cookie
    )
    return manager


def get_magic_manager(request: Request) -> Optional[MagicAuthManager]:
    manager = getattr(request.app.state, "magic_auth", None)
    if isinstance(manager, MagicAuthManager):
        return manager
    return ensure_magic(request.app)


def request_link(request: Request, email: str) -> str:
    manager = ensure_magic(request.app)
    if manager is None:
        raise RuntimeError("Auth system is disabled")
    return manager.issue_link(email)


def verify_token(request: Request, token: str) -> str:
    manager = get_magic_manager(request)
    if manager is None:
        raise RuntimeError("Auth system is disabled")
    return manager.consume(token)


def set_cookie(response: Response, request: Request, user: SessionUser) -> None:
    manager = ensure_magic(request.app)
    if manager is None:
        raise RuntimeError("Auth system is disabled")
    manager.set_cookie(response, user)


def clear_cookie(response: Response, request: Request) -> None:
    manager = get_magic_manager(request)
    if manager is None:
        return
    manager.clear_cookie(response)


def get_session_user(request: Request) -> Optional[SessionUser]:
    manager = get_magic_manager(request)
    if manager is None:
        return None
    return manager.read_cookie(request)
