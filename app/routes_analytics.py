import logging
from datetime import timedelta
from typing import List, Dict, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select, func, desc
from sqlalchemy.orm import Session

from .db import get_db, now_utc
from .errors import json_error
from . import models


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


@router.get("/stats/summary")
def get_stats_summary(days: int = 7, db: Session = Depends(get_db)) -> Dict[str, Any]:
    window_days = _normalize_days(days)
    since = now_utc() - timedelta(days=window_days)

    total_clicks = db.scalar(
        select(func.count(models.RouteHit.id)).where(models.RouteHit.ts >= since)
    ) or 0

    unique_routes = db.scalar(
        select(func.count(func.distinct(models.RouteHit.route_id))).where(models.RouteHit.ts >= since)
    ) or 0

    top_rows = db.execute(
        select(
            models.RouteHit.route_id.label("route_id"),
            models.Route.slug.label("slug"),
            func.count(models.RouteHit.id).label("clicks"),
        )
        .join(models.Route, models.Route.id == models.RouteHit.route_id)
        .where(models.RouteHit.ts >= since)
        .group_by(models.RouteHit.route_id, models.Route.slug)
        .order_by(desc("clicks"))
        .limit(10)
    ).all()

    top_routes: List[Dict[str, Any]] = [
        {"route_id": int(r.route_id), "slug": r.slug, "clicks": int(r.clicks)} for r in top_rows
    ]

    return {
        "total_clicks": int(total_clicks),
        "unique_routes": int(unique_routes),
        "top_routes": top_routes,
    }


@router.get("/routes/{route_id}/stats")
def get_route_stats(route_id: int, days: int = 7, db: Session = Depends(get_db)) -> Dict[str, Any]:
    exists = db.get(models.Route, route_id)
    if exists is None:
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

    referrers: List[Dict[str, Any]] = [
        {"ref": r.ref, "count": int(r.count)} for r in ref_rows
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
        "user_agents": user_agents,
    }



@router.get("/routes/{route_id}/hits/recent")
def get_route_recent_hits(route_id: int, limit: int = 20, db: Session = Depends(get_db)):
    """Return the most recent N hits for a given route.

    The result is ordered by timestamp descending and includes minimal fields for UI display.
    """
    exists = db.get(models.Route, route_id)
    if exists is None:
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


