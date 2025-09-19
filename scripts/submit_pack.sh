#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:${PORT:-8000}}"
OUT="${OUT:-out}"
MODE="${MODE:-log}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <release_id> [route-slug]" >&2
  exit 1
fi

REL_ID="$1"
SLUG="${2:-}"
ATT_DIR="$OUT"
mkdir -p "$ATT_DIR"

ATT_PATH="$ATT_DIR/attest_${REL_ID}.json"

RESP=$(curl -s -X POST "$API/api/releases/$REL_ID/attest" -H 'content-type: application/json' -d "{\"mode\":\"$MODE\"}")
if [[ -z "$RESP" ]]; then
  echo "Failed to create attestation payload" >&2
  exit 1
fi

echo "$RESP" | jq . >"$ATT_PATH"

EURI=$(jq -r '.evidence_uri // empty' "$ATT_PATH")
[[ -n "$EURI" ]] && echo "Evidence URI: $EURI"

if [[ -z "$SLUG" || "$SLUG" == "null" ]]; then
  SLUG=$(curl -s "$API/api/releases/$REL_ID" | jq -r '.latest_route.slug // empty' 2>/dev/null || echo "")
fi

if [[ -n "$SLUG" && "$SLUG" != "null" ]]; then
  echo "Route Detail: $API/app/routes/$SLUG"
fi

exit 0
