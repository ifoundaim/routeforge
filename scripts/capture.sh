#!/usr/bin/env bash
set -euo pipefail

# RouteForge demo capture helper
# - Runs the cURL validation pack for agent + API
# - Saves JSON outputs and 302 headers
# - Optionally grabs screenshots via macOS screencapture (if DISPLAY_MODE=browser)

API="http://localhost:${PORT:-8000}"
OUT_DIR="${1:-/Users/matthewreese/Route Forge/assets/demo}"
mkdir -p "$OUT_DIR"

timestamp() { date +"%Y%m%d-%H%M%S"; }
ts=$(timestamp)

echo "Saving demo assets to: $OUT_DIR"

record_json() {
  local name="$1"; shift
  local cmd=("$@")
  echo "→ $name"
  { "${cmd[@]}"; } | tee "$OUT_DIR/$ts-$name.json" >/dev/null
  jq . "$OUT_DIR/$ts-$name.json" || true
}

record_text() {
  local name="$1"; shift
  local cmd=("$@")
  echo "→ $name"
  { "${cmd[@]}"; } | tee "$OUT_DIR/$ts-$name.txt" >/dev/null
  sed -n '1,20p' "$OUT_DIR/$ts-$name.txt" || true
}

# Health
record_json health curl -s "$API/healthz"

# Create project
PROJECT=$(curl -s -X POST "$API/api/projects" -H 'content-type: application/json' \
  -d '{"name":"RouteForge","owner":"routeforge","description":"demo"}')
echo "$PROJECT" | jq . | tee "$OUT_DIR/$ts-project.json" >/dev/null
PROJECT_ID=$(echo "$PROJECT" | jq -r .id)

# Agent publish baseline
record_json agent-publish-1 curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d "{\"project_id\":$PROJECT_ID,\"artifact_url\":\"https://ex.com/app-0.2.0.zip\",\"notes\":\"v0.2.0 improvements\"}"

# Agent publish duplicate (review)
record_json agent-publish-dup curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d "{\"project_id\":$PROJECT_ID,\"artifact_url\":\"https://ex.com/app-0.2.0.zip\",\"notes\":\"v0.2.0 improvements\"}"

# Agent publish force
record_json agent-publish-force curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d "{\"project_id\":$PROJECT_ID,\"artifact_url\":\"https://ex.com/app-0.2.1.zip\",\"notes\":\"v0.2.1 patch\",\"force\":true}"

ROUTE_SLUG=$(jq -r .route.slug "$OUT_DIR/$ts-agent-publish-force.json" 2>/dev/null || echo "")
ROUTE_ID=$(jq -r .route.id "$OUT_DIR/$ts-agent-publish-force.json" 2>/dev/null || echo "")

# Fallback: mint a manual route if slug missing
if [[ -z "$ROUTE_SLUG" || "$ROUTE_SLUG" == "null" ]]; then
  ROUTE="$(curl -s -X POST "$API/api/routes" -H 'content-type: application/json' \
    -d "{\"project_id\":$PROJECT_ID,\"slug\":\"demo\",\"target_url\":\"https://example.com/downloads/latest\"}")"
  echo "$ROUTE" | jq . | tee "$OUT_DIR/$ts-route.json" >/dev/null
  ROUTE_SLUG=$(echo "$ROUTE" | jq -r .slug)
  ROUTE_ID=$(echo "$ROUTE" | jq -r .id)
fi

# 302 redirect headers capture
record_text redirect-302 curl -i "$API/r/$ROUTE_SLUG"

# Hits count
if [[ -n "$ROUTE_ID" && "$ROUTE_ID" != "null" ]]; then
  record_json route-hits curl -s "$API/api/routes/$ROUTE_ID/hits"
  record_json route-stats curl -s "$API/api/routes/$ROUTE_ID/stats"
fi

# Summary stats
record_json stats-summary curl -s "$API/api/stats/summary"

echo "Done. Files written to $OUT_DIR"


