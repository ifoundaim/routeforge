import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from . import models, schemas


logger = logging.getLogger("routeforge.api")

router = APIRouter(prefix="/api", tags=["api"])


def error(message: str, status_code: int = 400):
    return JSONResponse(status_code=status_code, content={"error": message})


@router.post("/projects", response_model=schemas.ProjectOut)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project = models.Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.post("/releases", response_model=schemas.ReleaseOut)
def create_release(payload: schemas.ReleaseCreate, db: Session = Depends(get_db)):
    project = db.get(models.Project, payload.project_id)
    if project is None:
        return error("project_not_found", status_code=404)

    release = models.Release(**payload.model_dump())
    db.add(release)
    db.commit()
    db.refresh(release)
    return release


@router.post("/routes", response_model=schemas.RouteOut)
def create_route(payload: schemas.RouteCreate, db: Session = Depends(get_db)):
    # Minimal happy-path validations
    project = db.get(models.Project, payload.project_id)
    if project is None:
        return error("project_not_found", status_code=404)

    if payload.release_id is not None:
        release = db.get(models.Release, payload.release_id)
        if release is None:
            return error("release_not_found", status_code=404)
        if release.project_id != payload.project_id:
            return error("release_project_mismatch", status_code=400)

    # Proactive uniqueness check for nicer error; DB constraint remains authoritative
    existing = db.execute(select(models.Route).where(models.Route.slug == payload.slug)).scalar_one_or_none()
    if existing is not None:
        return error("slug_exists", status_code=409)

    new_route = models.Route(**payload.model_dump())
    db.add(new_route)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return error("slug_exists", status_code=409)

    db.refresh(new_route)
    return new_route


@router.get("/releases/{release_id}", response_model=schemas.ReleaseDetailOut)
def get_release_detail(release_id: int, db: Session = Depends(get_db)):
    release = db.get(models.Release, release_id)
    if release is None:
        return error("not_found", status_code=404)

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
def get_route_hits(route_id: int, db: Session = Depends(get_db)):
    exists = db.get(models.Route, route_id)
    if exists is None:
        return error("not_found", status_code=404)

    count = db.scalar(select(func.count(models.RouteHit.id)).where(models.RouteHit.route_id == route_id))
    return {"count": int(count or 0)}


