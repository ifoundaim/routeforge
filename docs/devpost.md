# RouteForge v1.0 — Devpost Copy

## Summary
RouteForge turns agent-authored releases into production-ready distribution links with analytics. Agents publish artifacts, we mint redirects, and product teams watch real usage roll in from a single dashboard. v1.0 focuses on reliability: every publish is audited, redirects capture enriched traffic, and CSV exports keep ops stakeholders in the loop.

## Demo Video
[Watch the 3-minute demo](https://youtu.be/ROUTEFORGE_V1_DEMO)
> Replace with the final upload and pair it with a 1280×720 thumbnail (PNG or JPG) that features the RouteForge wordmark over product UI.

## Highlights
- Agent-guided publish flow with similarity review prevents duplicate releases.
- Redirect + hit logging hardened with per-route analytics, CSV export, and uptime guardrails.
- UTM enrichment and lightweight funnel insights surface where installs originate.
- Auth stub + billing flags unlock the SPA’s Pro surfaces without real payments.
- Golden demo seed + faker traffic guarantee consistent screenshots and curl packs.

## Architecture & Data Flow
1. Agents call `POST /agent/publish` with project metadata and artifact URL.
2. The API writes to staging tables, runs similarity search (embeddings or fallback full-text), and emits audits.
3. On approval, a release row is promoted and a route slug is minted (`project-version`).
4. Redirect hits via `GET /r/{slug}` store IP, UA, referrer, and serialized UTM payloads.
5. Analytics endpoints aggregate hits, and CSV exports stream raw logs for ops handoff.

```
[Agent / UI]
    │  publish
    ▼
[FastAPI] ──▶ [releases_staging] ──similarity──▶ [audit]
    │                                │
    │ promote                        ▼
    │                         [releases]
    │                                │
    └──mint route──▶ [routes] ──redirect──▶ [route_hits]
                                      │
                           analytics / exports
```

## Run It Yourself
```bash
cp .env.sample .env            # set TIDB_DSN and PORT
pip install -r requirements.txt
python scripts/migrate.py --dsn "$TIDB_DSN"
bash scripts/seed_demo.sh
uvicorn app.app:app --reload --port ${PORT:-8000}
```
Then open a second terminal and execute `bash scripts/validate_demo.sh` to confirm the curl pack passes end-to-end.

## Submission Assets
- README Quickstart + curl pack outputs
- CHANGELOG v1.0
- Seed + validate logs (paste from CLI run)
- Recorded demo video + Devpost screenshots
