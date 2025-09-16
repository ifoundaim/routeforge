import logging
import os
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import try_get_session
from . import models
from .errors import json_error
from .utils.enrich import parse_ref, serialize_ref
from .utils.validators import validate_target_url


logger = logging.getLogger("routeforge.redirect")

router = APIRouter(tags=["redirects"])


def _with_request_id(response: JSONResponse, request: Request) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


def error(request: Request, code: str, status_code: int = 400, detail: Optional[str] = None) -> JSONResponse:
    response = json_error(code, status_code=status_code, detail=detail)
    return _with_request_id(response, request)


def _get_allowed_target_schemes() -> Tuple[str, ...]:
    raw = os.getenv("ALLOWED_TARGET_SCHEMES", "https,http") or "https,http"
    cleaned = tuple(dict.fromkeys([item.strip().lower() for item in raw.split(",") if item.strip()]))
    return cleaned or ("https", "http")


def extract_client_ip(request: Request) -> Optional[str]:
    # X-Forwarded-For may contain a chain; take the first non-empty token
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[0]
    client_host = request.client.host if request.client else None
    return client_host


@dataclass
class TokenBucket:
    capacity: int
    refill_seconds: int
    tokens: float
    last_refill: float

    def try_consume(self, amount: float = 1.0) -> bool:
        now = time.monotonic()
        elapsed = now - self.last_refill
        # Refill proportionally to elapsed time
        if self.refill_seconds > 0 and elapsed > 0:
            refill = (self.capacity / float(self.refill_seconds)) * elapsed
            self.tokens = min(self.capacity, self.tokens + refill)
            self.last_refill = now
        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False


_ip_buckets: Dict[str, TokenBucket] = {}


def _get_bucket_for_ip(ip: str) -> TokenBucket:
    capacity = int(os.getenv("RATE_LIMIT_BURST", "10") or "10")
    window = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "10") or "10")
    bucket = _ip_buckets.get(ip)
    if bucket is None:
        bucket = TokenBucket(capacity=capacity, refill_seconds=window, tokens=float(capacity), last_refill=time.monotonic())
        _ip_buckets[ip] = bucket
    else:
        # Update capacity/window dynamically if envs changed during runtime
        bucket.capacity = capacity
        bucket.refill_seconds = window
    return bucket


@router.api_route("/r/{slug}", methods=["GET", "HEAD"])
def redirect_slug(slug: str, request: Request, db: Optional[Session] = Depends(try_get_session)):
    # Rate limiting per IP (best effort, in-memory) — applied before DB work
    ip = extract_client_ip(request)
    ip_key = ip or "unknown"
    bucket = _get_bucket_for_ip(ip_key)
    if not bucket.try_consume(1.0):
        return error(request, "rate_limited", status_code=429, detail="Too many requests from this IP")

    if db is None:
        # No DB configured: behave as not found to avoid leaking internal state
        return error(request, "not_found", status_code=404)

    route = db.execute(select(models.Route).where(models.Route.slug == slug)).scalar_one_or_none()
    if route is None:
        return error(request, "not_found", status_code=404)

    ua = request.headers.get("user-agent")
    # Use historical "referer" header, with fallback to common misspelling "referrer"
    ref_header = request.headers.get("referer") or request.headers.get("referrer")
    enriched_ref = parse_ref(ref_header, request.url.query)
    serialized_ref = serialize_ref(enriched_ref.get("host"), enriched_ref.get("utm") or {}, fallback=ref_header)

    hit = models.RouteHit(route_id=route.id, ip=ip, ua=ua, ref=serialized_ref)
    db.add(hit)
    db.commit()

    allowed_schemes = _get_allowed_target_schemes()
    try:
        normalized = validate_target_url(route.target_url, allowed=allowed_schemes)
    except ValueError:
        logger.warning("Unsafe or invalid target_url for slug=%s route_id=%s", slug, route.id)
        detail = f"Target URL scheme must be one of: {', '.join(allowed_schemes)}"
        return error(request, "invalid_url", status_code=422, detail=detail)

    logger.info("Redirect slug=%s route_id=%s ip=%s", slug, route.id, ip)
    return RedirectResponse(url=normalized, status_code=302)
