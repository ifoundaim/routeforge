from __future__ import annotations

from typing import Optional, Tuple, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.responses import Response

from . import models, schemas
from .auth.accounts import ensure_demo_user
from .auth.magic import SessionUser, is_auth_enabled
from .db import get_db
from .guards import require_owner
from .licenses import (
    CUSTOM_LICENSE_CODE,
    get_license_info,
    is_supported_license_code,
    normalize_license_code,
)
from .middleware import get_request_user, json_error_response

router = APIRouter(prefix="/api", tags=["releases"])


def error(request: Request, code: str, status_code: int = 400, detail: Optional[str] = None):
    return json_error_response(request, code, status_code=status_code, detail=detail)


def _require_user(request: Request, db: Session) -> Tuple[SessionUser, Optional[Response]]:
    user = get_request_user(request)
    if is_auth_enabled():
        if user is None:
            failure = error(request, "auth_required", status_code=401, detail="Authentication required.")
            return cast(SessionUser, {}), failure
        return cast(SessionUser, user), None

    demo = ensure_demo_user(db)
    demo_user: SessionUser = {
        "user_id": int(demo.id),
        "email": demo.email,
        "name": demo.name,
    }
    request.state.user = demo_user
    return demo_user, None


def _require_user_id(request: Request, session_user: SessionUser) -> Tuple[Optional[int], Optional[Response]]:
    raw_user_id = None
    if isinstance(session_user, dict):
        raw_user_id = session_user.get("user_id")
    else:
        raw_user_id = getattr(session_user, "user_id", None)
    if raw_user_id is None:
        return None, error(request, "auth_required", status_code=401, detail="Authentication required.")
    try:
        return int(raw_user_id), None
    except (TypeError, ValueError):
        return None, error(request, "auth_required", status_code=401, detail="Authentication required.")


@router.patch("/releases/{release_id}/license", response_model=schemas.ReleaseLicenseOut)
def update_release_license(
    release_id: int,
    payload: schemas.ReleaseLicenseUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    session_user, failure = _require_user(request, db)
    if failure is not None:
        return failure

    current_user_id, failure = _require_user_id(request, session_user)
    if failure is not None:
        return failure

    release = db.get(models.Release, release_id)
    failure = require_owner(
        release,
        request,
        session_user,
        missing_code="release_not_found",
        mismatch_code="forbidden",
        mismatch_status=403,
        mismatch_detail="Release ownership mismatch.",
    )
    if failure is not None:
        return failure

    if release.user_id != current_user_id:
        return error(request, "forbidden", status_code=403)

    normalized_code = normalize_license_code(payload.license_code)
    if not normalized_code:
        return error(request, "invalid_license_code", status_code=422, detail="License code is required.")
    if not is_supported_license_code(normalized_code):
        return error(request, "unsupported_license_code", status_code=422, detail="Unsupported license code.")

    custom_text_value = payload.custom_text.strip() if isinstance(payload.custom_text, str) else None
    if normalized_code == CUSTOM_LICENSE_CODE:
        if not custom_text_value:
            return error(request, "custom_license_text_required", status_code=422, detail="Custom license text is required.")
        release.license_custom_text = custom_text_value
    else:
        release.license_custom_text = None

    release.license_code = normalized_code
    db.add(release)
    db.commit()
    db.refresh(release)

    license_info = get_license_info(release.license_code)

    return schemas.ReleaseLicenseOut(
        license_code=release.license_code,
        license_custom_text=release.license_custom_text,
        license_url=license_info.url if license_info else None,
    )
