import logging
import os
from typing import Dict, Optional, Tuple, Literal, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from . import models
from .auth.accounts import ensure_demo_user
from .auth.magic import is_auth_enabled
from .db import get_db
from .errors import json_error
from .evidence import build_evidence_zip
from .middleware import get_request_user
from pydantic import BaseModel

logger = logging.getLogger("routeforge.evidence.routes")

router = APIRouter(prefix="/api", tags=["evidence"])


ProviderLiteral = Literal["web3", "pinata"]


class EvidenceStatusResponse(BaseModel):
    ipfs_enabled: bool
    provider: Optional[ProviderLiteral] = None
    cid_persist: bool


def _detect_ipfs_provider() -> Tuple[bool, Optional[ProviderLiteral]]:
    provider = (os.getenv("EVIDENCE_IPFS_PROVIDER") or os.getenv("IPFS_PROVIDER") or "").strip().lower()
    if provider in {"web3", "pinata"}:
        return True, cast(ProviderLiteral, provider)

    if os.getenv("WEB3_STORAGE_TOKEN"):
        return True, "web3"

    if os.getenv("PINATA_JWT") or (os.getenv("PINATA_API_KEY") and os.getenv("PINATA_SECRET_API_KEY")):
        return True, "pinata"

    return False, None


def _cid_persist_enabled() -> bool:
    try:
        return "evidence_ipfs_cid" in models.Release.__table__.columns
    except Exception:
        return False


@router.get("/evidence/status", response_model=EvidenceStatusResponse)
def read_evidence_status() -> EvidenceStatusResponse:
    ipfs_enabled, provider = _detect_ipfs_provider()
    return EvidenceStatusResponse(
        ipfs_enabled=ipfs_enabled,
        provider=provider,
        cid_persist=_cid_persist_enabled(),
    )


def error(code: str, status_code: int = 400):
    return json_error(code, status_code=status_code)


def get_release_evidence_uris(release_id: int, release: Optional[models.Release]) -> Dict[str, str]:
    """Return currently available evidence URIs for a release."""
    app_base = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
    http_uri = f"{app_base}/api/releases/{release_id}/evidence.zip"
    uris: Dict[str, str] = {"http": http_uri}
    if release and getattr(release, "evidence_ipfs_cid", None):
        uris["ipfs"] = f"ipfs://{release.evidence_ipfs_cid}"
    return uris


@router.get("/releases/{release_id}/evidence.zip")
def download_release_evidence(release_id: int, request: Request, db: Session = Depends(get_db)):
    user = get_request_user(request)
    if is_auth_enabled():
        if user is None:
            return error("auth_required", status_code=401)
    else:
        demo = ensure_demo_user(db)
        user = {"user_id": int(demo.id), "email": demo.email, "name": demo.name}
        request.state.user = user

    release = db.get(models.Release, release_id)
    if release is None:
        return error("not_found", status_code=404)

    user_id = None
    if isinstance(user, dict):
        try:
            user_id = int(user.get("user_id"))
        except (TypeError, ValueError):
            user_id = None

    if user_id is not None and release.user_id != user_id:
        return error("not_found", status_code=404)

    try:
        payload = build_evidence_zip(release_id, db)
    except ValueError as exc:
        logger.warning("Failed to build evidence for release %s: %s", release_id, exc)
        return error("not_found", status_code=404)

    filename = f"release-{release_id}-evidence.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=payload, media_type="application/zip", headers=headers)
