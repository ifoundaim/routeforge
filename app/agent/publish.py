from __future__ import annotations

from typing import Optional

from .. import models
from ..evidence import compute_artifact_sha256


def apply_artifact_hash(release: models.Release, artifact_url: Optional[str] = None) -> Optional[str]:
    """Populate ``release.artifact_sha256`` if computable from the given URL."""

    target_url = artifact_url or release.artifact_url
    if not target_url:
        return None

    digest = compute_artifact_sha256(target_url)
    if digest:
        release.artifact_sha256 = digest
    return digest


__all__ = ["apply_artifact_hash"]
