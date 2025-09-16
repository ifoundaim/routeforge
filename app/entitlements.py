"""Demo entitlements store for Free vs Pro flags."""

from __future__ import annotations

import os
import threading
from typing import Dict


_FALLBACK_USER_ID = "guest"


def _env_default() -> bool:
    raw = os.getenv("DEMO_PRO_DEFAULT", "false")
    normalized = (raw or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


_DEFAULT_PRO = _env_default()
_ENTITLEMENTS: Dict[str, bool] = {}
_LOCK = threading.Lock()


def _normalize_user_id(user_id: str | None) -> str:
    if not user_id:
        return _FALLBACK_USER_ID

    cleaned = user_id.strip()
    return cleaned or _FALLBACK_USER_ID


def is_pro(user_id: str | None) -> bool:
    """Return whether the given user currently has Pro access."""
    key = _normalize_user_id(user_id)
    with _LOCK:
        return _ENTITLEMENTS.get(key, _DEFAULT_PRO)


def set_pro(user_id: str | None, value: bool) -> bool:
    """Set the Pro flag for a user. Returns the stored value."""
    key = _normalize_user_id(user_id)
    normalized = bool(value)
    with _LOCK:
        if normalized == _DEFAULT_PRO:
            _ENTITLEMENTS.pop(key, None)
        else:
            _ENTITLEMENTS[key] = normalized
    return normalized


__all__ = ["is_pro", "set_pro"]
