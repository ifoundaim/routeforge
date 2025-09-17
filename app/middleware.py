import logging
import time
import uuid
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from .errors import json_error
from .auth.magic import get_session_user, is_auth_enabled


logger = logging.getLogger("routeforge.request")

_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Max-Age": "600",
    "Access-Control-Expose-Headers": "X-Request-ID",
}


def _apply_cors_headers(response: Response) -> Response:
    """Ensure permissive CORS headers are present for demo environments."""

    for header, value in _CORS_HEADERS.items():
        response.headers.setdefault(header, value)
    return response


def _attach_request_id(response: Response, request: Request) -> Response:
    request_id = get_request_id(request)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


def json_error_response(
    request: Request,
    code: str,
    *,
    status_code: int = 400,
    detail: Optional[str] = None,
) -> JSONResponse:
    """Create a JSON error response with permissive CORS and X-Request-ID."""

    response = json_error(code, status_code=status_code, detail=detail)
    _attach_request_id(response, request)
    return _apply_cors_headers(response)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request ID to every request and log basic timing.

    - If the client provides `X-Request-ID`, we echo it back; otherwise we generate a UUIDv4.
    - We store the value in `request.state.request_id` and add it to the response header.
    - We log method, path, status code, and elapsed time in milliseconds.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Determine or generate request id
        provided_request_id = request.headers.get("x-request-id") or request.headers.get("X-Request-ID")
        request_id = provided_request_id or str(uuid.uuid4())
        request.state.request_id = request_id

        start_time = time.perf_counter()
        if is_auth_enabled():
            try:
                request.state.user = get_session_user(request)
            except Exception:  # pragma: no cover - defensive guard around cookie parsing
                request.state.user = None
        else:
            request.state.user = None
        try:
            if request.method == "OPTIONS":
                response = Response(status_code=204)
            else:
                response = await call_next(request)
        except Exception:
            # Let FastAPI/Starlette exception handlers produce the JSON error body.
            # We only record timing here and re-raise.
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            logger.exception("Unhandled exception processing request")
            logger.info(
                "method=%s path=%s status=%s ms=%s request_id=%s",
                request.method,
                request.url.path,
                500,
                elapsed_ms,
                request_id,
            )
            raise

        # Timing + logging
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            "method=%s path=%s status=%s ms=%s request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )

        # Echo X-Request-ID
        _attach_request_id(response, request)
        return _apply_cors_headers(response)


def get_request_id(request: Request) -> str:
    """Helper to read the request id from request.state, if set."""
    return getattr(request.state, "request_id", "")


def get_request_user(request: Request):
    """Helper to read the authenticated user from request.state if available."""
    return getattr(request.state, "user", None)
