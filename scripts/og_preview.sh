#!/usr/bin/env bash
set -euo pipefail

REL="${1:-}"
if [[ -z "${REL}" ]]; then
  echo "Usage: $0 <release-id>" >&2
  exit 1
fi

DEFAULT_PORT="${PORT:-8000}"
DEFAULT_API="http://localhost:${DEFAULT_PORT}"
API_BASE="${API:-$DEFAULT_API}"
# Trim any trailing slash to avoid double slashes when building the URL.
API_BASE="${API_BASE%/}"

OUTPUT_DIR="artifacts"
mkdir -p "${OUTPUT_DIR}"
OUTPUT_PATH="${OUTPUT_DIR}/og_release_${REL}.png"

OG_URL="${API_BASE}/api/og/release/${REL}.png"

echo "Generating OG image from ${OG_URL}"

curl --fail --location --silent --show-error "${OG_URL}" --output "${OUTPUT_PATH}"

echo "Saved preview to ${OUTPUT_PATH}"
