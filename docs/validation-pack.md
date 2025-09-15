## cURL Validation Pack

Requires `jq` for pretty-printing (optional but recommended).

Export convenience var:
```bash
API="http://localhost:${PORT:-8000}"
```

### Pack A: API CRUD + Redirect
```bash
# Health
curl -s "$API/healthz" | jq .

# Create project
PROJECT=$(curl -s -X POST "$API/api/projects" \
  -H 'content-type: application/json' \
  -d '{"name":"RouteForge","owner":"routeforge","description":"demo"}')
echo "$PROJECT" | jq .
PROJECT_ID=$(echo "$PROJECT" | jq -r .id)

# Create release
RELEASE=$(curl -s -X POST "$API/api/releases" \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"version":"1.0.0","artifact_url":"https://example.com/artifacts/1.0.0.tgz","notes":"init"}')
echo "$RELEASE" | jq .
RELEASE_ID=$(echo "$RELEASE" | jq -r .id)

# Create route
ROUTE=$(curl -s -X POST "$API/api/routes" \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"slug":"demo","target_url":"https://example.com/downloads/latest","release_id":'"$RELEASE_ID"'}')
echo "$ROUTE" | jq .
ROUTE_ID=$(echo "$ROUTE" | jq -r .id)

# 302 redirect
curl -i "$API/r/demo" | sed -n '1,5p'

# Hits count
curl -s "$API/api/routes/$ROUTE_ID/hits" | jq .
```

### Pack B: Agent Publish
```bash
# baseline publish (no similar)
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq .

# duplicate (should suggest review)
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq .

# force publish
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.1.zip","notes":"v0.2.1 patch","force":true}' | jq .

# dry run
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.3.0.zip","notes":"v0.3.0","dry_run":true}' | jq .
```


