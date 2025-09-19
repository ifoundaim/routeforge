from __future__ import annotations

import os
from typing import Any, Dict, Optional


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


__all__ = ["build_nft_metadata"]


