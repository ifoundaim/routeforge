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

echo "jq -r '.evidence_uri' \"$ATT_PATH\""
EURI=$(jq -r '.evidence_uri // empty' "$ATT_PATH")

if [[ -n "$EURI" ]]; then
  echo "Evidence URI: $EURI"
  if [[ "$EURI" == ipfs://* ]]; then
    CID="${EURI#ipfs://}"
    echo "Evidence CID: $CID"
  fi
else
  echo "Evidence URI not found in attestation"
fi

if [[ -z "$SLUG" || "$SLUG" == "null" ]]; then
  SLUG=$(curl -s "$API/api/releases/$REL_ID" | jq -r '.latest_route.slug // empty' 2>/dev/null || echo "")
fi

if [[ -n "$SLUG" && "$SLUG" != "null" ]]; then
  echo "Route Detail: $API/app/routes/$SLUG"
fi

if command -v open >/dev/null 2>&1; then
  OPEN_CMD="open"
elif command -v xdg-open >/dev/null 2>&1; then
  OPEN_CMD="xdg-open"
else
  OPEN_CMD=""
fi

PUBLIC_URL="$API/rel/$REL_ID"
PRESENT_URL="$API/app/dashboard?present=1"

if [[ -n "$OPEN_CMD" ]]; then
  "$OPEN_CMD" "$PUBLIC_URL" >/dev/null 2>&1 || echo "Unable to open $PUBLIC_URL"
  "$OPEN_CMD" "$PRESENT_URL" >/dev/null 2>&1 || echo "Unable to open $PRESENT_URL"
else
  echo "Open manually: $PUBLIC_URL"
  echo "Open manually: $PRESENT_URL"
fi

exit 0
