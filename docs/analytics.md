## Analytics API

Read-only analytics over `routes` and `route_hits`.

### Summary stats

GET `/api/stats/summary?days=7`

Response:

```json
{
  "total_clicks": 123,
  "unique_routes": 5,
  "top_routes": [
    { "route_id": 42, "slug": "my-release-1-2-3", "clicks": 37 }
  ]
}
```

Example curl:

```bash
curl -sS "http://localhost:8000/api/stats/summary?days=7" | jq .
```

### Per-route stats

GET `/api/routes/{id}/stats?days=7`

Response:

```json
{
  "clicks": 37,
  "by_day": [
    { "date": "2025-09-10", "count": 5 },
    { "date": "2025-09-11", "count": 9 }
  ],
  "referrers": [
    { "ref": "https://example.com/page", "count": 7 }
  ],
  "user_agents": [
    { "ua": "Mozilla/5.0 (...) Safari/605.1.15", "count": 12 }
  ]
}
```

Example curl:

```bash
ROUTE_ID=42
curl -sS "http://localhost:8000/api/routes/$ROUTE_ID/stats?days=30" | jq .
```

Notes:
- `days` defaults to 7, min 1, max 365.
- All queries are read-only and aggregate from `route_hits`.

