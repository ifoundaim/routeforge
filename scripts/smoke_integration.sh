#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:${PORT:-8000}}"

info() { printf "\n\033[1;34m[info]\033[0m %s\n" "$*"; }
pass() { printf "\033[1;32m[pass]\033[0m %s\n" "$*\n"; }
fail() { printf "\033[1;31m[fail]\033[0m %s\n" "$*\n"; exit 1; }

need() { command -v "$1" >/dev/null || { echo "Missing $1"; exit 1; }; }

need curl
need jq

# --- 1) Health check ---------------------------------------------------
info "Testing health endpoints"
curl -s "$API/healthz" | jq -e '.ok==true' >/dev/null || fail "healthz failed"
curl -s "$API/healthz/db" | jq -e '.db=="ok"' >/dev/null || fail "healthz/db failed"
pass "health endpoints OK"

# --- 2) Create a project (no auth needed when AUTH_ENABLED=0) -----------
P1_NAME="Smoke Project $(date +%s)"

info "Creating project: $P1_NAME"
P1_ID=$(
  curl -s -H 'Content-Type: application/json' \
    -d '{"name":"'"$P1_NAME"'","owner":"smoke-test","description":"integration smoke test"}' \
    "$API/api/projects" | jq -re '.id'
)
pass "project created id=$P1_ID"

# --- 3) Create a route directly ----------------------------------------
SLUG="smoke-launch-$(date +%s)"
ARTIFACT_URL="https://example.com/builds/app-1.0.0.zip"

info "Creating route with slug: $SLUG"
CREATE_ROUTE=$(
  curl -s -H 'Content-Type: application/json' -X POST \
    -d '{"project_id":'"$P1_ID"',"slug":"'"$SLUG"'","target_url":"'"$ARTIFACT_URL"'"}' \
    "$API/api/routes"
)
ROUTE_ID=$(jq -re '.id' <<<"$CREATE_ROUTE")
ROUTE_SLUG=$(jq -re '.slug' <<<"$CREATE_ROUTE")
pass "route created id=$ROUTE_ID slug=$ROUTE_SLUG"

# --- 4) Test redirect functionality ------------------------------------
info "Testing redirect (should return 302)"
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "$API/r/$ROUTE_SLUG")
if [[ "$REDIRECT_STATUS" == "302" ]]; then
  pass "redirect returns 302"
else
  fail "expected 302, got $REDIRECT_STATUS"
fi

# --- 5) Test analytics endpoints ---------------------------------------
info "Testing stats summary"
SUMMARY=$(curl -s "$API/api/stats/summary")
echo "$SUMMARY" | jq -e '.total_clicks >= 0' >/dev/null || fail "stats summary missing total_clicks"
echo "$SUMMARY" | jq -e '.unique_routes >= 0' >/dev/null || fail "stats summary missing unique_routes"
pass "stats summary OK"

info "Testing route hits endpoint"
HITS_RESPONSE=$(curl -s "$API/api/routes/$ROUTE_ID/hits")
echo "$HITS_RESPONSE" | jq -e '.count >= 0' >/dev/null || fail "hits endpoint missing count"
pass "route hits endpoint OK"

# --- 6) Test agent publish endpoint ------------------------------------
info "Testing agent publish endpoint"
AP_RESP=$(curl -s -H 'Content-Type: application/json' -X POST \
  -d '{
        "project_id": '"$P1_ID"',
        "artifact_url": "'"$ARTIFACT_URL"'",
        "notes": "v1.0.0 – integration smoke test",
        "dry_run": false
      }' \
  "$API/agent/publish")

echo "$AP_RESP" | jq -e '.decision' >/dev/null || fail "agent publish missing decision"
pass "agent publish endpoint OK"

# --- 7) Test CSV export ------------------------------------------------
info "Testing CSV export"
CSV_RESPONSE=$(curl -s "$API/api/routes/$ROUTE_ID/export.csv?limit=5")
if echo "$CSV_RESPONSE" | grep -q "ts,ip,ua,ref"; then
  pass "CSV export has correct header"
else
  fail "CSV export missing expected header"
fi

pass "INTEGRATION SMOKE SUCCESS"
