## RouteForge Demo Script (3 minutes)

### What → Create → Agent publish → Route → 302 → Hits → Stats → Why TiDB

1. What (0:00–0:20)
   - RouteForge turns releases into short routes with analytics.
   - Agent prevents duplicate releases with similarity search.

2. Create (0:20–0:45)
   - Create `Project` and a baseline `Route` via simple POSTs.

3. Agent publish (0:45–1:30)
   - POST `/agent/publish` with `project_id`, `artifact_url`, `notes`.
   - If similar releases detected above threshold and not forced: returns `decision=review` with candidates.
   - Else: publishes `Release`, mints `Route` slug, links them.

4. Route (1:30–1:50)
   - Show the minted slug and target URL in response.

5. 302 (1:50–2:05)
   - Call `GET /r/{slug}`; browser 302s to artifact URL.

6. Hits (2:05–2:20)
   - Show `GET /api/routes/{id}/hits` returning cumulative count.

7. Stats (2:20–2:40)
   - Show summary `GET /api/stats/summary` and per-route `GET /api/routes/{id}/stats`.

8. Why TiDB (2:40–3:00)
   - MySQL-compatible, easy to run anywhere, vector/FULLTEXT friendly, scalable; drop-in SQL with durability and analytics.

---

## Shot List and Timings

- 0:00–0:05 — Title card: "RouteForge: Agentic Publish → Route → Analytics"
- 0:05–0:20 — App running terminal: `make run` logs healthy
- 0:20–0:30 — Create project (terminal): cURL + JSON response
- 0:30–0:40 — Create route (terminal): cURL + JSON response
- 0:40–1:05 — Agent publish baseline (terminal): `decision=published`, slug in response
- 1:05–1:20 — Agent publish duplicate (terminal): `decision=review` similar list
- 1:20–1:35 — Agent publish force (terminal): published with new slug
- 1:35–1:50 — Redirect demo (browser): `GET /r/{slug}` → 302 headers
- 1:50–2:05 — Hits count (terminal): `GET /api/routes/{id}/hits`
- 2:05–2:25 — Analytics summary (terminal): `GET /api/stats/summary`
- 2:25–2:40 — Per-route stats (terminal): `GET /api/routes/{id}/stats`
- 2:40–3:00 — Why TiDB slide: bullets + logo

Notes:
- Use large terminal font and dark theme. Keep windows static.
- Pre-seed DB to avoid errors/latency; show only the essential outputs.

---

## Thumbnail Spec

- Aspect: 3:2
- Composition: Left 60% dark tile with text, right 40% faint 302 arrow motif.
- Text: "↪ RouteForge" (large), subtitle: "Agent → Route → Analytics".
- Colors: Dark slate background, accent cyan for arrow, white text.
- Export sizes: 1500×1000 (web), 3000×2000 (retina).


