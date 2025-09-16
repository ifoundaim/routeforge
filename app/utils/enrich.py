from __future__ import annotations

from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlencode, urlparse


_UTM_FIELDS = (
    ("utm_source", "source"),
    ("utm_medium", "medium"),
    ("utm_campaign", "campaign"),
    ("utm_term", "term"),
    ("utm_content", "content"),
)


def _blank_utm() -> Dict[str, Optional[str]]:
    return {field: None for _, field in _UTM_FIELDS}


def _extract_host(ref_header: Optional[str]) -> Optional[str]:
    if not ref_header:
        return None

    ref = ref_header.strip()
    if not ref:
        return None

    try:
        parsed = urlparse(ref)
    except ValueError:
        parsed = None

    host: Optional[str] = None
    if parsed:
        host = parsed.hostname or parsed.netloc or None
        if not host and parsed.path and "//" not in parsed.path:
            parts = parsed.path.split("/", 1)
            host = parts[0]
    else:
        host = None

    if not host and "://" not in ref:
        candidate = ref.split("/", 1)[0]
        candidate = candidate.split("?", 1)[0]
        candidate = candidate.split("#", 1)[0]
        host = candidate

    if host:
        host = host.strip().lower() or None
    return host


def _extract_utm_from_query(query: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not query:
        return values
    for key, value in parse_qsl(query, keep_blank_values=False):
        lowered = key.lower()
        for full_key, short_key in _UTM_FIELDS:
            if lowered == full_key:
                values[short_key] = value
                break
    return values


def parse_ref(ref_header: Optional[str], url_query: str) -> Dict[str, Any]:
    """Parse referrer host and UTM parameters from the incoming redirect."""
    host = _extract_host(ref_header)

    utm = _blank_utm()
    for key, value in _extract_utm_from_query(url_query or "").items():
        utm[key] = value

    if ref_header:
        try:
            ref_query = urlparse(ref_header).query
        except ValueError:
            ref_query = ""
        for key, value in _extract_utm_from_query(ref_query).items():
            if not utm.get(key):
                utm[key] = value

    return {"host": host, "utm": utm}


def serialize_ref(host: Optional[str], utm: Dict[str, Optional[str]], fallback: Optional[str] = None) -> Optional[str]:
    """Serialize host + UTM values into a compact ref string."""
    parts = [(full, utm.get(short)) for full, short in _UTM_FIELDS if utm.get(short)]
    query = urlencode([(full, value) for full, value in parts]) if parts else ""

    cleaned_host = host.strip().lower() if host else None

    if cleaned_host and query:
        return f"{cleaned_host}?{query}"
    if cleaned_host:
        return cleaned_host
    if query:
        return f"?{query}"

    if isinstance(fallback, str):
        fallback_clean = fallback.strip()
        return fallback_clean or None

    return fallback


def decode_ref(value: Optional[str]) -> Dict[str, Any]:
    """Decode a stored ref string back into host + UTM values."""
    utm = _blank_utm()
    if not value:
        return {"host": None, "utm": utm}

    raw = value.strip()
    if not raw:
        return {"host": None, "utm": utm}

    host: Optional[str] = None
    query = ""

    if "://" in raw:
        parsed = urlparse(raw)
        host = parsed.hostname or parsed.netloc or None
        query = parsed.query or ""
    elif raw.startswith("?"):
        query = raw[1:]
    elif "?" in raw:
        host_part, query = raw.split("?", 1)
        host = host_part or None
    else:
        host = raw

    host = host.strip().lower() if host else None

    for key, value in _extract_utm_from_query(query).items():
        utm[key] = value

    return {"host": host, "utm": utm}


__all__ = ["parse_ref", "serialize_ref", "decode_ref"]
