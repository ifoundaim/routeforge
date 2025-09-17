# RouteForge v1.0

RouteForge is an agent-first release concierge: it inspects AI-generated artifacts, routes clean drops to the growth team, and keeps a perfect audit trail for every action.

## Agentic Flow
- Similarity screening guards the publish lane so the agent can ask for review when drops look suspicious.
- Successful publishes auto-mint branded download routes and log every cue in the audit ledger.
- Redirect analytics give the agent feedback loops it can reason about for the next iteration.

## Why TiDB
- MySQL-compatible API keeps the FastAPI + SQLAlchemy stack untouched while unlocking HTAP.
- Real-time ingestion soaks up agent writes and redirect hits without slowing down the flow.
- Built-in analytical queries let us surface per-route stats without bolting on a second store.

## Quickstart (≤5 commands)
```bash
cp .env.sample .env            # edit TIDB_DSN for your TiDB/MySQL instance
pip install -r requirements.txt
python scripts/migrate.py --dsn "$TIDB_DSN"
bash scripts/seed_demo.sh
uvicorn app.app:app --reload --port ${PORT:-8000}
```
With the API running, open another terminal and execute `bash scripts/validate_demo.sh` to run the cURL pack end-to-end.

## Demo Video
[2-3 minute demo placeholder](https://youtu.be/ROUTEFORGE_V1_DEMO)
> Swap in the final link and upload a 1280×720 thumbnail that showcases the RouteForge UI alongside the wordmark.

## Agent Publish + Similarity Search

### Endpoint

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

## Redirect Analytics & CSV Export
- `GET /api/stats/summary` returns total clicks, unique routes, and top-performing slugs for a given window.
- `GET /api/routes/{id}/stats` breaks down clicks by day, referrer (with decoded UTM), and user-agent mix.
- `GET /api/routes/{id}/export.csv` streams raw hit logs for the selected route.
- Redirects enrich every hit with IP, UA, referrer host, and parsed UTM parameters so dashboards stay light.

## Demo Data
- Run `bash scripts/seed_demo.sh` to mint the “RouteForge Demo” project, publish three releases, and guarantee two routed slugs (`routeforge-demo-1-1-0`, `routeforge-demo-1-2-0`).
- The script tops up route hits to 150 using `scripts/faker.py`, keeping analytics graphs lively yet deterministic.
- Need extra variability? `python scripts/faker.py --routes 10 --clicks 500 --days 7` still works for ad-hoc experiments.

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
- `GET /api/stats/summary` → aggregate click totals + top routes
- `GET /api/routes/{id}/stats` → per-route analytics
- `GET /api/routes/{id}/export.csv` → CSV stream of recent hits
- `POST /agent/publish` → agent publish workflow

## Billing (Demo Flags)

- `GET /api/entitlements` → `{ "pro": bool }` for the active demo user (session user if auth is enabled, otherwise the shared `guest`).
- `POST /dev/upgrade` → `{ "pro": bool }` flips the in-memory entitlement; send `{ "pro": true }` to unlock the UI for demos.
- Flags are stored in-memory only and default to `false` unless `DEMO_PRO_DEFAULT` is set.
- No payments or database writes occur. The SPA displays an Upgrade modal and Pro features (CSV export, detailed route analytics) light up without a full reload once the flag is toggled.

## cURL Validation Packs
- Backend smoke: `bash scripts/validate_demo.sh` (health → stats summary → redirect hit → CSV head).
- Agent workflow:

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

## Notes
- CORS is permissive for demo.
- Logging includes agent decisions.
- Migrations are idempotent and will add `releases_staging`, `audit`, `releases.embedding` (VECTOR or LONGBLOB), and FULLTEXT index when possible.
- Redirect hits capture the referrer host plus any UTM parameters so analytics can surface top sources without schema changes.
