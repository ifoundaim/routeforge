import logging
import os
import time
from dataclasses import dataclass
from typing import Optional, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db, try_get_session
from . import models
from .errors import json_error


logger = logging.getLogger("routeforge.redirect")

router = APIRouter(tags=["redirects"])


def error(code: str, status_code: int = 400, detail: Optional[str] = None):
    return json_error(code, status_code=status_code, detail=detail)


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


def _normalize_target_url(value: str) -> Optional[str]:
    try:
        from urllib.parse import urlparse, urlunparse

        parsed = urlparse(value)
        scheme = (parsed.scheme or "").lower()
        if scheme in ("javascript", "data"):
            return None
        if not scheme:
            # Treat schemeless as http
            parsed = parsed._replace(scheme="http")
        # Normalize netloc casing and path
        netloc = parsed.netloc.lower()
        normalized = urlunparse((parsed.scheme.lower(), netloc, parsed.path or "/", parsed.params, parsed.query, parsed.fragment))
        return normalized
    except Exception:
        return None


@router.get("/r/{slug}")
def redirect_slug(slug: str, request: Request, db: Optional[Session] = Depends(try_get_session)):
    # Rate limiting per IP (best effort, in-memory) — applied before DB work
    ip = extract_client_ip(request)
    ip_key = ip or "unknown"
    bucket = _get_bucket_for_ip(ip_key)
    if not bucket.try_consume(1.0):
        return error("rate_limited", status_code=429, detail="Too many requests from this IP")

    if db is None:
        # No DB configured: behave as not found to avoid leaking internal state
        return error("not_found", status_code=404)

    route = db.execute(select(models.Route).where(models.Route.slug == slug)).scalar_one_or_none()
    if route is None:
        return error("not_found", status_code=404)

    ua = request.headers.get("user-agent")
    # Use historical "referer" header, with fallback to common misspelling "referrer"
    ref = request.headers.get("referer") or request.headers.get("referrer")

    hit = models.RouteHit(route_id=route.id, ip=ip, ua=ua, ref=ref)
    db.add(hit)
    db.commit()

    normalized = _normalize_target_url(route.target_url)
    if not normalized:
        logger.warning("Unsafe or invalid target_url for slug=%s route_id=%s", slug, route.id)
        return error("invalid_target_url", status_code=400)

    logger.info("Redirect slug=%s route_id=%s ip=%s", slug, route.id, ip)
    return RedirectResponse(url=normalized, status_code=302)


