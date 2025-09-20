from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

from . import models
from .db import try_get_session
from .licenses import get_license_info
from .og.render import ReleaseOgInput, render_not_found_image, render_release_image
from .evidence import build_evidence_zip
from .middleware import json_error_response


router = APIRouter(tags=["public"])


def error(request: Request, code: str, status_code: int = 400, detail: Optional[str] = None):
    return json_error_response(request, code, status_code=status_code, detail=detail)


def _close_session(session: Optional[Session]) -> None:
    if session is not None:
        try:
            session.close()
        except Exception:  # pragma: no cover - defensive close
            pass


class PublicRouteOut(BaseModel):
    id: int
    slug: str
    target_url: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicProjectOut(BaseModel):
    id: int
    name: str
    owner: Optional[str]
    description: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicReleaseOut(BaseModel):
    id: int
    version: str
    notes: Optional[str]
    artifact_url: str
    evidence_ipfs_cid: Optional[str]
    license_code: Optional[str]
    license_custom_text: Optional[str]
    license_url: Optional[str]
    created_at: datetime
    project: PublicProjectOut
    latest_route: Optional[PublicRouteOut] = None

    model_config = ConfigDict(from_attributes=True)


class PublicReleaseSummary(BaseModel):
    id: int
    version: str
    created_at: datetime
    license_code: Optional[str]
    license_custom_text: Optional[str]
    license_url: Optional[str]
    latest_route: Optional[PublicRouteOut] = None

    model_config = ConfigDict(from_attributes=True)


class PublicProjectDetail(PublicProjectOut):
    total_releases: int
    recent_releases: List[PublicReleaseSummary]


def _load_latest_route(db: Session, release_id: int) -> Optional[PublicRouteOut]:
    route = (
        db.execute(
            select(models.Route)
            .where(models.Route.release_id == release_id)
            .order_by(models.Route.created_at.desc())
            .limit(1)
        )
        .scalar_one_or_none()
    )
    if route is None:
        return None
    return PublicRouteOut.model_validate(route, from_attributes=True)


def _summarize_release(
    release: models.Release,
    project_name: str,
    route: Optional[PublicRouteOut],
) -> Optional[str]:
    notes = (release.notes or "").strip()
    if notes:
        flattened = " ".join(notes.split())
        if len(flattened) > 220:
            return f"{flattened[:217]}…"
        return flattened
    version = release.version or ""
    if route and route.slug:
        return f"{project_name} release v{version} • Route /r/{route.slug}"
    if project_name:
        return f"{project_name} release v{version} minted on RouteForge."
    return None


@router.get("/public/releases/{release_id}", response_model=PublicReleaseOut)
def get_public_release(release_id: int, request: Request, db: Optional[Session] = Depends(try_get_session)):
    if db is None:
        return error(request, "service_unavailable", status_code=503, detail="Database unavailable")

    try:
        release = db.get(models.Release, release_id)
        if release is None:
            return error(request, "not_found", status_code=404)

        project = release.project
        if project is None:
            project = db.get(models.Project, release.project_id)
            if project is None:
                return error(request, "not_found", status_code=404)

        license_info = get_license_info(release.license_code)

        project_out = PublicProjectOut.model_validate(project, from_attributes=True)
        route_out = _load_latest_route(db, release.id)

        return PublicReleaseOut(
            id=release.id,
            version=release.version,
            notes=release.notes,
            artifact_url=release.artifact_url,
            evidence_ipfs_cid=getattr(release, "evidence_ipfs_cid", None),
            license_code=release.license_code,
            license_custom_text=release.license_custom_text,
            license_url=license_info.url if license_info else None,
            created_at=release.created_at,
            project=project_out,
            latest_route=route_out,
        )
    finally:
        _close_session(db)


@router.get("/public/projects/{project_id}", response_model=PublicProjectDetail)
def get_public_project(project_id: int, request: Request, db: Optional[Session] = Depends(try_get_session)):
    if db is None:
        return error(request, "service_unavailable", status_code=503, detail="Database unavailable")

    try:
        project = db.get(models.Project, project_id)
        if project is None:
            return error(request, "not_found", status_code=404)

        total_releases = db.execute(
            select(func.count())
            .select_from(models.Release)
            .where(models.Release.project_id == project_id)
        ).scalar_one()

        releases = (
            db.execute(
                select(models.Release)
                .where(models.Release.project_id == project_id)
                .order_by(models.Release.created_at.desc())
                .limit(10)
            )
            .scalars()
            .all()
        )

        release_ids = [rel.id for rel in releases]
        route_map: Dict[int, PublicRouteOut] = {}
        if release_ids:
            rows = db.execute(
                select(
                    models.Route.release_id,
                    models.Route.id,
                    models.Route.slug,
                    models.Route.target_url,
                    models.Route.created_at,
                )
                .where(models.Route.release_id.in_(release_ids))
                .order_by(models.Route.release_id, models.Route.created_at.desc())
            ).all()
            for rel_id, route_id, slug, target_url, created_at in rows:
                if rel_id not in route_map:
                    route_map[rel_id] = PublicRouteOut(
                        id=route_id,
                        slug=slug,
                        target_url=target_url,
                        created_at=created_at,
                    )

        summaries: List[PublicReleaseSummary] = []
        for rel in releases:
            license_info = get_license_info(rel.license_code)
            summaries.append(
                PublicReleaseSummary(
                    id=rel.id,
                    version=rel.version,
                    created_at=rel.created_at,
                    license_code=rel.license_code,
                    license_custom_text=rel.license_custom_text,
                    license_url=license_info.url if license_info else None,
                    latest_route=route_map.get(rel.id),
                )
            )

        project_out = PublicProjectOut.model_validate(project, from_attributes=True)

        return PublicProjectDetail(
            id=project_out.id,
            name=project_out.name,
            owner=project_out.owner,
            description=project_out.description,
            created_at=project_out.created_at,
            total_releases=int(total_releases or 0),
            recent_releases=summaries,
        )
    finally:
        _close_session(db)


@router.get("/public/releases/{release_id}/evidence.zip")
def download_public_evidence(
    release_id: int,
    request: Request,
    db: Optional[Session] = Depends(try_get_session),
):
    if db is None:
        return error(request, "service_unavailable", status_code=503, detail="Database unavailable")

    try:
        release = db.get(models.Release, release_id)
        if release is None:
            return error(request, "not_found", status_code=404)

        try:
            payload = build_evidence_zip(release_id, db)
        except ValueError:
            return error(request, "not_found", status_code=404)

        filename = f"release-{release_id}-evidence.zip"
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return Response(content=payload, media_type="application/zip", headers=headers)
    finally:
        _close_session(db)


@router.get("/api/og/release/{release_id}.png")
def public_release_og_image(
    release_id: int,
    request: Request,
    db: Optional[Session] = Depends(try_get_session),
):
    if db is None:
        image = render_not_found_image(release_id)
        return Response(content=image, media_type="image/png", status_code=503)

    try:
        release = db.get(models.Release, release_id)
        if release is None:
            image = render_not_found_image(release_id)
            return Response(content=image, media_type="image/png")

        project = release.project
        if project is None:
            project = db.get(models.Project, release.project_id)
        if project is None:
            image = render_not_found_image(release_id)
            return Response(content=image, media_type="image/png")

        license_info = get_license_info(release.license_code)
        license_label = None
        if license_info is not None:
            license_label = license_info.label
        elif release.license_code:
            license_label = release.license_code
        elif release.license_custom_text:
            license_label = "Custom License"

        route_out = _load_latest_route(db, release.id)
        summary = _summarize_release(release, project.name or "RouteForge", route_out)

        data = ReleaseOgInput(
            project_name=project.name or "RouteForge Release",
            release_version=release.version or "",
            license_label=license_label,
            summary=summary,
        )
        image = render_release_image(data)
        headers = {"Cache-Control": "public, max-age=300"}
        return Response(content=image, media_type="image/png", headers=headers)
    finally:
        _close_session(db)
