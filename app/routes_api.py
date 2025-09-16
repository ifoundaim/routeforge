import logging
import os
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from . import models, schemas
from .errors import json_error
from .utils.validators import slugify, validate_target_url
from .auth.magic import SessionUser, get_session_user, is_auth_enabled


logger = logging.getLogger("routeforge.api")

router = APIRouter(prefix="/api", tags=["api"])


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


def _require_session(request: Request) -> Tuple[Optional[SessionUser], Optional[JSONResponse]]:
    if not is_auth_enabled():
        return None, None

    user = get_session_user(request)
    if user is None:
        return None, error(request, "auth_required", status_code=401, detail="Authentication required.")

    return user, None


@router.post("/projects", response_model=schemas.ProjectOut)
def create_project(payload: schemas.ProjectCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_session(request)
    if failure is not None:
        return failure

    project_data = payload.model_dump()
    if session_user is not None:
        project_data["owner"] = session_user["email"]

    project = models.Project(**project_data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.post("/releases", response_model=schemas.ReleaseOut)
def create_release(payload: schemas.ReleaseCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_session(request)
    if failure is not None:
        return failure

    project = db.get(models.Project, payload.project_id)
    if project is None:
        return error(request, "project_not_found", status_code=404)

    if session_user is not None and project.owner != session_user["email"]:
        return error(request, "forbidden", status_code=403, detail="Project ownership mismatch.")

    release = models.Release(**payload.model_dump())
    db.add(release)
    db.commit()
    db.refresh(release)
    return release


@router.post("/routes", response_model=schemas.RouteOut)
def create_route(payload: schemas.RouteCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_session(request)
    if failure is not None:
        return failure

    # Minimal happy-path validations
    project = db.get(models.Project, payload.project_id)
    if project is None:
        return error(request, "project_not_found", status_code=404)

    if session_user is not None and project.owner != session_user["email"]:
        return error(request, "forbidden", status_code=403, detail="Project ownership mismatch.")

    if payload.release_id is not None:
        release = db.get(models.Release, payload.release_id)
        if release is None:
            return error(request, "release_not_found", status_code=404)
        if release.project_id != payload.project_id:
            return error(request, "release_project_mismatch", status_code=400)

    allowed_schemes = _get_allowed_target_schemes()
    sanitized_slug = slugify(payload.slug)
    if not sanitized_slug or len(sanitized_slug) < 2:
        return error(
            request,
            "invalid_slug",
            status_code=422,
            detail="Slug must contain at least two letters, numbers, or dashes.",
        )

    try:
        normalized_url = validate_target_url(payload.target_url, allowed=allowed_schemes)
    except ValueError:
        detail = f"Target URL scheme must be one of: {', '.join(allowed_schemes)}"
        return error(request, "invalid_url", status_code=422, detail=detail)

    # Proactive uniqueness check for nicer error; DB constraint remains authoritative
    existing = db.execute(select(models.Route).where(models.Route.slug == sanitized_slug)).scalar_one_or_none()
    if existing is not None:
        return error(request, "slug_exists", status_code=409, detail=f"Slug '{sanitized_slug}' already exists.")

    route_data = payload.model_dump()
    route_data["slug"] = sanitized_slug
    route_data["target_url"] = normalized_url
    new_route = models.Route(**route_data)
    db.add(new_route)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return error(request, "slug_exists", status_code=409, detail=f"Slug '{sanitized_slug}' already exists.")

    db.refresh(new_route)
    return new_route


@router.get("/releases/{release_id}", response_model=schemas.ReleaseDetailOut)
def get_release_detail(release_id: int, request: Request, db: Session = Depends(get_db)):
    release = db.get(models.Release, release_id)
    if release is None:
        return error(request, "not_found", status_code=404)

    # eager load project for response
    _ = release.project  # access relationship

    latest_route = db.execute(
        select(models.Route)
        .where(models.Route.release_id == release_id)
        .order_by(models.Route.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    return schemas.ReleaseDetailOut(
        id=release.id,
        project_id=release.project_id,
        version=release.version,
        notes=release.notes,
        artifact_url=release.artifact_url,
        created_at=release.created_at,
        project=release.project,
        latest_route=latest_route,
    )


@router.get("/routes/{route_id}/hits")
def get_route_hits(route_id: int, request: Request, db: Session = Depends(get_db)):
    exists = db.get(models.Route, route_id)
    if exists is None:
        return error(request, "not_found", status_code=404)

    count = db.scalar(select(func.count(models.RouteHit.id)).where(models.RouteHit.route_id == route_id))
    return {"count": int(count or 0)}
