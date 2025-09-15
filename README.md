# RouteForge Backend (FastAPI + TiDB)

Minimal-but-real demo backend for an IP registry → releases → short distribution redirects with TiDB persistence.

## Quickstart

1. Create a `.env` from sample and set your TiDB DSN:
   ```bash
   cp .env.sample .env
   # edit .env and set TIDB_DSN
   ```
2. Install dependencies (Python 3.11):
   ```bash
   pip install -r requirements.txt
   ```
3. Run migrations (create tables):
   ```bash
   make migrate
   ```
4. Seed demo data:
   ```bash
   make seed
   ```
5. Run the server:
   ```bash
   make run
   ```

Server runs on `http://localhost:${PORT:-8000}`.

## Environment

- `TIDB_DSN`: MySQL-compatible DSN, e.g. `mysql+pymysql://user:password@host:4000/dbname`
- `PORT`: default `8000`

## API Summary

- `GET /healthz` → `{ "ok": true }`
- `POST /api/projects` → create project
- `POST /api/releases` → create release
- `POST /api/routes` → create route (unique slug)
- `GET /r/{slug}` → 302 redirect to `target_url` and logs a hit
- `GET /api/releases/{id}` → release with project + latest bound route
- `GET /api/routes/{id}/hits` → `{ "count": N }`

## cURL validation

```bash
# Health
curl -s http://localhost:8000/healthz | jq .

# Create project
PROJECT=$(curl -s -X POST http://localhost:8000/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"RouteForge","owner":"routeforge","description":"demo"}')
echo $PROJECT | jq .
PROJECT_ID=$(echo $PROJECT | jq -r .id)

# Create release
RELEASE=$(curl -s -X POST http://localhost:8000/api/releases \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"version":"1.0.0","artifact_url":"https://example.com/artifacts/1.0.0.tgz","notes":"init"}')
echo $RELEASE | jq .
RELEASE_ID=$(echo $RELEASE | jq -r .id)

# Create route
ROUTE=$(curl -s -X POST http://localhost:8000/api/routes \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"slug":"demo","target_url":"https://example.com/downloads/latest","release_id":'"$RELEASE_ID"'}')
echo $ROUTE | jq .
ROUTE_ID=$(echo $ROUTE | jq -r .id)

# Call redirect (will 302)
curl -i http://localhost:8000/r/demo | sed -n '1,5p'

# Check hits count
curl -s http://localhost:8000/api/routes/$ROUTE_ID/hits | jq .
```

## Dev Notes

- CORS is open to all origins for demo purposes.
- Error shape is `{ "error": "message" }`.
- Redirect logs basic info to stdout.
