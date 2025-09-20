import logging
import os
from urllib.parse import urlparse
from typing import Optional, Tuple, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.responses import Response
import httpx

from .db import get_db
from . import models, schemas
from .middleware import get_request_user, json_error_response
from .utils.validators import slugify, validate_target_url
from .security.hmac import verify_hmac
from .redirects.sanity import domain_allowed, get_allowed_schemes, get_blocked_domains, head_ok
from .worker.queue import queue
from .agent.publish import apply_artifact_hash
from .auth.magic import SessionUser, is_auth_enabled
from .auth.accounts import ensure_demo_user
from .guards import require_owner
from .licenses import get_license_info


logger = logging.getLogger("routeforge.api")

router = APIRouter(prefix="/api", tags=["api"])


def error(request: Request, code: str, status_code: int = 400, detail: Optional[str] = None):
    return json_error_response(request, code, status_code=status_code, detail=detail)


def _get_allowed_target_schemes() -> Tuple[str, ...]:
    # Delegate to redirects.sanity for consistency
    return get_allowed_schemes()


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


@router.post("/publish")
def publish_with_hmac(payload: dict, request: Request, db: Session = Depends(get_db)):
    body = request.scope.get("body")  # type: ignore[assignment]
    if isinstance(body, (bytes, bytearray)):
        body_bytes = bytes(body)
    else:
        # If body not captured in scope (common), re-serialize minimal payload
        import json as _json

        body_bytes = _json.dumps(payload or {}).encode("utf-8")

    user_id, err = verify_hmac(request, body_bytes, db)
    if err is not None:
        return error(request, "auth_required" if err == "hmac_required" else "hmac_invalid", status_code=401)

    # Minimal validation
    try:
        project_id = int((payload or {}).get("project_id"))
    except Exception:
        return error(request, "invalid_project_id", status_code=422)
    artifact_url = (payload or {}).get("artifact_url")
    if not artifact_url or not isinstance(artifact_url, str):
        return error(request, "invalid_artifact_url", status_code=422)
    notes = (payload or {}).get("notes")
    if notes is not None and not isinstance(notes, str):
        notes = str(notes)

    project = db.get(models.Project, project_id)
    if project is None:
        return error(request, "project_not_found", status_code=404)
    if int(project.user_id) != int(user_id):
        return error(request, "forbidden", status_code=403)

    # Create release and route similar to agent.publish (simplified)
    release = models.Release(user_id=int(user_id), project_id=project_id, version="auto", notes=notes, artifact_url=artifact_url)
    db.add(release)
    db.commit()
    db.refresh(release)

    # No auto route mint here; return release id
    return {"id": release.id, "project_id": project_id, "artifact_url": artifact_url, "notes": notes}


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
    _maybe_hash_release_async(release.id, release.artifact_url)
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

    # Optional domain blocklist
    host = urlparse(normalized_url).netloc
    if not domain_allowed(host, blocked=get_blocked_domains()):
        return error(request, "invalid_url", status_code=422, detail="Target URL domain is not allowed.")

    # Optional HEAD sanity check on creation
    try:
        do_head = (os.getenv("HEAD_CHECK_ON_CREATE") or "1").strip() == "1"
        if do_head:
            # fire-and-forget; do not block response
            async def _head_fire_and_forget(url: str):
                await head_ok(url)

            # Schedule using anyio via FastAPI's loop if present; otherwise ignore
            import anyio  # type: ignore

            anyio.from_thread.run(_head_fire_and_forget, normalized_url)  # type: ignore
    except Exception:
        pass

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


@router.get("/routes")
def get_route_by_slug(slug: Optional[str] = None, request: Request = None, db: Session = Depends(get_db)):
    """Lookup a route by slug for the current user.

    Frontend uses this to resolve `id` and target when navigating by slug.
    Returns minimal fields to avoid over-fetching.
    """
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure
    current_user_id, failure = _require_user_id(request, session_user)
    if failure is not None:
        return failure

    if not slug or not isinstance(slug, str):
        return error(request, "invalid_slug", status_code=422, detail="Missing or invalid slug.")

    sanitized = slugify(slug.strip())
    route = (
        db.execute(
            select(models.Route)
            .where(models.Route.slug == sanitized, models.Route.user_id == current_user_id)
            .limit(1)
        ).scalar_one_or_none()
    )
    if route is None:
        return error(request, "not_found", status_code=404)

    return {
        "id": int(route.id),
        "slug": route.slug,
        "target_url": route.target_url,
    }


# Async heavy task: apply artifact hash when artifacts are large
_HASH_SIZE_THRESHOLD = int(os.getenv("HASH_ASYNC_SIZE_BYTES", "104857600") or "104857600")  # 100 MB default


def _should_hash_async(artifact_url: str) -> bool:
    # If URL suggests a large artifact by extension, prefer async
    large_exts = {".zip", ".tar", ".tar.gz", ".tgz", ".7z", ".dmg", ".iso"}
    lowered = artifact_url.lower()
    return any(lowered.endswith(ext) for ext in large_exts)


def _hash_release_task(args: Tuple[int, str]):
    release_id, artifact_url = args
    # Local import to avoid circulars beyond what we already imported
    from sqlalchemy.orm import Session
    from .db import try_get_session
    from . import models

    db = try_get_session()
    if db is None:
        return
    try:
        release = db.get(models.Release, release_id)
        if release is None:
            return
        # Compute and persist digest
        apply_artifact_hash(release, artifact_url)
        db.add(release)
        db.commit()
    finally:
        db.close()  # type: ignore[attr-defined]


def _try_head_content_length(url: str, timeout: float = 2.5) -> Optional[int]:
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            resp = client.head(url)
            if resp.status_code >= 400:
                return None
            raw = resp.headers.get("content-length") or resp.headers.get("Content-Length")
            if not raw:
                return None
            try:
                return int(raw)
            except Exception:
                return None
    except Exception:
        return None


def _maybe_hash_release_async(release_id: int, artifact_url: str) -> None:
    if not artifact_url:
        return
    # Use size threshold first if available via HEAD
    size = _try_head_content_length(artifact_url)
    is_large = bool(size and size > _HASH_SIZE_THRESHOLD)
    if not is_large and not _should_hash_async(artifact_url):
        return
    task_id = f"hash:release:{release_id}"
    queue.submit(task_id, "hash_release", _hash_release_task, (release_id, artifact_url))


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

    license_info = get_license_info(release.license_code)

    return schemas.ReleaseDetailOut(
        id=release.id,
        project_id=release.project_id,
        version=release.version,
        notes=release.notes,
        artifact_url=release.artifact_url,
        artifact_sha256=release.artifact_sha256,
        license_code=release.license_code,
        license_custom_text=release.license_custom_text,
        license_url=license_info.url if license_info else None,
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
