## Agentic Publish + Similarity Search (Sprint 2)

### New Endpoint

- POST `/agent/publish`

Request body:

```json
{
  "project_id": 1,
  "artifact_url": "https://ex.com/app-0.2.0.zip",
  "notes": "v0.2.0 improvements",
  "dry_run": false,
  "force": false
}
```

Behavior:
- Ingests to `releases_staging`, audits `ingest` and `search`.
- Searches similar releases via vector search if `EMBEDDING_ENABLED=1` and `releases.embedding` available; otherwise FULLTEXT fallback.
- If similar above threshold and `force=false`, returns `decision=review` with candidates.
- Else publishes a new `releases` row (and optional embedding) and mints a `routes` slug (`project-name-version`), auditing `publish` and `mint_route`.

Env flags:
- `EMBEDDING_ENABLED` (default `0`), `SIMILARITY_THRESHOLD` (default `0.83`).

### Data Flow
1. POST `/agent/publish` with project, artifact, notes.
2. Insert into `releases_staging` and write `audit` rows.
3. Similarity search over prior `releases`.
4. Decision: `review` vs `published`/`dry_run`.
5. On publish, create `release`, compute optional embedding, and mint `route`.

### Smoke Tests

Run the stack:

```bash
make migrate && make seed && make run
```

Then in another terminal:

```bash
API="http://localhost:${PORT:-8000}"
# 1) baseline publish (no similar)
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq
# 2) duplicate warning (should suggest review)
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.0.zip","notes":"v0.2.0 improvements"}' | jq
# 3) force publish anyway
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.2.1.zip","notes":"v0.2.1 patch","force":true}' | jq
# 4) dry run
curl -s -X POST "$API/agent/publish" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"artifact_url":"https://ex.com/app-0.3.0.zip","notes":"v0.3.0","dry_run":true}' | jq
```

### Notes
- CORS is permissive for demo.
- Logging includes agent decisions.
- Migrations are idempotent and will add `releases_staging`, `audit`, `releases.embedding` (VECTOR or LONGBLOB), and FULLTEXT index when possible.

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
