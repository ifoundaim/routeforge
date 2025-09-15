## RouteForge API (Top Endpoints)

Base URL: `http://localhost:${PORT:-8000}`

### Health

- Method: GET
- Path: `/healthz`
- Response:

```json
{ "ok": true }
```

### Create Project

- Method: POST
- Path: `/api/projects`
- Request:

```json
{
  "name": "RouteForge",
  "owner": "routeforge",
  "description": "demo"
}
```

- Response (200):

```json
{
  "id": 1,
  "name": "RouteForge",
  "owner": "routeforge",
  "description": "demo",
  "created_at": "2025-01-01T00:00:00Z"
}
```

### Create Release

- Method: POST
- Path: `/api/releases`
- Request:

```json
{
  "project_id": 1,
  "version": "1.0.0",
  "artifact_url": "https://example.com/artifacts/1.0.0.tgz",
  "notes": "init"
}
```

- Response (200):

```json
{
  "id": 1,
  "project_id": 1,
  "version": "1.0.0",
  "artifact_url": "https://example.com/artifacts/1.0.0.tgz",
  "notes": "init",
  "created_at": "2025-01-01T00:00:00Z"
}
```

### Create Route

- Method: POST
- Path: `/api/routes`
- Request:

```json
{
  "project_id": 1,
  "slug": "demo",
  "target_url": "https://example.com/downloads/latest",
  "release_id": 1
}
```

- Response (200):

```json
{
  "id": 1,
  "project_id": 1,
  "slug": "demo",
  "target_url": "https://example.com/downloads/latest",
  "release_id": 1,
  "created_at": "2025-01-01T00:00:00Z"
}
```

### Redirect by Slug

- Method: GET
- Path: `/r/{slug}`
- Response: 302 redirect to target URL. Example headers:

```
HTTP/1.1 302 Found
location: https://example.com/downloads/latest
```

### Release Detail

- Method: GET
- Path: `/api/releases/{id}`
- Response (200):

```json
{
  "id": 1,
  "project_id": 1,
  "version": "1.0.0",
  "notes": "init",
  "artifact_url": "https://example.com/artifacts/1.0.0.tgz",
  "created_at": "2025-01-01T00:00:00Z",
  "project": { "id": 1, "name": "RouteForge", "owner": "routeforge", "description": "demo", "created_at": "2025-01-01T00:00:00Z" },
  "latest_route": { "id": 1, "project_id": 1, "slug": "demo", "target_url": "https://example.com/downloads/latest", "release_id": 1, "created_at": "2025-01-01T00:00:00Z" }
}
```

### Route Hits Count

- Method: GET
- Path: `/api/routes/{id}/hits`
- Response (200):

```json
{ "count": 42 }
```

### Analytics: Summary

- Method: GET
- Path: `/api/stats/summary`
- Query: `days` (optional, default 7)
- Response (200):

```json
{
  "total_clicks": 100,
  "unique_routes": 5,
  "top_routes": [
    { "route_id": 1, "slug": "demo", "clicks": 42 }
  ]
}
```

### Analytics: Per Route

- Method: GET
- Path: `/api/routes/{id}/stats`
- Query: `days` (optional, default 7)
- Response (200):

```json
{
  "clicks": 42,
  "by_day": [ { "date": "2025-01-01", "count": 10 } ],
  "referrers": [ { "ref": "https://example.com/blog", "count": 8 } ],
  "user_agents": [ { "ua": "curl/8.0.1", "count": 20 } ]
}
```

---

### OpenAPI

- Schema: `GET /openapi.json` (FastAPI default)
- Interactive Docs: `/docs` (Swagger UI), `/redoc` (ReDoc)


