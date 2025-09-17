from __future__ import annotations

import hashlib
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .demo_flags import is_demo


router = APIRouter(prefix="/api", tags=["attest"])


class AttestRequest(BaseModel):
    mode: Literal["log", "nft"] = Field(description="Attestation mode")


class AttestResponse(BaseModel):
    release_id: int
    sha256: str
    network: str
    tx_hash: str
    token_id: Optional[int]
    metadata_uri: Optional[str]
    dry_run: bool


class DemoModeResponse(BaseModel):
    demo: bool


def _demo_sha256(release_id: int) -> str:
    digest = hashlib.sha256(f"routeforge-demo-{release_id}".encode("utf-8")).hexdigest().upper()
    return f"DEAD{digest[4:60]}BEEF"


@router.get("/demo-mode", response_model=DemoModeResponse)
def read_demo_mode() -> DemoModeResponse:
    return DemoModeResponse(demo=is_demo())


@router.post("/releases/{release_id}/attest", response_model=AttestResponse)
def demo_attest_release(release_id: int, payload: AttestRequest) -> AttestResponse:
    if not is_demo():
        raise HTTPException(status_code=501, detail="Attestation flow not implemented")

    sha = _demo_sha256(release_id)
    tx_hash = f"0xDEMO{release_id}"
    token_id: Optional[int] = None
    metadata_uri: Optional[str] = None

    if payload.mode == "nft":
        token_id = 1000 + release_id
        metadata_uri = f"ipfs://demo/{release_id}"

    return AttestResponse(
        release_id=release_id,
        sha256=sha,
        network="base",
        tx_hash=tx_hash,
        token_id=token_id,
        metadata_uri=metadata_uri,
        dry_run=True,
    )
