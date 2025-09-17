import json
import logging
import os
import re
import uuid
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from . import models
from .search import search_similar_releases
from .errors import json_error
from .middleware import get_request_user
from .auth.magic import is_auth_enabled
from .auth.accounts import ensure_demo_user

logger = logging.getLogger("routeforge.agent")

router = APIRouter(prefix="/agent", tags=["agent"])


def error(code: str, status_code: int = 400):
    return json_error(code, status_code=status_code)


def slugify(text_value: str) -> str:
    s = text_value.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:64]


def extract_version(artifact_url: str, notes: Optional[str]) -> str:
    candidates: List[str] = []
    if notes:
        candidates.append(notes)
    # Use filename part of URL
    filename = artifact_url.rsplit("/", 1)[-1]
    candidates.append(filename)
    pattern = re.compile(r"v?(\d+\.\d+\.\d+)")
    for source in candidates:
        m = pattern.search(source)
        if m:
            return m.group(1)
    # Fallback
    short = uuid.uuid4().hex[:8]
    return f"auto-{short}"


def _log_audit(db: Session, entity_type: str, entity_id: int, action: str, meta: Optional[Dict[str, Any]] = None):
    audit = models.Audit(entity_type=entity_type, entity_id=entity_id, action=action, meta=meta or {})
    db.add(audit)
    db.commit()


def _compute_embedding_if_enabled(text_value: str) -> Optional[bytes]:
    if (os.getenv("EMBEDDING_ENABLED") or "0") != "1":
        return None
    # Use same stub as search: 768 float values in [0,1]. Store as JSON bytes for simplicity.
    # We store JSON array bytes so raw SQL vector ops may not work unless TiDB casts; acceptable for demo.
    from .search import _hash_to_vector_768  # local import to avoid cycle exposure

    vec = _hash_to_vector_768(text_value)
    payload = json.dumps(vec).encode("utf-8")
    return payload


def _require_actor(request: Request, db: Session) -> Optional[Dict[str, Any]]:
    user = get_request_user(request)
    if is_auth_enabled():
        return user

    demo = ensure_demo_user(db)
    demo_user: Dict[str, Any] = {"user_id": int(demo.id), "email": demo.email, "name": demo.name}
    request.state.user = demo_user
    return demo_user


@router.post("/publish")
def agent_publish(payload: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    actor = _require_actor(request, db)
    if is_auth_enabled() and actor is None:
        return error("auth_required", status_code=401)

    # Validate inputs
    try:
        project_id = int(payload.get("project_id"))
    except Exception:
        return error("invalid_project_id", status_code=422)
    artifact_url = payload.get("artifact_url")
    if not artifact_url or not isinstance(artifact_url, str):
        return error("invalid_artifact_url", status_code=422)
    notes = payload.get("notes")
    notes = notes if isinstance(notes, str) or notes is None else str(notes)
    dry_run = bool(payload.get("dry_run") or False)
    force = bool(payload.get("force") or False)

    project = db.get(models.Project, project_id)
    if project is None:
        return error("project_not_found", status_code=404)

    if actor is not None and project.user_id != int(actor.get("user_id")):
        return error("forbidden", status_code=403)

    # 1) Ingest staging
    staging = models.ReleasesStaging(artifact_url=artifact_url, notes=notes)
    db.add(staging)
    db.commit()
    db.refresh(staging)
    _log_audit(db, "agent", staging.id, "ingest", {"artifact_url": artifact_url, "notes": notes})

    # 2) Similarity search
    query_text = notes or artifact_url.rsplit("/", 1)[-1]
    similar = search_similar_releases(db, query_text=query_text, top_k=3)
    _log_audit(db, "agent", staging.id, "search", {"top": len(similar), "items": similar})

    # 3) Decide
    decision = "proceed"
    if not force and similar:
        threshold = 0.83
        try:
            threshold = float(os.getenv("SIMILARITY_THRESHOLD", "0.83"))
        except Exception:
            pass
        # Check if any item meets or exceeds threshold (vector semantics) or first item high textual score
        high = any(item.get("score", 0.0) >= threshold for item in similar)
        if high:
            return JSONResponse(
                status_code=200,
                content={
                    "decision": "review",
                    "similar_releases": similar,
                    "message": "Similar release(s) found; use force=true to publish",
                },
            )

    # 4) Publish unless dry_run
    version = extract_version(artifact_url, notes)
    release_dict = {
        "project_id": project_id,
        "version": version,
        "notes": notes,
        "artifact_url": artifact_url,
    }
    route_dict: Optional[Dict[str, Any]] = None

    if dry_run:
        logger.info("agent.publish dry_run project_id=%s version=%s", project_id, version)
        decision = "dry_run"
    else:
        # Create release
        release = models.Release(user_id=int(actor["user_id"]) if actor else project.user_id, **release_dict)
        embed = _compute_embedding_if_enabled(notes or artifact_url)
        if embed is not None:
            release.embedding = embed
        db.add(release)
        db.commit()
        db.refresh(release)
        _log_audit(db, "release", release.id, "publish", {"project_id": project_id, "version": version})

        # Mint route
        base_slug = slugify(f"{project.name}-{version}")
        slug = base_slug or uuid.uuid4().hex[:8]
        # Ensure uniqueness; if conflict, return 409 to signal retry
        existing = db.execute(select(models.Route).where(models.Route.slug == slug)).scalar_one_or_none()
        if existing is not None:
            # Attempt a randomized suffix once; if still conflict, 409
            alt = slugify(f"{base_slug}-{uuid.uuid4().hex[:4]}")
            existing2 = db.execute(select(models.Route).where(models.Route.slug == alt)).scalar_one_or_none()
            if existing2 is not None:
                return error("slug_conflict", status_code=409)
            slug = alt

        route = models.Route(
            project_id=project_id,
            slug=slug,
            target_url=artifact_url,
            release_id=release.id,
            user_id=int(actor["user_id"]) if actor else project.user_id,
        )
        db.add(route)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return error("slug_conflict", status_code=409)
        db.refresh(route)
        _log_audit(db, "route", route.id, "mint_route", {"slug": slug, "target_url": artifact_url})

        route_dict = {
            "id": route.id,
            "slug": route.slug,
            "target_url": route.target_url,
        }
        release_dict["id"] = release.id
        release_dict["created_at"] = str(release.created_at)

        decision = "published"

    # 5) Response
    return JSONResponse(
        status_code=200,
        content={
            "decision": decision,
            "release": release_dict if not dry_run else {
                "project_id": project_id,
                "version": version,
                "notes": notes,
                "artifact_url": artifact_url,
            },
            "route": route_dict,
            "similar_releases": similar,
            "audit_sample": [
                {"action": "ingest", "staging_id": staging.id},
                {"action": "search", "top": len(similar)},
            ],
        },
    )
