#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:${PORT:-8000}"

echo "[1] baseline publish (no similar)"
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq .

echo "[2] duplicate warning (should suggest review)"
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq .

echo "[3] force publish anyway"
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.1.zip","notes":"v0.2.1 patch","force":true}' | jq .

echo "[4] dry run"
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.3.0.zip","notes":"v0.3.0","dry_run":true}' | jq .


