import logging
import os
from typing import Optional, Tuple, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.responses import Response

from .db import get_db
from . import models, schemas
from .middleware import get_request_user, json_error_response
from .utils.validators import slugify, validate_target_url
from .auth.magic import SessionUser, is_auth_enabled
from .auth.accounts import ensure_demo_user
from .guards import require_owner


logger = logging.getLogger("routeforge.api")

router = APIRouter(prefix="/api", tags=["api"])


def error(request: Request, code: str, status_code: int = 400, detail: Optional[str] = None):
    return json_error_response(request, code, status_code=status_code, detail=detail)


def _get_allowed_target_schemes() -> Tuple[str, ...]:
    raw = os.getenv("ALLOWED_TARGET_SCHEMES", "https,http") or "https,http"
    cleaned = tuple(dict.fromkeys([item.strip().lower() for item in raw.split(",") if item.strip()]))
    return cleaned or ("https", "http")


def _require_user(request: Request, db: Session) -> Tuple[SessionUser, Optional[Response]]:
    user = get_request_user(request)
    if is_auth_enabled():
        if user is None:
            failure = error(request, "auth_required", status_code=401, detail="Authentication required.")
            return cast(SessionUser, {}), failure
        return cast(SessionUser, user), None

    demo = ensure_demo_user(db)
    demo_user: SessionUser = {
        "user_id": int(demo.id),
        "email": demo.email,
        "name": demo.name,
    }
    request.state.user = demo_user
    return demo_user, None



def _require_user_id(request: Request, session_user: SessionUser) -> Tuple[Optional[int], Optional[Response]]:
    raw_user_id = None
    if isinstance(session_user, dict):
        raw_user_id = session_user.get("user_id")
    else:
        raw_user_id = getattr(session_user, "user_id", None)
    if raw_user_id is None:
        return None, error(request, "auth_required", status_code=401, detail="Authentication required.")
    try:
        return int(raw_user_id), None
    except (TypeError, ValueError):
        return None, error(request, "auth_required", status_code=401, detail="Authentication required.")


@router.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(payload: schemas.ProjectCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure

    user_id, failure = _require_user_id(request, session_user)
    if failure is not None:
        return failure

    owner_email = (session_user.get("email") or "").strip().lower()
    if not owner_email:
        return error(request, "auth_required", status_code=401, detail="Authentication required.")

    project_data = payload.model_dump()
    project_data.pop("user_id", None)
    project_data["owner"] = owner_email

    project = models.Project(user_id=user_id, **project_data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.post("/releases", response_model=schemas.ReleaseOut, status_code=201)
def create_release(payload: schemas.ReleaseCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure
    current_user_id, failure = _require_user_id(request, session_user)
    if failure is not None:
        return failure

    project = db.get(models.Project, payload.project_id)
    failure = require_owner(
        project,
        request,
        session_user,
        missing_code="project_not_found",
        mismatch_code="forbidden",
        mismatch_status=403,
        mismatch_detail="Project ownership mismatch.",
    )
    if failure is not None:
        return failure

    release_data = payload.model_dump()
    release_data.pop("user_id", None)
    release = models.Release(user_id=current_user_id, **release_data)
    db.add(release)
    db.commit()
    db.refresh(release)
    return release


@router.post("/routes", response_model=schemas.RouteOut, status_code=201)
def create_route(payload: schemas.RouteCreate, request: Request, db: Session = Depends(get_db)):
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure
    current_user_id, failure = _require_user_id(request, session_user)
    if failure is not None:
        return failure

    # Minimal happy-path validations
    project = db.get(models.Project, payload.project_id)
    failure = require_owner(
        project,
        request,
        session_user,
        missing_code="project_not_found",
        mismatch_code="forbidden",
        mismatch_status=403,
        mismatch_detail="Project ownership mismatch.",
    )
    if failure is not None:
        return failure

    if payload.release_id is not None:
        release = db.get(models.Release, payload.release_id)
        failure = require_owner(
            release,
            request,
            session_user,
            missing_code="release_not_found",
        )
        if failure is not None:
            return failure
        if release.project_id != payload.project_id:
            return error(request, "release_project_mismatch", status_code=400)

    allowed_schemes = _get_allowed_target_schemes()
    slug_raw = (payload.slug or "").strip()
    sanitized_slug = slugify(slug_raw)
    if not sanitized_slug or len(sanitized_slug) < 2:
        return error(
            request,
            "invalid_slug",
            status_code=422,
            detail="Slug must contain at least two letters, numbers, or dashes.",
        )

    try:
        normalized_url = validate_target_url(payload.target_url or "", allowed=allowed_schemes)
    except ValueError:
        detail = f"Target URL scheme must be one of: {', '.join(allowed_schemes)}"
        return error(request, "invalid_url", status_code=422, detail=detail)

    # Proactive uniqueness check for nicer error; DB constraint remains authoritative
    existing = db.execute(select(models.Route).where(models.Route.slug == sanitized_slug)).scalar_one_or_none()
    if existing is not None:
        return error(request, "slug_exists", status_code=409, detail=f"Slug '{sanitized_slug}' already exists.")

    route_data = payload.model_dump()
    route_data.pop("user_id", None)
    route_data["slug"] = sanitized_slug
    route_data["target_url"] = normalized_url
    new_route = models.Route(user_id=current_user_id, **route_data)
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
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure
    current_user_id = int(session_user["user_id"])

    release = (
        db.execute(
            select(models.Release)
            .where(
                models.Release.id == release_id,
                models.Release.user_id == current_user_id,
            )
            .limit(1)
        ).scalar_one_or_none()
    )
    if release is None:
        return error(request, "not_found", status_code=404)

    # eager load project for response
    _ = release.project  # access relationship

    latest_route = db.execute(
        select(models.Route)
        .where(
            models.Route.release_id == release_id,
            models.Route.user_id == current_user_id,
        )
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
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure
    current_user_id = int(session_user["user_id"])

    route = (
        db.execute(
            select(models.Route)
            .where(
                models.Route.id == route_id,
                models.Route.user_id == current_user_id,
            )
            .limit(1)
        ).scalar_one_or_none()
    )
    if route is None:
        return error(request, "not_found", status_code=404)

    count = db.scalar(select(func.count(models.RouteHit.id)).where(models.RouteHit.route_id == route_id))
    return {"count": int(count or 0)}
