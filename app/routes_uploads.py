import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .storage.s3 import S3ConfigError, presign_put

logger = logging.getLogger("routeforge.uploads")

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class PresignRequest(BaseModel):
    filename: str = Field(..., max_length=512)
    type: Optional[str] = Field(None, alias="type", max_length=200)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def _sanitize_filename(filename: str) -> Tuple[str, str]:
    name = Path(filename).name
    if not name:
        return "artifact", ""
    stem, suffix = os.path.splitext(name)
    cleaned = _FILENAME_SAFE.sub("-", stem).strip("-._")
    if not cleaned:
        cleaned = "artifact"
    if len(cleaned) > 80:
        cleaned = cleaned[:80].rstrip("-._") or "artifact"
    suffix = (suffix or "").lower()[:16]
    return cleaned, suffix


def _generate_key(filename: str) -> str:
    cleaned, suffix = _sanitize_filename(filename)
    timestamp = datetime.utcnow().strftime("%Y/%m/%d")
    unique = uuid.uuid4().hex
    return f"artifacts/{timestamp}/{unique}-{cleaned}{suffix}"


@router.post("/presign")
def create_presigned_upload(payload: PresignRequest):
    filename = payload.filename.strip()
    if not filename:
        raise HTTPException(status_code=422, detail="filename_required")

    content_type = (payload.type or "application/octet-stream").strip()
    if not content_type:
        content_type = "application/octet-stream"

    key = _generate_key(filename)
    try:
        presigned = presign_put(key, content_type)
    except S3ConfigError as exc:
        logger.error("S3 configuration error: %s", exc)
        raise HTTPException(status_code=500, detail="s3_config_error") from exc
    except Exception:
        logger.exception("Failed to create presigned upload for key %s", key)
        raise HTTPException(status_code=500, detail="upload_presign_failed") from None

    return presigned
