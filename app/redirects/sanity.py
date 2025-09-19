import os
from typing import Iterable, Optional, Sequence, Tuple

import httpx

from ..utils.validators import _normalize_allowed_schemes


def get_allowed_schemes() -> Tuple[str, ...]:
    raw = os.getenv("ALLOWED_TARGET_SCHEMES", "https,http") or "https,http"
    candidates = [item.strip() for item in raw.split(",") if item.strip()]
    normalized = _normalize_allowed_schemes(candidates or ("https", "http"))
    return normalized or ("https", "http")


def get_blocked_domains() -> Tuple[str, ...]:
    raw = os.getenv("BLOCKED_TARGET_DOMAINS", "")
    items = [part.strip().lower() for part in raw.split(",") if part.strip()]
    return tuple(dict.fromkeys(items))


async def head_ok(url: str, *, timeout: float = 5.0) -> bool:
    """Perform a HEAD request to validate that the target is reachable.

    Returns True for any 2xx or 3xx response, False otherwise.
    """

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            resp = await client.head(url)
            return 200 <= resp.status_code < 400
    except Exception:
        return False


def scheme_allowed(scheme: str, allowed: Optional[Iterable[str]] = None) -> bool:
    allowed_set = set(_normalize_allowed_schemes(allowed or get_allowed_schemes()))
    return (scheme or "").lower() in allowed_set


def domain_allowed(host: str, blocked: Optional[Sequence[str]] = None) -> bool:
    domain = (host or "").lower()
    if not domain:
        return False
    blocked_items = tuple(blocked or get_blocked_domains())
    if not blocked_items:
        return True
    # Exact or suffix match ("bad.com" blocks "api.bad.com")
    for item in blocked_items:
        if domain == item or domain.endswith("." + item):
            return False
    return True


__all__ = ["get_allowed_schemes", "get_blocked_domains", "head_ok", "scheme_allowed", "domain_allowed"]


