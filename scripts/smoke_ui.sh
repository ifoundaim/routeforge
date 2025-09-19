#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://localhost:${PORT:-8000}}"
EMAIL="${EMAIL:-demo@routeforge.com}"
COOKIE="$(mktemp)"

# login
MAGIC_LINK=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\"}" "$API/auth/request-link" | jq -r '.dev_link // empty')
if [ -z "$MAGIC_LINK" ] || [ "$MAGIC_LINK" = "null" ]; then
  echo "Failed to get magic link"
  exit 1
fi
curl -s -c "$COOKIE" -L "$MAGIC_LINK" >/dev/null

# find a recent route (via stats summary)
SLUG=$(curl -s -b "$COOKIE" "$API/api/stats/summary" | jq -r '.top_routes[0].slug // empty')
if [ -z "$SLUG" ] || [ "$SLUG" = "null" ]; then
  echo "No routes found; run seed_demo.sh first"
  exit 0
fi

# hit the route once to generate UTM
curl -s -o /dev/null -I "$API/r/$SLUG?utm_source=twitter"

# open dashboard + route detail in Present Mode
if command -v open >/dev/null; then
  O=open
elif command -v xdg-open >/dev/null; then
  O=xdg-open
else
  O=echo
fi
$O "$API/app/dashboard?present=1" >/dev/null 2>&1 || true
$O "$API/app/routes/$SLUG?present=1" >/dev/null 2>&1 || true
echo "Opened Dashboard & RouteDetail for slug=$SLUG"
