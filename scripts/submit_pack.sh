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

# Generate OG preview image next to other artifacts
ART_DIR="artifacts"
mkdir -p "$ART_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/og_preview.sh" "$REL_ID" || echo "OG preview generation failed" >&2

# Capture config snapshots
ATTEST_CFG_PATH="$ART_DIR/attest_config.json"
EVIDENCE_CFG_PATH="$ART_DIR/evidence_config.json"

curl --fail --silent --show-error "$API/api/attest/config" | jq . > "$ATTEST_CFG_PATH" || echo "Failed to fetch /api/attest/config" >&2
curl --fail --silent --show-error "$API/api/evidence/status" | jq . > "$EVIDENCE_CFG_PATH" || echo "Failed to fetch /api/evidence/status" >&2

# Print wallet vs custodial + IPFS status
if [[ -s "$ATTEST_CFG_PATH" ]]; then
  REQUIRES_WALLET=$(jq -r '.requires_wallet' "$ATTEST_CFG_PATH" 2>/dev/null || echo "")
  WALLET_ENABLED=$(jq -r '.wallet_enabled' "$ATTEST_CFG_PATH" 2>/dev/null || echo "")
  CUSTODIAL_ENABLED=$(jq -r '.custodial_enabled' "$ATTEST_CFG_PATH" 2>/dev/null || echo "")
  MODE_VAL=$(jq -r '.mode' "$ATTEST_CFG_PATH" 2>/dev/null || echo "")
  echo "Wallet: wallet_enabled=${WALLET_ENABLED}, custodial_enabled=${CUSTODIAL_ENABLED}, requires_wallet=${REQUIRES_WALLET} (mode=${MODE_VAL})"
fi

if [[ -s "$EVIDENCE_CFG_PATH" ]]; then
  IPFS_ENABLED=$(jq -r '.ipfs_enabled' "$EVIDENCE_CFG_PATH" 2>/dev/null || echo "")
  IPFS_PROVIDER=$(jq -r '.provider // "none"' "$EVIDENCE_CFG_PATH" 2>/dev/null || echo "")
  CID_PERSIST=$(jq -r '.cid_persist' "$EVIDENCE_CFG_PATH" 2>/dev/null || echo "")
  echo "IPFS: enabled=${IPFS_ENABLED}, provider=${IPFS_PROVIDER}, cid_persist=${CID_PERSIST}"
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
