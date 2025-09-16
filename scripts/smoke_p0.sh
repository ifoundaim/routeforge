#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_URL="${API_URL:-$BASE_URL/api}"

run_request() {
  local method=$1
  local url=$2
  local data=${3-}
  local tmp
  tmp=$(mktemp)
  if [[ -n $data ]]; then
    STATUS=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" -H 'Content-Type: application/json' "$url" -d "$data")
  else
    STATUS=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url")
  fi
  BODY=$(cat "$tmp")
  rm -f "$tmp"
}

assert_status() {
  local expected=$1
  local actual=$2
  local label=$3
  if [[ $actual != "$expected" ]]; then
    echo "[FAIL] $label expected $expected got $actual" >&2
    echo "$BODY" >&2
    exit 1
  fi
}

jq_field() {
  local key=$1
  local payload
  payload=$(cat)
  KEY="$key" PAYLOAD="$payload" python - <<'PY'
import json, os, sys
key = os.environ["KEY"]
raw = os.environ.get("PAYLOAD", "").strip()
if not raw:
    sys.exit('empty body')
try:
    data = json.loads(raw)
except Exception as exc:
    sys.exit(f'failed to parse json: {exc}')
value = data.get(key)
if value is None:
    sys.exit(f'missing field: {key}')
print(value)
PY
}

echo "BASE_URL=$BASE_URL"

echo "== Health checks =="
run_request GET "$BASE_URL/healthz"
echo "/healthz HTTP $STATUS"
echo "$BODY"
assert_status 200 "$STATUS" "/healthz"

run_request GET "$BASE_URL/healthz/db"
echo "/healthz/db HTTP $STATUS"
echo "$BODY"
assert_status 200 "$STATUS" "/healthz/db"

slug="smoke-$(date +%s)-$RANDOM"
project_payload=$(printf '{"name":"Smoke %s","owner":"smoke@routeforge.test"}' "$slug")
run_request POST "$API_URL/projects" "$project_payload"
echo "create project HTTP $STATUS"
echo "$BODY"
assert_status 201 "$STATUS" "create project"
project_id=$(printf '%s' "$BODY" | jq_field id)

release_payload=$(printf '{"project_id":%s,"version":"1.0.0","artifact_url":"https://example.com/artifact-%s"}' "$project_id" "$slug")
run_request POST "$API_URL/releases" "$release_payload"
echo "create release HTTP $STATUS"
echo "$BODY"
assert_status 201 "$STATUS" "create release"
release_id=$(printf '%s' "$BODY" | jq_field id)

route_payload=$(printf '{"project_id":%s,"release_id":%s,"slug":"%s","target_url":"https://example.com/demo/%s"}' "$project_id" "$release_id" "$slug" "$slug")
run_request POST "$API_URL/routes" "$route_payload"
echo "create route HTTP $STATUS"
echo "$BODY"
assert_status 201 "$STATUS" "create route"

run_request POST "$API_URL/routes" "$route_payload"
echo "duplicate slug HTTP $STATUS"
echo "$BODY"
assert_status 409 "$STATUS" "duplicate slug"

bad_slug_payload=$(printf '{"project_id":%s,"slug":"@@","target_url":"https://example.com"}' "$project_id")
run_request POST "$API_URL/routes" "$bad_slug_payload"
echo "invalid slug HTTP $STATUS"
echo "$BODY"
assert_status 422 "$STATUS" "invalid slug"

bad_url_payload=$(printf '{"project_id":%s,"slug":"%s-bad","target_url":"ftp://example.com"}' "$project_id" "$slug")
run_request POST "$API_URL/routes" "$bad_url_payload"
echo "invalid url HTTP $STATUS"
echo "$BODY"
assert_status 422 "$STATUS" "invalid url"

redirect_url="$BASE_URL/r/$slug"
echo "== Redirect burst =="
for i in {1..5}; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$redirect_url")
  echo "redirect#$i HTTP $code"
  if (( i <= 3 )) && [[ $code != 302 ]]; then
    echo "[FAIL] redirect#$i expected 302" >&2
    exit 1
  fi
  if [[ $code == 500 ]]; then
    echo "[FAIL] redirect#$i returned 500" >&2
    exit 1
  fi
  if (( i > 3 )) && [[ $code != 302 && $code != 429 ]]; then
    echo "[WARN] redirect#$i unexpected code $code" >&2
  fi
  sleep 0.2
done

echo "Smoke P0 checks complete"
