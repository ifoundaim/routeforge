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

#### ASCII Data Flow
```
[Agent / client] --POST /agent/publish--> [API]
      |                                      |
      |                               ingest staging
      v                                      v
[releases_staging]                      [audit: ingest]
      |                                      |
      |--- search (embedding? fulltext?) ---> [similar releases]
      |                                      |
 decision: review <-- score>=threshold? -- yes
      |
     no
      v
[create release] -- optional embedding --> [releases]
      |                                      |
      v                                      v
[audit: publish]                        [mint route]
      |                                      |
      v                                      v
[route] <----------- slug minted ---------- [routes]
      |
      v
GET /r/{slug} --> 302 --> target_url
      |
      v
[route_hits] --count--> GET /api/routes/{id}/hits => {"count": N}
```

### cURL Validation Pack (Agent)

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

## Quickstart (5 steps)

1. Environment
   ```bash
   # Create .env with your DSN (example shown)
   cat > .env << 'EOF'
   TIDB_DSN=mysql+pymysql://user:password@host:4000/routeforge
   # Optional
   # PORT=8000
   # LOG_LEVEL=INFO
   # EMBEDDING_ENABLED=0
   # SIMILARITY_THRESHOLD=0.83
   EOF
   ```
2. Install deps (Python 3.11)
   ```bash
   pip install -r requirements.txt
   ```
3. Migrate (create tables)
   ```bash
   make migrate
   ```
4. Seed demo data
   ```bash
   make seed
   ```
5. Run and basic curl
   ```bash
   make run
   # In another shell
   curl -s http://localhost:${PORT:-8000}/healthz | jq .
   ```

Server runs on `http://localhost:${PORT:-8000}`. For the dev smoke setup we use `PORT=4000` so that frontend proxy and cURL examples hit `4000`.

## Environment

- `TIDB_DSN`: MySQL-compatible DSN, e.g. `mysql+pymysql://user:password@host:4000/dbname`
- `PORT`: default `8000`
- `LOG_LEVEL`: default `INFO`
- `RATE_LIMIT_BURST`: per-IP burst tokens (default `10`)
- `RATE_LIMIT_WINDOW_SEC`: token bucket window in seconds (default `10`)

## API Summary

- `GET /healthz` → `{ "ok": true }`
- `GET /healthz/db` → `{ "db": "ok" }` or 503 with `{ "error": "db_unhealthy", "detail": "..." }`
- `POST /api/projects` → create project
- `POST /api/releases` → create release
- `POST /api/routes` → create route (unique slug)
- `GET /r/{slug}` → 302 redirect to `target_url` and logs a hit
- `GET /api/releases/{id}` → release with project + latest bound route
- `GET /api/routes/{id}/hits` → `{ "count": N }`

## cURL Validation Pack (API)

```bash
# Health
curl -i http://localhost:8000/healthz
curl -i http://localhost:8000/healthz/db

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

## Reliability

The API adds middleware to stamp each request with an `X-Request-ID` and logs timing: method, path, status, elapsed ms. Errors use a standard JSON shape: `{ "error": "code", "detail": "..." }` and include `X-Request-ID` in the response headers.

Redirects are hardened with an in-memory, per-IP token-bucket rate limiter and URL normalization/validation that forbids `javascript:` and `data:` schemes. When rate-limited: `429 {"error":"rate_limited"}`, unknown slugs: `404 {"error":"not_found"}`.

### cURL Quick Demo

```bash
API="http://localhost:${PORT:-8000}"
curl -i "$API/healthz"
curl -i "$API/healthz/db"
# Rate limit demo (same IP):
for i in {1..20}; do curl -s -o /dev/null -w "%{http_code} " "$API/r/pp-hero"; done; echo
```

## Security & Data Hygiene

- Route slugs are normalized to lowercase alphanumerics and single dashes, trimming doubles and enforcing a 64-character maximum; results shorter than two characters trigger `422 {"error":"invalid_slug"}`.
- Redirect targets must use schemes from `ALLOWED_TARGET_SCHEMES` (default `https,http`); disallowed or malformed URLs return `422 {"error":"invalid_url"}` and the sanitized version of allowed targets is stored and reused.
- Persisted slugs stay unique after normalization; conflicts respond with `409 {"error":"slug_exists"}` while preserving the sanitized slug in the message.
- Error payloads always include `{"error","detail"}` and echo `X-Request-ID` when present; example responses:
  ```json
  {"error":"invalid_slug","detail":"Slug must contain at least two letters, numbers, or dashes."}
  {"error":"invalid_url","detail":"Target URL scheme must be one of: https, http"}
  {"error":"slug_exists","detail":"Slug 'ok' already exists."}
  ```

## Dev Notes

- CORS is open to all origins for demo purposes.
- Error shape is `{ "error": "message" }`.
- Redirect logs basic info to stdout.

## Troubleshooting

- Port already in use: set `PORT=8001` (or any free port) before `make run`.
- DSN format: `mysql+pymysql://user:password@host:4000/dbname`. Ensure database exists and user has DDL rights for migrations.
- TLS/SSL to TiDB or MySQL:
  - Prefer your provider's TLS-enabled endpoint. Most servers negotiate TLS automatically when required.
  - If you see certificate errors, install the provider CA in your OS trust store or use their "public" endpoint that bundles CA trust.
  - If your provider requires explicit TLS, use their recommended DSN parameters for PyMySQL/SQLAlchemy.
- Vector/FULLTEXT features: If your cluster lacks VECTOR or FULLTEXT, migrations fall back automatically. Searching will still work via LIKE if needed.
- Embeddings off by default: set `EMBEDDING_ENABLED=1` to enable vector search and `SIMILARITY_THRESHOLD` to tune review sensitivity.

## Docs

- Quickstart: `docs/quickstart.md`
- Data Flow: `docs/data-flow.md`
- Validation Pack: `docs/validation-pack.md`
- Troubleshooting: `docs/troubleshooting.md`
 - API Reference: `docs/api.md` (see `/openapi.json`, `/docs`, `/redoc`)

## How to record the demo (3 minutes)

1) Run the server (Terminal A)

```bash
make run
```

2) Capture the demo assets (Terminal B)

```bash
# Writes JSON/headers to assets/demo/
bash scripts/capture.sh
# Or specify an output dir explicitly
bash scripts/capture.sh "$PWD/assets/demo"
```

3) Optional: Open the interactive docs and take a screenshot (macOS)

```bash
open "http://localhost:${PORT:-8000}/docs"
OUT="$PWD/assets/demo"; mkdir -p "$OUT"
screencapture -x "$OUT/docs-$(date +%Y%m%d-%H%M%S).png"
```

4) Optional: Show a live 302 in the browser

```bash
# Use the slug from agent-publish-force.json (route.slug)
SLUG=$(jq -r .route.slug "$PWD/assets/demo/"*-agent-publish-force.json)
open "http://localhost:${PORT:-8000}/r/$SLUG"
```

All assets will be available under `assets/demo/` for quick drag-and-drop into slides.
