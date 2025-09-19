import csv
import hashlib
import io
import json
import logging
import os
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .licenses import get_license_info, render_license_md

logger = logging.getLogger("routeforge.evidence")

_STREAM_CHUNK_SIZE = 1024 * 1024  # 1 MiB
_EVIDENCE_WINDOW_DAYS = 90
_ENV_ROOT_KEYS = (
    "ARTIFACT_UPLOAD_ROOT",
    "UPLOAD_ROOT",
    "ROUTEFORGE_UPLOAD_ROOT",
)
_DEFAULT_LOCAL_ROOTS = (
    Path("tmp/uploads"),
    Path("tmp/artifacts"),
)


def compute_artifact_sha256(artifact_url: str, timeout: float = 30.0) -> Optional[str]:
    """Return the SHA-256 digest for the artifact URL or local file if accessible."""
    if not artifact_url:
        return None

    for candidate in _iter_candidate_paths(artifact_url):
        digest = _hash_file(candidate)
        if digest:
            logger.debug("Hashed artifact from local path %s", candidate)
            return digest

    parsed = urlparse(artifact_url)
    if parsed.scheme in {"http", "https"}:
        digest = _hash_remote(artifact_url, timeout=timeout)
        if digest:
            logger.debug("Hashed artifact from remote URL %s", artifact_url)
        return digest

    if parsed.scheme == "file":  # explicit file:// URL
        digest = _hash_file(Path(parsed.path))
        if digest:
            logger.debug("Hashed artifact from file URL %s", artifact_url)
        return digest

    return None


def _local_roots() -> Iterable[Path]:
    for key in _ENV_ROOT_KEYS:
        raw = os.getenv(key)
        if raw:
            yield Path(raw)
    yield from _DEFAULT_LOCAL_ROOTS


def _iter_candidate_paths(artifact_url: str) -> Iterable[Path]:
    parsed = urlparse(artifact_url)
    seen: set[str] = set()

    def normalize(path: Optional[Path]) -> Optional[Path]:
        if path is None:
            return None
        try:
            expanded = path.expanduser()
        except Exception:
            return None
        normalized = expanded if expanded.is_absolute() else Path.cwd() / expanded
        try:
            normalized = normalized.resolve(strict=False)
        except Exception:
            normalized = normalized.absolute()
        key = str(normalized)
        if key in seen:
            return None
        seen.add(key)
        return normalized

    if parsed.scheme == "file":
        candidate = normalize(Path(parsed.path))
        if candidate:
            yield candidate
        return

    if parsed.scheme in {"http", "https"}:
        path_fragment = Path(parsed.path.lstrip("/")) if parsed.path else None
        if path_fragment:
            for root in _local_roots():
                candidate = normalize(root / path_fragment)
                if candidate:
                    yield candidate
        candidate = normalize(Path(parsed.path) if parsed.path else None)
        if candidate:
            yield candidate
        return

    raw = artifact_url.strip()
    if raw:
        candidate = normalize(Path(raw))
        if candidate:
            yield candidate
        if not Path(raw).is_absolute():
            for root in _local_roots():
                candidate = normalize(root / raw)
                if candidate:
                    yield candidate


def _hash_file(path: Path) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_STREAM_CHUNK_SIZE), b""):
                if not chunk:
                    break
                digest.update(chunk)
    except OSError as exc:  # pragma: no cover - filesystem variance
        logger.warning("Failed to hash local artifact %s: %s", path, exc)
        return None
    return digest.hexdigest()


def _hash_remote(url: str, *, timeout: float) -> Optional[str]:
    digest = hashlib.sha256()
    try:
        with httpx.stream(
            "GET",
            url,
            timeout=httpx.Timeout(timeout, connect=10.0, read=timeout),
            follow_redirects=True,
        ) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(_STREAM_CHUNK_SIZE):
                if not chunk:
                    continue
                digest.update(chunk)
    except httpx.HTTPError as exc:  # pragma: no cover - network variance
        logger.warning("Failed to hash remote artifact %s: %s", url, exc)
        return None
    return digest.hexdigest()


def build_evidence_zip(release_id: int, db: Session) -> bytes:
    """Assemble an evidence bundle for the given release."""
    release = db.get(models.Release, release_id)
    if release is None:
        raise ValueError("release_not_found")

    project = release.project  # trigger eager load if needed
    routes = (
        db.execute(
            select(models.Route)
            .where(
                models.Route.release_id == release_id,
            )
            .order_by(models.Route.created_at.asc())
        ).scalars().all()
    )

    audit_entity_ids = [release_id] + [route.id for route in routes]
    audit_entries = (
        db.execute(
            select(models.Audit)
            .where(
                models.Audit.entity_type.in_(["release", "route"]),
                models.Audit.entity_id.in_(audit_entity_ids),
            )
            .order_by(models.Audit.ts.asc())
        ).scalars().all()
    )

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=_EVIDENCE_WINDOW_DAYS)
    hits_rows = db.execute(
        select(
            models.RouteHit.ts,
            models.RouteHit.ip,
            models.RouteHit.ua,
            models.RouteHit.ref,
            models.Route.id.label("route_id"),
            models.Route.slug.label("route_slug"),
        )
        .join(models.Route, models.RouteHit.route_id == models.Route.id)
        .where(
            models.Route.release_id == release_id,
            models.RouteHit.ts >= since,
        )
        .order_by(models.RouteHit.ts.desc())
    ).all()

    evidence_buffer = io.BytesIO()

    license_info = get_license_info(release.license_code)

    release_payload: Dict[str, object] = {
        "id": release.id,
        "project_id": release.project_id,
        "version": release.version,
        "notes": release.notes,
        "artifact_url": release.artifact_url,
        "artifact_sha256": release.artifact_sha256,
        "license_code": release.license_code,
        "license_custom_text": release.license_custom_text,
        "license_url": license_info.url if license_info else None,
        "created_at": release.created_at.isoformat() if release.created_at else None,
        "project": {
            "id": project.id if project else None,
            "name": project.name if project else None,
            "owner": project.owner if project else None,
            "description": project.description if project else None,
            "created_at": project.created_at.isoformat() if project and project.created_at else None,
        },
    }

    routes_payload: List[Dict[str, Optional[str]]] = []
    for route in routes:
        routes_payload.append(
            {
                "id": route.id,
                "slug": route.slug,
                "target_url": route.target_url,
                "created_at": route.created_at.isoformat() if route.created_at else None,
                "project_id": route.project_id,
            }
        )

    audit_payload: List[Dict[str, Optional[str]]] = []
    for audit in audit_entries:
        audit_payload.append(
            {
                "id": audit.id,
                "entity_type": audit.entity_type,
                "entity_id": audit.entity_id,
                "action": audit.action,
                "meta": audit.meta,
                "ts": audit.ts.isoformat() if audit.ts else None,
            }
        )

    hits_csv = _render_hits_csv(hits_rows)

    with zipfile.ZipFile(evidence_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("release.json", json.dumps(release_payload, indent=2))
        archive.writestr("routes.json", json.dumps(routes_payload, indent=2))
        archive.writestr("audit.json", json.dumps(audit_payload, indent=2))
        archive.writestr("hits.csv", hits_csv)

        license_markdown = render_license_md(release)
        if license_markdown:
            archive.writestr("LICENSE.md", license_markdown)
        else:
            license_path = Path("LICENSE.md")
            if license_path.exists():
                archive.write(license_path, arcname="LICENSE.md")

    return evidence_buffer.getvalue()


def _render_hits_csv(rows: List) -> str:
    header = ["ts", "route_id", "route_slug", "ip", "ua", "ref"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        ts = row.ts
        if ts is None:
            ts_value = ""
        elif hasattr(ts, "isoformat"):
            ts_value = ts.isoformat()
        else:
            ts_value = str(ts)
        writer.writerow(
            [
                ts_value,
                row.route_id,
                row.route_slug,
                row.ip or "",
                row.ua or "",
                row.ref or "",
            ]
        )
    return buffer.getvalue()


def extract_ipfs_cid(evidence_uri: Optional[str]) -> Optional[str]:
    """Return the CID portion of an ipfs:// URI, or None if not applicable."""
    if not evidence_uri:
        return None
    evidence_uri = evidence_uri.strip()
    if not evidence_uri.lower().startswith("ipfs://"):
        return None
    cid = evidence_uri[7:].strip()
    return cid or None


def persist_evidence_ipfs_cid(db: Session, release: models.Release, evidence_uri: Optional[str]) -> Optional[str]:
    """Persist the CID extracted from an evidence URI if the release has none."""
    cid = extract_ipfs_cid(evidence_uri)
    if cid is None:
        return None

    if getattr(release, "evidence_ipfs_cid", None):
        return release.evidence_ipfs_cid

    release.evidence_ipfs_cid = cid
    db.add(release)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    else:
        db.refresh(release)
        logger.info("Persisted evidence CID %s for release %s", cid, release.id)
    return cid


__all__ = [
    "compute_artifact_sha256",
    "build_evidence_zip",
    "extract_ipfs_cid",
    "persist_evidence_ipfs_cid",
]
