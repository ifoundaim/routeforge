from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .demo_flags import is_demo
from .middleware import get_request_user
from .auth.magic import is_auth_enabled


router = APIRouter(prefix="/api/ip", tags=["ip"])


class PrepareCopyrightRequest(BaseModel):
    release_id: int


class PrepareCopyrightResponse(BaseModel):
    download_url: str
    receipt: str


@router.post("/copyright/prepare", response_model=PrepareCopyrightResponse)
def prepare_copyright(payload: PrepareCopyrightRequest, request: Request) -> PrepareCopyrightResponse:
    if is_auth_enabled() and get_request_user(request) is None:
        raise HTTPException(status_code=401, detail="auth_required")

    if not is_demo():
        raise HTTPException(status_code=501, detail="Copyright filing not implemented")

    release_id = payload.release_id
    return PrepareCopyrightResponse(
        download_url=f"/downloads/copyright_{release_id}.zip",
        receipt=f"DEMO-CPY-{release_id}",
    )
