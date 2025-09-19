import logging

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

logger = logging.getLogger("routeforge.evidence.routes")

router = APIRouter(prefix="/api", tags=["evidence"])


def error(code: str, status_code: int = 400):
    return json_error(code, status_code=status_code)


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
