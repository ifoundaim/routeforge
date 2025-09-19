import os
import time
import threading
from collections import deque
from typing import Deque, Dict, Iterable, List, Optional, Tuple

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from ..middleware import json_error_response


def _now() -> float:
    return time.monotonic()


def _extract_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[0]
    return request.client.host if request.client else "unknown"


class SlidingWindow:
    """Simple sliding-window counter using a deque of timestamps.

    Stores event timestamps (monotonic seconds). Purges entries older than the window.
    """

    def __init__(self, window_seconds: int) -> None:
        self.window_seconds = max(int(window_seconds or 60), 1)
        self._events: Deque[float] = deque()

    def add_and_prune(self, now_value: Optional[float] = None) -> int:
        now_value = now_value or _now()
        self._events.append(now_value)
        cutoff = now_value - self.window_seconds
        while self._events and self._events[0] < cutoff:
            self._events.popleft()
        return len(self._events)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-process IP+path-prefix sliding window limiter.

    - Default limit: 50 requests/min per IP per tracked path prefix.
    - Path prefixes are configurable via RATE_LIMIT_PATH_PREFIXES (comma-separated).
    - Window seconds configurable via RATE_LIMIT_WINDOW_SEC.
    - Limit per window configurable via RATE_LIMIT_LIMIT.
    """

    def __init__(self, app, *, path_prefixes: Optional[Iterable[str]] = None, limit_per_window: Optional[int] = None, window_seconds: Optional[int] = None) -> None:  # type: ignore[no-redef]
        super().__init__(app)
        raw_prefixes = os.getenv("RATE_LIMIT_PATH_PREFIXES", "")
        env_prefixes: List[str] = [p.strip() for p in raw_prefixes.split(",") if p.strip()] if raw_prefixes else []
        self.path_prefixes: Tuple[str, ...] = tuple(dict.fromkeys([*(path_prefixes or ()), *env_prefixes])) or (
            "/r/",
            "/agent/publish",
            "/api/releases/",
        )

        env_limit = int(os.getenv("RATE_LIMIT_LIMIT", "0") or "0")
        env_window = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60") or "60")
        default_limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "50") or "50")
        self.limit_per_window = int(limit_per_window or env_limit or default_limit)
        self.window_seconds = int(window_seconds or env_window or 60)

        self._lock = threading.Lock()
        self._buckets: Dict[Tuple[str, str], SlidingWindow] = {}

    def _match_prefix(self, path: str) -> Optional[str]:
        for prefix in self.path_prefixes:
            if path.startswith(prefix):
                return prefix
        return None

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:  # type: ignore[override]
        # Only enforce on selected path prefixes and for idempotent methods
        prefix = self._match_prefix(request.url.path)
        if prefix and request.method in {"GET", "HEAD", "POST"}:
            key = (_extract_client_ip(request), prefix)
            with self._lock:
                bucket = self._buckets.get(key)
                if bucket is None:
                    bucket = SlidingWindow(self.window_seconds)
                    self._buckets[key] = bucket
                count = bucket.add_and_prune()
                if count > self.limit_per_window:
                    return json_error_response(
                        request,
                        "rate_limited",
                        status_code=429,
                        detail="Too many requests; please slow down.",
                    )

        return await call_next(request)


__all__ = ["RateLimitMiddleware"]


