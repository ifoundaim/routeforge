"""Reusable authorization helpers."""

from __future__ import annotations

from typing import Optional

from fastapi import Request
from starlette.responses import Response

from .auth.magic import SessionUser
from .middleware import json_error_response


def require_owner(
    resource,
    request: Request,
    session_user: SessionUser,
    *,
    missing_code: str = "not_found",
    missing_status: int = 404,
    missing_detail: Optional[str] = None,
    mismatch_code: Optional[str] = None,
    mismatch_status: int = 403,
    mismatch_detail: Optional[str] = None,
) -> Optional[Response]:
    """Ensure the given ORM resource belongs to the session user.

    Returns a JSON error response if the resource is missing or owned by another
    user. A ``None`` result indicates the caller may proceed. ``mismatch_code``
    controls whether a distinct error code/status is used for ownership
    mismatches (defaults to the missing-code behaviour when absent).
    """

    if resource is None:
        return json_error_response(
            request,
            missing_code,
            status_code=missing_status,
            detail=missing_detail,
        )

    owner_raw = getattr(resource, "user_id", None)
    expected_raw = session_user.get("user_id") if isinstance(session_user, dict) else None
    try:
        owner_id = int(owner_raw) if owner_raw is not None else None
        expected_id = int(expected_raw) if expected_raw is not None else None
    except (TypeError, ValueError):  # pragma: no cover - defensive guard
        owner_id = None
        expected_id = None

    if owner_id is None or expected_id is None or owner_id != expected_id:
        if mismatch_code is None:
            return json_error_response(
                request,
                missing_code,
                status_code=missing_status,
                detail=missing_detail,
            )
        return json_error_response(
            request,
            mismatch_code,
            status_code=mismatch_status,
            detail=mismatch_detail,
        )

    return None


__all__ = ["require_owner"]
