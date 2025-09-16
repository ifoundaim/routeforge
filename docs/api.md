# RouteForge API Reference

Set `API` to your base URL, e.g. `export API=${API:-http://localhost:8000}`.

## Health Check
`GET /healthz` - confirms the service is live.
```bash
curl -sS "$API/healthz"
```

## Database Health Check
`GET /healthz/db` - verifies database connectivity.
```bash
curl -sS "$API/healthz/db"
```

## Agent Publish
`POST /agent/publish` - lets the release agent ingest an artifact and optionally mint a route.
```bash
curl -sS -X POST "$API/agent/publish" \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": 1,
    "artifact_url": "https://example.com/builds/app-v1.2.3.zip",
    "notes": "Release candidate",
    "dry_run": true
  }'
```

## Create Project
`POST /api/projects` - creates a new project container.
```bash
curl -sS -X POST "$API/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "RouteForge",
    "owner": "routeforge",
    "description": "Demo project"
  }'
```

## Create Release
`POST /api/releases` - registers a release for an existing project.
```bash
curl -sS -X POST "$API/api/releases" \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": 1,
    "version": "1.2.3",
    "artifact_url": "https://example.com/builds/app-v1.2.3.zip",
    "notes": "Release notes"
  }'
```

## Create Route
`POST /api/routes` - mints a download route that points at a target URL.
```bash
curl -sS -X POST "$API/api/routes" \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": 1,
    "slug": "demo-route",
    "target_url": "https://example.com/downloads/latest",
    "release_id": 1
  }'
```

## Route Hits
`GET /api/routes/{id}/hits` - returns an aggregate count of tracked hits for a route.
```bash
curl -sS "$API/api/routes/1/hits"
```

## Stats Summary
`GET /api/stats/summary` - reports recent click totals and top performing routes.
```bash
curl -sS "$API/api/stats/summary?days=7"
```

## Export Route Hits CSV
`GET /api/routes/{id}/export.csv` - streams recent hits for a route as CSV (set `limit` to adjust rows).
```bash
curl -sS -H 'Accept: text/csv' "$API/api/routes/1/export.csv?limit=500"
```
