# Critical P0 Bug Log

## OPTIONS preflight failing with 405
- Symptom: Browser demo could not call authenticated APIs because cross-origin preflight requests returned 405 without CORS headers.
- Repro: `curl -s -o /dev/null -w "%{http_code}" -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST" http://localhost:8000/api/routes` → 405
- Fix: `RequestContextMiddleware` now short-circuits `OPTIONS` with a 204 and guarantees permissive CORS headers on every response.

## JSON errors missing X-Request-ID and CORS
- Symptom: API/redirect failures broke downstream telemetry because error payloads omitted `X-Request-ID` and were not CORS-safe.
- Repro: `curl -s -D - -X POST -H "Content-Type: application/json" http://localhost:8000/api/routes -d '{}'` → header list lacks `X-Request-ID`.
- Fix: Introduced `json_error_response` helper so all handlers emit normalized JSON errors with the request id and demo CORS headers.

## Redirect rate limit blocking fresh sessions
- Symptom: Demo redirect page rate-limited users on the second hit when `RATE_LIMIT_BURST` was set below 3.
- Repro: `for i in {1..3}; do curl -I http://localhost:8000/r/demo; done` → 429 on request #2.
- Fix: Token bucket enforces a minimum burst of three per IP and clamps refill parameters, eliminating false positives.

## Analytics stats crashing on blank ref strings
- Symptom: `/api/routes/{id}/stats` intermittently returned 500 when a stored hit had an empty or byte-string referrer value.
- Repro: Insert a `RouteHit` row with `ref=''` then request `/api/routes/<id>/stats` → server traceback from `decode_ref` expecting string keys.
- Fix: Added `_coerce_ref` utilities that sanitize/skip blank refs before aggregating and guard `decode_ref` usage.
