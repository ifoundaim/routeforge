from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from .. import models
from ..db import try_get_session
from ..evidence import persist_evidence_ipfs_cid
from ..routes_evidence import get_release_evidence_uris
from ..storage.ipfs import pin_json


def _app_base_url() -> str:
    return os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")


def build_nft_metadata(
    *,
    release_id: int,
    name: Optional[str],
    description: Optional[str],
    evidence_uri: str,
    artifact_sha256: Optional[str] = None,
    license_code: Optional[str] = None,
    external_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Return ERC-721/1155-friendly metadata JSON for a release.

    Fields:
    - name: e.g. "RouteForge Release v1.2.0"
    - description: short summary or notes
    - external_url: defaults to release detail page within the app
    - attributes: artifact and license info
    - evidence_uri: points to evidence bundle (ipfs://... preferred)
    """

    ext_url = external_url
    if not ext_url:
        base = _app_base_url()
        ext_url = f"{base}/app/releases/{release_id}"

    attributes = []
    if artifact_sha256:
        attributes.append({"trait_type": "artifact_sha256", "value": artifact_sha256})
    if license_code:
        attributes.append({"trait_type": "license", "value": license_code})

    payload: Dict[str, Any] = {
        "name": name or f"RouteForge Release #{release_id}",
        "description": description or "Release provenance and evidence.",
        "external_url": ext_url,
        "attributes": attributes,
        "evidence_uri": evidence_uri,
    }
    return payload


logger = logging.getLogger("routeforge.attest.metadata")


def ensure_metadata_uri(
    release_id: int,
    metadata: Dict[str, str],
    release_info: Dict[str, Optional[str]],
) -> Optional[str]:
    """Ensure metadata JSON is available and pinned; reuse existing CID if present.

    Returns ipfs://<cid> when IPFS is configured and pin succeeds; otherwise
    returns the best-available evidence URI.
    """

    session = try_get_session()
    release = None
    persisted_cid: Optional[str] = None
    evidence_uri: Optional[str] = metadata.get("evidence_uri")

    try:
        if session is not None:
            release = session.get(models.Release, release_id)

        # Reuse stored evidence CID if present; otherwise persist it best-effort
        uris = get_release_evidence_uris(release_id, release)
        stored_ipfs = uris.get("ipfs")
        if stored_ipfs and release is not None:
            metadata["evidence_uri"] = stored_ipfs
            evidence_uri = stored_ipfs
        else:
            if not evidence_uri:
                evidence_uri = uris.get("http")
            if session is not None and release is not None:
                persisted_cid = persist_evidence_ipfs_cid(session, release, evidence_uri)
            if persisted_cid:
                ipfs_uri = f"ipfs://{persisted_cid}"
                metadata["evidence_uri"] = ipfs_uri
                evidence_uri = ipfs_uri
            elif evidence_uri:
                metadata["evidence_uri"] = evidence_uri

        # Reuse existing metadata CID if already pinned
        if release is not None and getattr(release, "metadata_ipfs_cid", None):
            return f"ipfs://{release.metadata_ipfs_cid}"

        # Build metadata JSON
        name = None
        ver = (release_info.get("version") if isinstance(release_info, dict) else None) or None
        if ver:
            name = f"RouteForge Release v{ver}"
        description = None
        metadata_obj = build_nft_metadata(
            release_id=release_id,
            name=name,
            description=description,
            evidence_uri=evidence_uri or "",
            artifact_sha256=metadata.get("artifact_sha256") or None,
            license_code=metadata.get("license_code") or None,
        )

        # Pin JSON to IPFS if configured
        cid = pin_json(metadata_obj, filename=f"release-{release_id}-metadata.json")
        if not cid:
            return evidence_uri

        if session is not None and release is not None:
            release.metadata_ipfs_cid = cid
            session.add(release)
            try:
                session.commit()
            except Exception:
                session.rollback()
            else:
                logger.info("Persisted metadata CID %s for release %s", cid, release_id)

        return f"ipfs://{cid}"
    finally:
        if session is not None:
            session.close()


__all__ = ["build_nft_metadata", "ensure_metadata_uri"]


