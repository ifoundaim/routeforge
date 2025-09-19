import hmac
import logging
import os
from hashlib import sha256
from typing import Optional, Tuple

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


logger = logging.getLogger("routeforge.hmac")


def _constant_time_compare(a: str, b: str) -> bool:
    try:
        return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
    except Exception:
        return False


def verify_hmac(request: Request, body_bytes: bytes, db: Session) -> Tuple[Optional[int], Optional[str]]:
    """Verify HMAC headers and return (user_id, error_code).

    Headers:
    - X-RF-Key: key_id
    - X-RF-Sign: hex(hmac_sha256(secret, body))
    """
    key_id = (request.headers.get("x-rf-key") or request.headers.get("X-RF-Key") or "").strip()
    provided = (request.headers.get("x-rf-sign") or request.headers.get("X-RF-Sign") or "").strip()
    if not key_id or not provided:
        return None, "hmac_required"

    api_key = db.execute(select(models.APIKey).where(models.APIKey.key_id == key_id)).scalar_one_or_none()
    if api_key is None or int(api_key.active or 0) != 1:
        return None, "hmac_invalid"

    computed = hmac.new(api_key.secret_hash.encode("utf-8"), body_bytes, sha256).hexdigest()
    if not _constant_time_compare(computed, provided):
        return None, "hmac_invalid"

    # Update last_used_at best-effort
    try:
        from sqlalchemy import func as sa_func

        api_key.last_used_at = sa_func.now()
        db.add(api_key)
        db.commit()
    except Exception:
        db.rollback()
    return int(api_key.user_id), None


