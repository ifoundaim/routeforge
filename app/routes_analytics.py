import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, func, desc
from sqlalchemy.orm import Session

from .db import get_db, now_utc
from .errors import json_error
from . import models
from .utils.enrich import decode_ref
from .middleware import get_request_user
from .auth.magic import is_auth_enabled
from .auth.accounts import ensure_demo_user


logger = logging.getLogger("routeforge.analytics")

router = APIRouter(prefix="/api", tags=["analytics"]) 


def error(code: str, status_code: int = 400):
    return json_error(code, status_code=status_code)


def _normalize_days(days: int) -> int:
    try:
        d = int(days)
    except Exception:
        d = 7
    if d < 1:
        d = 1
    if d > 365:
        d = 365
    return d


def _coerce_ref(value: Optional[Any]) -> Optional[str]:
    if value is None:
        return None

    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", "ignore")
        except Exception:  # pragma: no cover - extremely defensive
            value = value.decode("utf-8", errors="ignore")

    text = str(value).strip()
    return text or None


def _require_user(request: Request, db: Session):
    user = get_request_user(request)
    if is_auth_enabled():
        return user

    demo = ensure_demo_user(db)
    demo_user = {"user_id": int(demo.id), "email": demo.email, "name": demo.name}
    request.state.user = demo_user
    return demo_user


@router.get("/stats/summary")
def get_stats_summary(request: Request, days: int = 7, db: Session = Depends(get_db)) -> Dict[str, Any]:
    user = _require_user(request, db)
    if is_auth_enabled() and user is None:
        return error("auth_required", status_code=401)

    window_days = _normalize_days(days)
    since = now_utc() - timedelta(days=window_days)
    user_id = int(user.get("user_id")) if user else None

    total_clicks = db.scalar(
        select(func.count(models.RouteHit.id))
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since, models.Route.user_id == user_id)
    ) or 0

    unique_routes = db.scalar(
        select(func.count(func.distinct(models.RouteHit.route_id)))
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since, models.Route.user_id == user_id)
    ) or 0

    top_rows = db.execute(
        select(
            models.RouteHit.route_id.label("route_id"),
            models.Route.slug.label("slug"),
            models.Route.release_id.label("release_id"),
            func.count(models.RouteHit.id).label("clicks"),
        )
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since, models.Route.user_id == user_id)
        .group_by(models.RouteHit.route_id, models.Route.slug, models.Route.release_id)
        .order_by(desc("clicks"))
        .limit(10)
    ).all()

    top_routes: List[Dict[str, Any]] = [
        {
            "route_id": int(r.route_id),
            "slug": r.slug,
            "clicks": int(r.clicks),
            "release_id": int(r.release_id) if getattr(r, "release_id", None) is not None else None,
        }
        for r in top_rows
    ]

    return {
        "total_clicks": int(total_clicks),
        "unique_routes": int(unique_routes),
        "top_routes": top_routes,
    }


@router.get("/stats/series")
def get_stats_series(request: Request, days: int = 7, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Return 7-day series for overall clicks and active routes, plus UTM source counts.

    - by_day_clicks: total clicks per day over the window
    - by_day_active_routes: number of distinct routes with clicks per day
    - utm_sources: simplified counts for twitter/newsletter/reddit/other
    """
    user = _require_user(request, db)
    if is_auth_enabled() and user is None:
        return error("auth_required", status_code=401)

    window_days = _normalize_days(days)
    since = now_utc() - timedelta(days=window_days)
    user_id = int(user.get("user_id")) if user else None

    # Total clicks per day
    clicks_rows = db.execute(
        select(
            func.date(models.RouteHit.ts).label("date"),
            func.count(models.RouteHit.id).label("count"),
        )
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since, models.Route.user_id == user_id)
        .group_by(func.date(models.RouteHit.ts))
        .order_by(func.date(models.RouteHit.ts).asc())
    ).all()

    by_day_clicks: List[Dict[str, Any]] = [
        {"date": str(r.date), "count": int(r.count or 0)} for r in clicks_rows
    ]

    # Distinct active routes per day
    active_rows = db.execute(
        select(
            func.date(models.RouteHit.ts).label("date"),
            func.count(func.distinct(models.RouteHit.route_id)).label("count"),
        )
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since, models.Route.user_id == user_id)
        .group_by(func.date(models.RouteHit.ts))
        .order_by(func.date(models.RouteHit.ts).asc())
    ).all()

    by_day_active_routes: List[Dict[str, Any]] = [
        {"date": str(r.date), "count": int(r.count or 0)} for r in active_rows
    ]

    # Aggregate UTM sources across all hits for the user in the window
    ref_rows = db.execute(
        select(
            models.RouteHit.ref.label("ref"),
            func.count(models.RouteHit.id).label("count"),
        )
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(
            models.RouteHit.ts >= since,
            models.Route.user_id == user_id,
            models.RouteHit.ref.isnot(None),
            models.RouteHit.ref != "",
        )
        .group_by(models.RouteHit.ref)
        .order_by(desc("count"))
        .limit(1000)
    ).all()

    raw_utm_counts: Dict[str, int] = {}
    for r in ref_rows:
        cleaned_ref = _coerce_ref(getattr(r, "ref", None))
        if not cleaned_ref:
            continue
        try:
            decoded = decode_ref(cleaned_ref)
        except Exception:  # pragma: no cover - defensive
            logger.debug("Unable to decode ref value: %s", cleaned_ref, exc_info=True)
            continue

        utm_payload = decoded.get("utm") if isinstance(decoded, dict) else None
        utm_source = utm_payload.get("source") if isinstance(utm_payload, dict) else None
        if utm_source:
            key = str(utm_source).strip().lower()
            if not key:
                continue
            raw_utm_counts[key] = raw_utm_counts.get(key, 0) + int(getattr(r, "count", 0) or 0)

    # Normalize into the requested four chips
    chip_sources = ["twitter", "newsletter", "reddit"]
    normalized: Dict[str, int] = {key: 0 for key in chip_sources}
    other_total = 0
    for source, count in raw_utm_counts.items():
        if source in normalized:
            normalized[source] += int(count or 0)
        else:
            other_total += int(count or 0)

    utm_sources: List[Dict[str, Any]] = [
        {"source": key, "count": int(normalized.get(key, 0))} for key in chip_sources
    ]
    utm_sources.append({"source": "other", "count": int(other_total)})

    return {
        "by_day_clicks": by_day_clicks,
        "by_day_active_routes": by_day_active_routes,
        "utm_sources": utm_sources,
    }


@router.get("/routes/{route_id}/stats")
def get_route_stats(route_id: int, request: Request, days: int = 7, db: Session = Depends(get_db)) -> Dict[str, Any]:
    user = _require_user(request, db)
    if is_auth_enabled() and user is None:
        return error("auth_required", status_code=401)

    exists = db.get(models.Route, route_id)
    if exists is None:
        return error("not_found", status_code=404)

    if user is not None and exists.user_id != int(user.get("user_id")):
        return error("not_found", status_code=404)

    window_days = _normalize_days(days)
    since = now_utc() - timedelta(days=window_days)

    clicks = db.scalar(
        select(func.count(models.RouteHit.id)).where(
            models.RouteHit.route_id == route_id, models.RouteHit.ts >= since
        )
    ) or 0

    by_day_rows = db.execute(
        select(
            func.date(models.RouteHit.ts).label("date"),
            func.count(models.RouteHit.id).label("count"),
        )
        .where(models.RouteHit.route_id == route_id, models.RouteHit.ts >= since)
        .group_by(func.date(models.RouteHit.ts))
        .order_by(func.date(models.RouteHit.ts).asc())
    ).all()

    by_day: List[Dict[str, Any]] = [
        {"date": str(r.date), "count": int(r.count)} for r in by_day_rows
    ]

    ref_rows = db.execute(
        select(
            models.RouteHit.ref.label("ref"),
            func.count(models.RouteHit.id).label("count"),
        )
        .where(
            models.RouteHit.route_id == route_id,
            models.RouteHit.ts >= since,
            models.RouteHit.ref.isnot(None),
            models.RouteHit.ref != "",
        )
        .group_by(models.RouteHit.ref)
        .order_by(desc("count"))
        .limit(20)
    ).all()

    referrers: List[Dict[str, Any]] = []
    utm_counts: Dict[str, int] = {}

    for r in ref_rows:
        cleaned_ref = _coerce_ref(getattr(r, "ref", None))
        referrers.append({"ref": cleaned_ref or "", "count": int(r.count or 0)})
        if not cleaned_ref:
            continue

        try:
            decoded = decode_ref(cleaned_ref)
        except Exception:  # pragma: no cover - defensive guard
            logger.debug("Unable to decode ref value: %s", cleaned_ref, exc_info=True)
            continue

        utm_payload = decoded.get("utm") if isinstance(decoded, dict) else None
        utm_source = utm_payload.get("source") if isinstance(utm_payload, dict) else None
        if utm_source:
            utm_counts[utm_source] = utm_counts.get(utm_source, 0) + int(r.count or 0)

    utm_top_sources = [
        {"source": source, "count": count}
        for source, count in sorted(utm_counts.items(), key=lambda item: item[1], reverse=True)[:10]
    ]

    ua_rows = db.execute(
        select(
            models.RouteHit.ua.label("ua"),
            func.count(models.RouteHit.id).label("count"),
        )
        .where(
            models.RouteHit.route_id == route_id,
            models.RouteHit.ts >= since,
            models.RouteHit.ua.isnot(None),
            models.RouteHit.ua != "",
        )
        .group_by(models.RouteHit.ua)
        .order_by(desc("count"))
        .limit(20)
    ).all()

    user_agents: List[Dict[str, Any]] = [
        {"ua": r.ua, "count": int(r.count)} for r in ua_rows
    ]

    return {
        "clicks": int(clicks),
        "by_day": by_day,
        "referrers": referrers,
        "utm_top_sources": utm_top_sources,
        "user_agents": user_agents,
    }



@router.get("/routes/{route_id}/hits/recent")
def get_route_recent_hits(route_id: int, request: Request, limit: int = 20, db: Session = Depends(get_db)):
    """Return the most recent N hits for a given route.

    The result is ordered by timestamp descending and includes minimal fields for UI display.
    """
    user = _require_user(request, db)
    if is_auth_enabled() and user is None:
        return error("auth_required", status_code=401)

    exists = db.get(models.Route, route_id)
    if exists is None:
        return error("not_found", status_code=404)

    if user is not None and exists.user_id != int(user.get("user_id")):
        return error("not_found", status_code=404)

    # Normalize and clamp limit
    try:
        n = int(limit)
    except Exception:
        n = 20
    if n < 1:
        n = 1
    if n > 100:
        n = 100

    rows = db.execute(
        select(
            models.RouteHit.id.label("id"),
            models.RouteHit.ts.label("ts"),
            models.RouteHit.ip.label("ip"),
            models.RouteHit.ua.label("ua"),
            models.RouteHit.ref.label("ref"),
        )
        .where(models.RouteHit.route_id == route_id)
        .order_by(models.RouteHit.ts.desc())
        .limit(n)
    ).all()

    hits = [
        {
            "id": int(r.id),
            "ts": r.ts.isoformat() if hasattr(r.ts, "isoformat") else str(r.ts),
            "ip": r.ip,
            "ua": r.ua,
            "ref": r.ref,
        }
        for r in rows
    ]

    return {"hits": hits}
