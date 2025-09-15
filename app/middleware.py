import logging
import time
import uuid
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


logger = logging.getLogger("routeforge.request")


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
        try:
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
        response.headers["X-Request-ID"] = request_id
        return response


def get_request_id(request: Request) -> str:
    """Helper to read the request id from request.state, if set."""
    return getattr(request.state, "request_id", "")


