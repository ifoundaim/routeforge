from __future__ import annotations

import os
from typing import Dict, Literal, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .attest.chain import (
    AttestationError,
    AttestationResult,
    ChainClient,
)
from .auth.magic import is_auth_enabled
from .demo_flags import is_demo
from .middleware import get_request_user
from .db import try_get_session
from . import models


router = APIRouter(prefix="/api", tags=["attest"])


class AttestRequest(BaseModel):
    mode: Literal["log", "nft"] = Field(description="Attestation mode")


class AttestResponse(BaseModel):
    tx_hash: str
    metadata_uri: Optional[str] = None
    token_id: Optional[int] = None
    mode: Literal["demo", "testnet"]


class DemoModeResponse(BaseModel):
    demo: bool


def _build_metadata_fields(
    release_id: int, release: Optional[models.Release]
) -> Dict[str, str]:
    artifact_sha = None
    if release is not None:
        artifact_sha = getattr(release, "artifact_sha256", None)
        if artifact_sha:
            artifact_sha = str(artifact_sha)
    license_code = None
    if release is not None:
        license_code = getattr(release, "license_code", None)
        if license_code:
            license_code = str(license_code)

    app_base = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
    evidence_uri = f"{app_base}/api/releases/{release_id}/evidence.zip"

    return {
        "artifact_sha256": artifact_sha or "unknown",
        "license_code": license_code or "none",
        "evidence_uri": evidence_uri,
    }


def _load_release(release_id: int) -> Tuple[Dict[str, Optional[str]], Dict[str, str]]:
    release_info: Dict[str, Optional[str]] = {"version": None, "artifact_url": None}
    metadata = _build_metadata_fields(release_id, None)

    session = try_get_session()
    if session is None:
        return release_info, metadata

    try:
        release = session.get(models.Release, release_id)
        if release is None:
            raise HTTPException(status_code=404, detail="release_not_found")

        release_info = {
            "version": release.version,
            "artifact_url": release.artifact_url,
        }
        metadata = _build_metadata_fields(release_id, release)
    finally:
        session.close()

    return release_info, metadata


@router.get("/demo-mode", response_model=DemoModeResponse)
def read_demo_mode() -> DemoModeResponse:
    return DemoModeResponse(demo=is_demo())


@router.post("/releases/{release_id}/attest", response_model=AttestResponse)
def attest_release(release_id: int, payload: AttestRequest, request: Request) -> AttestResponse:
    if is_auth_enabled() and get_request_user(request) is None:
        raise HTTPException(status_code=401, detail="auth_required")

    release_info, metadata = _load_release(release_id)

    client = ChainClient()
    try:
        if payload.mode == "log":
            result: AttestationResult = client.send_log(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )
        else:
            result = client.mint_nft(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )
    except AttestationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return AttestResponse(
        tx_hash=result.tx_hash,
        metadata_uri=result.metadata_uri,
        token_id=result.token_id,
        mode=result.mode,
    )
