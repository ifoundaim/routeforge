#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"
DEFAULT_PORT="${PORT:-8000}"
API_BASE="${ROUTEFORGE_BASE_URL:-http://localhost:${DEFAULT_PORT}}"
PRIMARY_SLUG="${ROUTEFORGE_PRIMARY_SLUG:-routeforge-demo-1-2-0}"

usage() {
  cat <<USAGE
Validate the RouteForge demo dataset end-to-end.

Usage: $(basename "$0") [--base-url URL] [--slug SLUG]

Options:
  --base-url URL   Override the API base URL (default: ${API_BASE}).
  --slug SLUG      Demo route slug to exercise (default: ${PRIMARY_SLUG}).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      shift
      [[ $# -gt 0 ]] || { echo "--base-url requires a value" >&2; exit 1; }
      API_BASE="$1"
      ;;
    --slug)
      shift
      [[ $# -gt 0 ]] || { echo "--slug requires a value" >&2; exit 1; }
      PRIMARY_SLUG="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

curl_bin="${CURL_BIN:-curl}"

request() {
  local url="$1"
  shift
  "$curl_bin" -sS -f "$url" "$@"
}

status_code() {
  local url="$1"
  shift
  local code
  code=$("$curl_bin" -sS -o /dev/null -w '%{http_code}' "$url" "$@" 2>/dev/null) || code="000"
  printf '%s' "$code"
}

extract_hits_count() {
  local json_payload="$1"
  "$PYTHON_BIN" - "$json_payload" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if "count" not in payload:
    raise SystemExit("hits response missing count")
print(int(payload.get("count", 0)))
PY
}

extract_summary_clicks() {
  local json_payload="$1"
  "$PYTHON_BIN" - "$json_payload" "$PRIMARY_SLUG" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
slug = sys.argv[2]
total_clicks = int(payload.get("total_clicks", 0))
routes = payload.get("top_routes") or []
if not isinstance(routes, list):
    raise SystemExit("stats summary top_routes not a list")
route_clicks = 0
for entry in routes:
    if entry.get("slug") == slug:
        route_clicks = int(entry.get("clicks", 0))
        break
print(f"{total_clicks}|{route_clicks}")
PY
}

printf '1) Health endpoints... '
HEALTH_STATUS=$(status_code "$API_BASE/healthz")
DB_STATUS=$(status_code "$API_BASE/healthz/db")
printf 'healthz=%s healthz/db=%s\n' "$HEALTH_STATUS" "$DB_STATUS"

if [[ "$HEALTH_STATUS" != "200" || "$DB_STATUS" != "200" ]]; then
  echo "health endpoints unhealthy" >&2
  exit 1
fi

HEALTH_JSON=$(request "$API_BASE/healthz")
"$PYTHON_BIN" - "$HEALTH_JSON" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("ok") is not True:
    raise SystemExit("healthz missing ok=true")
PY

printf '2) Stats snapshot (pre)... '
SUMMARY_JSON=$(request "$API_BASE/api/stats/summary?days=30")
SUMMARY_FIELDS=$("$PYTHON_BIN" - "$SUMMARY_JSON" "$PRIMARY_SLUG" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
slug = sys.argv[2]
for key in ("total_clicks", "unique_routes", "top_routes"):
    if key not in payload:
        raise SystemExit(f"stats summary missing {key}")
if not isinstance(payload["top_routes"], list):
    raise SystemExit("stats summary top_routes not a list")

route_id = None
route_clicks = None
for entry in payload["top_routes"]:
    if entry.get("slug") == slug:
        route_id = entry.get("route_id")
        if route_id is None:
            raise SystemExit("matching top route missing route_id")
        route_clicks = int(entry.get("clicks", 0))
        break

if route_id is None:
    raise SystemExit(f"slug {slug} not present in stats top_routes")

total_clicks = int(payload.get("total_clicks", 0))
print(f"{route_id}|{total_clicks}|{route_clicks or 0}")
PY
)
IFS='|' read -r ROUTE_ID TOTAL_CLICKS_BEFORE ROUTE_CLICKS_BEFORE <<< "$SUMMARY_FIELDS"
printf 'slug=%s route_id=%s total_clicks=%s route_clicks=%s\n' \
  "$PRIMARY_SLUG" "$ROUTE_ID" "$TOTAL_CLICKS_BEFORE" "$ROUTE_CLICKS_BEFORE"

printf '3) Hits before redirect... '
HITS_BEFORE_JSON=$(request "$API_BASE/api/routes/$ROUTE_ID/hits")
HITS_BEFORE=$(extract_hits_count "$HITS_BEFORE_JSON")
printf '%s\n' "$HITS_BEFORE"

printf '4) Trigger redirect... '
STATUS=$($curl_bin -sS -o /dev/null -w '%{http_code}' \
  -H 'User-Agent: RouteForgeValidator/1.0' \
  -H 'Referer: https://demo.routeforge.ai/?utm_source=validator&utm_medium=cli' \
  "$API_BASE/r/$PRIMARY_SLUG")
if [[ "$STATUS" != "302" ]]; then
  echo "expected 302, got $STATUS" >&2
  exit 1
fi
printf '302\n'

printf '5) Hits after redirect... '
EXPECTED_HITS=$((HITS_BEFORE + 1))
deadline=$((SECONDS + 10))
HITS_AFTER="$HITS_BEFORE"
while (( SECONDS <= deadline )); do
  HITS_AFTER_JSON=$(request "$API_BASE/api/routes/$ROUTE_ID/hits")
  HITS_AFTER=$(extract_hits_count "$HITS_AFTER_JSON")
  if (( HITS_AFTER >= EXPECTED_HITS )); then
    break
  fi
  sleep 1
done
printf '%s\n' "$HITS_AFTER"

if (( HITS_AFTER < EXPECTED_HITS )); then
  echo "hit counter did not increment within 10s (before=$HITS_BEFORE after=$HITS_AFTER)" >&2
  exit 1
fi

printf '6) Summary after redirect... '
EXPECTED_TOTAL=$((TOTAL_CLICKS_BEFORE + 1))
EXPECTED_ROUTE_CLICKS=$((ROUTE_CLICKS_BEFORE + 1))
deadline=$((SECONDS + 10))
TOTAL_CLICKS_AFTER="$TOTAL_CLICKS_BEFORE"
ROUTE_CLICKS_AFTER="$ROUTE_CLICKS_BEFORE"
while (( SECONDS <= deadline )); do
  SUMMARY_JSON_AFTER=$(request "$API_BASE/api/stats/summary?days=30")
  SUMMARY_COUNTS=$(extract_summary_clicks "$SUMMARY_JSON_AFTER")
  IFS='|' read -r TOTAL_CLICKS_AFTER ROUTE_CLICKS_AFTER <<< "$SUMMARY_COUNTS"
  if (( TOTAL_CLICKS_AFTER >= EXPECTED_TOTAL && ROUTE_CLICKS_AFTER >= EXPECTED_ROUTE_CLICKS )); then
    break
  fi
  sleep 1
done
printf 'total=%s route=%s\n' "$TOTAL_CLICKS_AFTER" "$ROUTE_CLICKS_AFTER"

if (( TOTAL_CLICKS_AFTER < EXPECTED_TOTAL || ROUTE_CLICKS_AFTER < EXPECTED_ROUTE_CLICKS )); then
  echo "summary counts did not increment within 10s (total_before=$TOTAL_CLICKS_BEFORE route_before=$ROUTE_CLICKS_BEFORE total_after=$TOTAL_CLICKS_AFTER route_after=$ROUTE_CLICKS_AFTER)" >&2
  exit 1
fi

printf '7) CSV export head...\n'
TMP_CSV=$(mktemp)
trap 'rm -f "$TMP_CSV"' EXIT
request "$API_BASE/api/routes/$ROUTE_ID/export.csv?limit=25" > "$TMP_CSV"
"$PYTHON_BIN" - "$TMP_CSV" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
lines = [line.rstrip('\n') for line in text.splitlines() if line.strip()]
if not lines:
    raise SystemExit("empty CSV export")
if lines[0] != "ts,ip,ua,ref":
    raise SystemExit("unexpected CSV header")
if len(lines) < 2:
    raise SystemExit("CSV export missing data rows")
for line in lines[:5]:
    print(line)
PY

printf 'Demo validation OK\n'
