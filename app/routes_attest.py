from __future__ import annotations

import os
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .attest.chain import (
    AttestationError,
    AttestationResult,
    ChainClient,
    StarknetClient,
)
from .auth.magic import is_auth_enabled
from .demo_flags import is_demo
from .middleware import get_request_user
from .db import try_get_session
from . import models


router = APIRouter(prefix="/api", tags=["attest"])


class AttestRequest(BaseModel):
    mode: Literal["log", "nft"] = Field(description="Attestation mode")
    tx_hash: Optional[str] = Field(default=None, description="Existing transaction hash from a wallet submission")
    signed_tx: Optional[str] = Field(default=None, description="Signed raw transaction to relay via RPC")


class AttestResponse(BaseModel):
    tx_hash: str
    metadata_uri: Optional[str] = None
    token_id: Optional[int] = None
    mode: Literal["demo", "testnet", "off"]


class DemoModeResponse(BaseModel):
    demo: bool


class AttestConfigResponse(BaseModel):
    chain_id: int
    chain_name: str
    rpc_url: Optional[str] = None
    contract: Optional[str] = None
    mint_function: str
    mint_inputs: List[str] = Field(default_factory=list)
    abi: Optional[List[Dict[str, Any]]] = None
    requires_wallet: bool
    mode: Literal["demo", "testnet", "off"]
    explorer_tx_base: Optional[str] = None
    wallet_enabled: bool
    custodial_enabled: bool
    abi_fn: str
    base_rpc_url_set: bool


class StarknetConfigResponse(BaseModel):
    rpc_url: Optional[str] = None
    contract: Optional[str] = None
    requires_wallet: bool
    mode: Literal["starknet", "demo"]
    explorer_tx_base: Optional[str] = None
    wallet_enabled: bool


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


@router.get("/attest/config", response_model=AttestConfigResponse)
def read_attest_config(request: Request) -> AttestConfigResponse:
    if is_auth_enabled() and get_request_user(request) is None:
        raise HTTPException(status_code=401, detail="auth_required")

    client = ChainClient()
    config = client.describe_config()
    return AttestConfigResponse(**config)


@router.get("/attest/starknet/config", response_model=StarknetConfigResponse)
def read_starknet_config(request: Request) -> StarknetConfigResponse:
    if is_auth_enabled() and get_request_user(request) is None:
        raise HTTPException(status_code=401, detail="auth_required")

    client = StarknetClient()
    config = client.describe_config()
    return StarknetConfigResponse(**config)


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
                tx_hash=payload.tx_hash,
                signed_tx=payload.signed_tx,
            )
    except AttestationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return AttestResponse(
        tx_hash=result.tx_hash,
        metadata_uri=result.metadata_uri,
        token_id=result.token_id,
        mode=result.mode,
    )


class StarknetAttestRequest(BaseModel):
    tx_hash: Optional[str] = Field(default=None, description="Existing Starknet transaction hash from a wallet submission")


class StarknetAttestResponse(BaseModel):
    tx_hash: str
    metadata_uri: Optional[str] = None
    token_id: Optional[int] = None
    mode: Literal["starknet", "demo"]


@router.post("/releases/{release_id}/attest/starknet", response_model=StarknetAttestResponse)
def attest_release_starknet(release_id: int, payload: StarknetAttestRequest, request: Request) -> StarknetAttestResponse:
    if is_auth_enabled() and get_request_user(request) is None:
        raise HTTPException(status_code=401, detail="auth_required")

    release_info, metadata = _load_release(release_id)

    client = StarknetClient()
    try:
        if payload.tx_hash:
            result: AttestationResult = client.mint_wallet(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
                tx_hash=payload.tx_hash,
            )
        else:
            result = client.send_log(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )
    except AttestationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return StarknetAttestResponse(
        tx_hash=result.tx_hash,
        metadata_uri=result.metadata_uri,
        token_id=result.token_id,
        mode=result.mode if result.mode in {"starknet", "demo"} else "demo",
    )
