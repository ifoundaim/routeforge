"""Input validation helpers for route creation and redirects."""
import re
from typing import Iterable, Tuple
from urllib.parse import urlparse, urlunparse

_SLUG_ALLOWED_RE = re.compile(r"[^a-z0-9-]+")
_MULTI_DASH_RE = re.compile(r"-{2,}")


def _clean_slug(text: str) -> str:
    lowered = text.lower()
    replaced = _SLUG_ALLOWED_RE.sub("-", lowered)
    collapsed = _MULTI_DASH_RE.sub("-", replaced)
    trimmed = collapsed.strip("-")
    shortened = trimmed[:64]
    return shortened.strip("-")


def slugify(text: str) -> str:
    """Normalize a slug while keeping lowercase letters, numbers, and dashes."""
    if text is None:
        return ""
    return _clean_slug(text)


def _normalize_allowed_schemes(allowed: Iterable[str]) -> Tuple[str, ...]:
    normalized = [scheme.strip().lower() for scheme in allowed if scheme and scheme.strip()]
    if normalized:
        return tuple(dict.fromkeys(normalized))
    return ("https", "http")


def _default_scheme(allowed: Tuple[str, ...]) -> str:
    return allowed[0] if allowed else "https"


def validate_target_url(url: str, allowed: Iterable[str] = ("https", "http")) -> str:
    """Validate and normalize a target URL for redirects.

    Raises ValueError("invalid_url") if the URL is missing or uses a disallowed scheme.
    """

    if url is None:
        raise ValueError("invalid_url")

    value = url.strip()
    if not value:
        raise ValueError("invalid_url")

    allowed_schemes = _normalize_allowed_schemes(allowed)

    try:
        parsed = urlparse(value)
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError("invalid_url") from exc

    scheme = (parsed.scheme or "").lower()

    if scheme and scheme not in allowed_schemes:
        raise ValueError("invalid_url")

    effective_parsed = parsed
    if not scheme:
        # Attempt to treat schemeless URLs as belonging to the first allowed scheme
        default_scheme = _default_scheme(allowed_schemes)
        effective_parsed = urlparse(f"{default_scheme}://{value}")
        scheme = default_scheme

    if scheme not in allowed_schemes:
        raise ValueError("invalid_url")

    netloc = effective_parsed.netloc.strip()
    if not netloc:
        raise ValueError("invalid_url")

    normalized = effective_parsed._replace(
        scheme=scheme,
        netloc=netloc.lower(),
        path=effective_parsed.path or "/",
    )

    return urlunparse(normalized)


__all__ = ["slugify", "validate_target_url"]
