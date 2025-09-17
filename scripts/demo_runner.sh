#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON:-python3}"
DEFAULT_PORT="${PORT:-8000}"
API_BASE="${ROUTEFORGE_BASE_URL:-http://localhost:${DEFAULT_PORT}}"
APP_BASE="${ROUTEFORGE_APP_BASE_URL:-$API_BASE}"
PRIMARY_SLUG="${ROUTEFORGE_PRIMARY_SLUG:-routeforge-demo-1-2-0}"
PROJECT_ID="${ROUTEFORGE_PRIMARY_PROJECT_ID:-}"
ROUTE_ID="${ROUTEFORGE_PRIMARY_ROUTE_ID:-}"
DELAY="${DEMO_RUNNER_DELAY:-2}"

usage() {
  cat <<USAGE
Launch RouteForge demo views in sequence for recording.

Usage: $(basename "$0") [options]

Options:
  --base-url URL      Override both API and app base URL.
  --api-base URL      Override only the API base URL.
  --app-base URL      Override only the app base URL (browser views).
  --slug SLUG         Route slug to open (default: ${PRIMARY_SLUG}).
  --project-id ID     Project id for /app/projects/<id> (env ROUTEFORGE_PRIMARY_PROJECT_ID).
  --route-id ID       Route id for /app/routes/<id> (auto-resolved when omitted).
  --delay SECONDS     Pause between launches (default from DEMO_RUNNER_DELAY or 2).
  -h, --help          Show this help message.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      shift
      [[ $# -gt 0 ]] || { echo "--base-url requires a value" >&2; exit 1; }
      API_BASE="$1"
      APP_BASE="$1"
      ;;
    --api-base)
      shift
      [[ $# -gt 0 ]] || { echo "--api-base requires a value" >&2; exit 1; }
      API_BASE="$1"
      ;;
    --app-base)
      shift
      [[ $# -gt 0 ]] || { echo "--app-base requires a value" >&2; exit 1; }
      APP_BASE="$1"
      ;;
    --slug)
      shift
      [[ $# -gt 0 ]] || { echo "--slug requires a value" >&2; exit 1; }
      PRIMARY_SLUG="$1"
      ;;
    --project-id)
      shift
      [[ $# -gt 0 ]] || { echo "--project-id requires a value" >&2; exit 1; }
      PROJECT_ID="$1"
      ;;
    --route-id)
      shift
      [[ $# -gt 0 ]] || { echo "--route-id requires a value" >&2; exit 1; }
      ROUTE_ID="$1"
      ;;
    --delay)
      shift
      [[ $# -gt 0 ]] || { echo "--delay requires a value" >&2; exit 1; }
      DELAY="$1"
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

trim_trailing_slash() {
  local value="$1"
  while [[ "$value" == */ && "$value" != "//" && "$value" != "http://" && "$value" != "https://" ]]; do
    value="${value%/}"
  done
  printf '%s' "$value"
}

API_BASE=$(trim_trailing_slash "$API_BASE")
APP_BASE=$(trim_trailing_slash "$APP_BASE")

curl_bin="${CURL_BIN:-curl}"
if ! command -v "$curl_bin" >/dev/null 2>&1; then
  echo "curl binary '$curl_bin' not found" >&2
  exit 1
fi

if ! [[ "$DELAY" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Delay must be numeric (seconds)." >&2
  exit 1
fi

if [[ -n "$PROJECT_ID" ]]; then
  if ! [[ "$PROJECT_ID" =~ ^[0-9]+$ ]]; then
    echo "Project id must be numeric." >&2
    exit 1
  fi
fi

if [[ -n "$ROUTE_ID" ]]; then
  if ! [[ "$ROUTE_ID" =~ ^[0-9]+$ ]]; then
    echo "Route id must be numeric." >&2
    exit 1
  fi
fi

status_code() {
  local url="$1"
  shift
  local code
  code=$("$curl_bin" -sS -o /dev/null -w '%{http_code}' "$url" "$@" 2>/dev/null) || code="000"
  printf '%s' "$code"
}

request() {
  local url="$1"
  shift
  "$curl_bin" -sS -f "$url" "$@"
}

lookup_route_from_summary() {
  local summary_json="$1"
  "$PYTHON_BIN" - "$summary_json" "$PRIMARY_SLUG" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
slug = sys.argv[2]
routes = payload.get("top_routes") or []
if not isinstance(routes, list):
    raise SystemExit("stats summary top_routes not a list")
for entry in routes:
    if entry.get("slug") == slug:
        route_id = entry.get("route_id")
        if route_id is None:
            raise SystemExit("matching top route missing route_id")
        clicks = int(entry.get("clicks", 0))
        print(f"{route_id}|{clicks}")
        break
else:
    raise SystemExit(f"slug {slug} not present in stats top_routes")
PY
}

detect_launcher() {
  if command -v open >/dev/null 2>&1; then
    LAUNCH_CMD=(open)
    LAUNCH_LABEL="open"
    return
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    LAUNCH_CMD=(xdg-open)
    LAUNCH_LABEL="xdg-open"
    return
  fi
  if command -v powershell.exe >/dev/null 2>&1; then
    LAUNCH_CMD=(powershell.exe Start-Process)
    LAUNCH_LABEL="powershell.exe Start-Process"
    return
  fi
  echo "No supported browser launcher found (install open or xdg-open)." >&2
  exit 1
}

detect_launcher

HEALTH_STATUS=$(status_code "$API_BASE/healthz")
DB_STATUS=$(status_code "$API_BASE/healthz/db")
if [[ "$HEALTH_STATUS" != "200" || "$DB_STATUS" != "200" ]]; then
  echo "Service health checks failed (healthz=$HEALTH_STATUS healthz/db=$DB_STATUS)." >&2
  exit 1
fi

declare ROUTE_SUMMARY_CLICKS=""
if [[ -z "$ROUTE_ID" ]]; then
  SUMMARY_JSON=$(request "$API_BASE/api/stats/summary?days=30")
  SUMMARY_FIELDS=$(lookup_route_from_summary "$SUMMARY_JSON")
  IFS='|' read -r ROUTE_ID ROUTE_SUMMARY_CLICKS <<< "$SUMMARY_FIELDS"
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "Project id required; set ROUTEFORGE_PRIMARY_PROJECT_ID or pass --project-id." >&2
  exit 1
fi

ROUTE_HITS=""
if [[ -n "$ROUTE_ID" ]]; then
  HITS_JSON=$(request "$API_BASE/api/routes/$ROUTE_ID/hits")
  ROUTE_HITS=$("$PYTHON_BIN" - "$HITS_JSON" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
print(int(payload.get("count", 0)))
PY
  )
else
  echo "Unable to resolve route id for slug '$PRIMARY_SLUG'." >&2
  exit 1
fi

APP_HOME_URL="$APP_BASE/app"
PROJECT_URL="$APP_BASE/app/projects/$PROJECT_ID"
REDIRECT_URL="$API_BASE/r/$PRIMARY_SLUG"
ROUTE_DETAIL_URL="$APP_BASE/app/routes/$ROUTE_ID"

printf 'Launcher: %s\n' "$LAUNCH_LABEL"
printf 'API base: %s\n' "$API_BASE"
printf 'App base: %s\n' "$APP_BASE"
printf 'Slug: %s (route id %s, summary clicks %s, hits %s)\n' \
  "$PRIMARY_SLUG" "$ROUTE_ID" "${ROUTE_SUMMARY_CLICKS:-?}" "${ROUTE_HITS:-?}"
printf 'Project id: %s\n' "$PROJECT_ID"

open_url() {
  local label="$1"
  local url="$2"
  printf '→ %s: %s\n' "$label" "$url"
  if ! "${LAUNCH_CMD[@]}" "$url" >/dev/null 2>&1; then
    echo "Failed to launch $label ($url)." >&2
    exit 1
  fi
  sleep "$DELAY"
}

open_url "App Dashboard" "$APP_HOME_URL"
open_url "Project Detail" "$PROJECT_URL"
open_url "Redirect" "$REDIRECT_URL"
open_url "Route Analytics" "$ROUTE_DETAIL_URL"

printf 'Demo runner complete.\n'
