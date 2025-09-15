import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


logger = logging.getLogger("routeforge.errors")


def json_error(code: str, *, status_code: int = 400, detail: Optional[str] = None) -> JSONResponse:
    payload: Dict[str, Any] = {"error": code, "detail": detail or code}
    return JSONResponse(status_code=status_code, content=payload)


def _get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "")


def _with_request_id(response: JSONResponse, request: Request) -> JSONResponse:
    request_id = _get_request_id(request)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        status = exc.status_code
        # Map common status codes to canonical error codes
        code_map = {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
            409: "conflict",
            422: "validation_error",
            429: "rate_limited",
        }
        code = code_map.get(status, "http_error")
        detail_str = str(getattr(exc, "detail", code))
        resp = json_error(code, status_code=status, detail=detail_str)
        return _with_request_id(resp, request)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        resp = json_error("validation_error", status_code=422, detail=str(exc))
        return _with_request_id(resp, request)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled server error: %s", exc)
        resp = json_error("internal_error", status_code=500, detail="unexpected server error")
        return _with_request_id(resp, request)


