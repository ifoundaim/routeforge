import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from . import models


logger = logging.getLogger("routeforge.redirect")

router = APIRouter(tags=["redirects"])


def error(message: str, status_code: int = 400):
    return JSONResponse(status_code=status_code, content={"error": message})


def extract_client_ip(request: Request) -> Optional[str]:
    # X-Forwarded-For may contain a chain; take the first non-empty token
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[0]
    client_host = request.client.host if request.client else None
    return client_host


@router.get("/r/{slug}")
def redirect_slug(slug: str, request: Request, db: Session = Depends(get_db)):
    route = db.execute(select(models.Route).where(models.Route.slug == slug)).scalar_one_or_none()
    if route is None:
        return error("not_found", status_code=404)

    ip = extract_client_ip(request)
    ua = request.headers.get("user-agent")
    # Use historical "referer" header, with fallback to common misspelling "referrer"
    ref = request.headers.get("referer") or request.headers.get("referrer")

    hit = models.RouteHit(route_id=route.id, ip=ip, ua=ua, ref=ref)
    db.add(hit)
    db.commit()

    logger.info("Redirect slug=%s route_id=%s ip=%s", slug, route.id, ip)
    return RedirectResponse(url=route.target_url, status_code=302)


