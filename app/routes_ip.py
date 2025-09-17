from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .demo_flags import is_demo


router = APIRouter(prefix="/api/ip", tags=["ip"])


class PrepareCopyrightRequest(BaseModel):
    release_id: int


class PrepareCopyrightResponse(BaseModel):
    download_url: str
    receipt: str


@router.post("/copyright/prepare", response_model=PrepareCopyrightResponse)
def prepare_copyright(payload: PrepareCopyrightRequest) -> PrepareCopyrightResponse:
    if not is_demo():
        raise HTTPException(status_code=501, detail="Copyright filing not implemented")

    release_id = payload.release_id
    return PrepareCopyrightResponse(
        download_url=f"/downloads/copyright_{release_id}.zip",
        receipt=f"DEMO-CPY-{release_id}",
    )
