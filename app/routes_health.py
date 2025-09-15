import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .db import execute_scalar


logger = logging.getLogger("routeforge.health")

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz():
    return {"ok": True}


@router.get("/healthz/db")
def healthz_db():
    try:
        value = execute_scalar("SELECT 1")
        if value == 1:
            return {"db": "ok"}
        return JSONResponse(status_code=503, content={"error": "db_unhealthy", "detail": "unexpected scalar"})
    except Exception as exc:
        logger.exception("DB health check failed: %s", exc)
        return JSONResponse(status_code=503, content={"error": "db_unhealthy", "detail": str(exc)})


