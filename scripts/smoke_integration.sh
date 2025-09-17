#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:${PORT:-8000}}"

info() { printf "\n\033[1;34m[info]\033[0m %s\n" "$*"; }
pass() { printf "\033[1;32m[pass]\033[0m %s\n" "$*\n"; }
fail() { printf "\033[1;31m[fail]\033[0m %s\n" "$*\n"; exit 1; }

need() { command -v "$1" >/dev/null || { echo "Missing $1"; exit 1; }; }

need curl
need jq

# --- 1) Sign in two users (dev-login flow) ----------------------------
U1="aim+u1@routeforge.local"
U2="aim+u2@routeforge.local"

COOKIE1="$(mktemp)"; COOKIE2="$(mktemp)"

info "Signing in user1 via dev-login: $U1"
curl -s -c "$COOKIE1" "$API/auth/dev-login?email=$U1" >/dev/null
curl -s -b "$COOKIE1" "$API/auth/me" | jq -e '.email=="'"$U1"'"' >/dev/null || fail "user1 /me mismatch"
pass "user1 signed in"

info "Signing in user2 via dev-login: $U2"
curl -s -c "$COOKIE2" "$API/auth/dev-login?email=$U2" >/dev/null
curl -s -b "$COOKIE2" "$API/auth/me" | jq -e '.email=="'"$U2"'"' >/dev/null || fail "user2 /me mismatch"
pass "user2 signed in"

# --- 2) Each user creates a project -----------------------------------
P1_NAME="Smoke Project U1"
P2_NAME="Smoke Project U2"

info "user1 creates project"
P1_ID=$(
  curl -s -b "$COOKIE1" -H 'Content-Type: application/json' \
    -d '{"name":"'"$P1_NAME"'","owner":"u1","description":"smoke"}' \
    "$API/api/projects" | jq -re '.id'
)
pass "user1 project id=$P1_ID"

info "user2 creates project"
P2_ID=$(
  curl -s -b "$COOKIE2" -H 'Content-Type: application/json' \
    -d '{"name":"'"$P2_NAME"'","owner":"u2","description":"smoke"}' \
    "$API/api/projects" | jq -re '.id'
)
pass "user2 project id=$P2_ID"

# --- 3) Verify access isolation (lists are user-scoped) ---------------
info "verify user1 cannot see user2's project"
U1_LIST=$(curl -s -b "$COOKIE1" "$API/api/projects" | jq -re '.[] | .name' || true)
echo "$U1_LIST" | grep -q "$P2_NAME" && fail "user1 can see user2 project" || pass "user1 cannot see user2 project"

info "verify user2 cannot see user1's project"
U2_LIST=$(curl -s -b "$COOKIE2" "$API/api/projects" | jq -re '.[] | .name' || true)
echo "$U2_LIST" | grep -q "$P1_NAME" && fail "user2 can see user1 project" || pass "user2 cannot see user1 project"

# --- 4) Agent publish under user1 (creates release + route) -----------
SLUG="smoke-launch-$(date +%s)"
ARTIFACT_URL="https://example.com/builds/app-1.0.0.zip"
NOTES="v1.0.0 – integration smoke"

info "agent publish (user1)"
AP_RESP=$(curl -s -b "$COOKIE1" -H 'Content-Type: application/json' -X POST \
  -d '{
        "project_id": '"$P1_ID"',
        "artifact_url": "'"$ARTIFACT_URL"'",
        "notes": "'"$NOTES"'",
        "dry_run": false
      }' \
  "$API/agent/publish")

# Try to grab route id/slug from agent response; fall back to creating route manually if needed
ROUTE_ID=$(jq -er '.route.id // empty' <<<"$AP_RESP" || echo "")
ROUTE_SLUG=$(jq -er '.route.slug // empty' <<<"$AP_RESP" || echo "")

if [[ -z "$ROUTE_ID" || -z "$ROUTE_SLUG" ]]; then
  info "agent response missing route; creating route manually for slug=$SLUG"
  CREATE_ROUTE=$(
    curl -s -b "$COOKIE1" -H 'Content-Type: application/json' -X POST \
      -d '{"project_id":'"$P1_ID"',"slug":"'"$SLUG"'","target_url":"'"$ARTIFACT_URL"'"}' \
      "$API/api/routes"
  )
  ROUTE_ID=$(jq -re '.id' <<<"$CREATE_ROUTE")
  ROUTE_SLUG=$(jq -re '.slug' <<<"$CREATE_ROUTE")
else
  SLUG="$ROUTE_SLUG"
fi

pass "route established id=$ROUTE_ID slug=$ROUTE_SLUG"

# --- Helper to read per-route hit count --------------------------------
get_hits () {
  local rid="$1"
  # Try a route stats endpoint; fall back to overall summary filter
  local n="0"
  # Option A: /api/routes/{id}/stats
  n=$(curl -s -b "$COOKIE1" "$API/api/routes/$rid/stats?days=1" | jq -re '.hits // .total // 0' 2>/dev/null || echo "x")
  if [[ "$n" == "x" || -z "$n" ]]; then
    # Option B: /api/stats/summary then select our route id if present
    n=$(curl -s -b "$COOKIE1" "$API/api/stats/summary?days=1" | jq -re '.routes[]? | select(.id=='"$rid"') | .hits' 2>/dev/null || echo "0")
  fi
  echo "${n:-0}"
}

# --- 5) Assert redirect increments hit count ---------------------------
info "fetch baseline hits for route $ROUTE_ID"
BASE=$(get_hits "$ROUTE_ID")
echo "baseline=$BASE"

info "hit redirect twice with UTM (no auth needed)"
curl -s -o /dev/null -w "%{http_code}\n" -I "$API/r/$ROUTE_SLUG?utm_source=twitter" | tail -n1
curl -s -o /dev/null -w "%{http_code}\n" -I "$API/r/$ROUTE_SLUG?utm_source=twitter" | tail -n1

sleep 2

info "fetch hits after"
AFTER=$(get_hits "$ROUTE_ID")
echo "after=$AFTER"

if [[ "$AFTER" -ge $((BASE+1)) ]]; then
  pass "redirect increased hits (baseline=$BASE → after=$AFTER)"
else
  fail "expected hits to increase (baseline=$BASE, after=$AFTER)"
fi

# --- 6) Final: user2 isolation re-check on routes ----------------------
info "confirm user2 cannot see user1 route"
U2_ROUTES=$(curl -s -b "$COOKIE2" "$API/api/routes" | jq -re '.[] | .id' || true)
echo "$U2_ROUTES" | grep -q "\b$ROUTE_ID\b" && fail "user2 can see user1 route" || pass "user2 cannot see user1 route"

pass "INTEGRATION SMOKE SUCCESS"
