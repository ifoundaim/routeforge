# RouteForge Demo Recording Checklist

## Prep
- [ ] `make demo-seed` (requires `TIDB_DSN`) to refresh the golden workspace.
- [ ] Run `make run` in a clean terminal window; leave logs tailing.
- [ ] In a second terminal, run `make demo-validate` and capture the printed codes/counts.
- [ ] Start screen/audio capture, set browser to dark theme, close notifications.
- [ ] Launch `scripts/demo_runner.sh --project-id <id>` once to cache assets and pre-open tabs.

## Terminal Shots
- [ ] **App ready** — show `make run` output reporting startup + `/healthz` probe.
  - Line: "RouteForge API is live on localhost, ready for the agent and UI."
- [ ] **Create project** — POST `/api/projects`; highlight id + owner.
  - Line: "A project anchors releases; a single call provisions our RouteForge Demo workspace."
- [ ] **Mint route** — POST `/api/routes`; reveal slug + target URL.
  - Line: "Routes wrap a release URL with analytics and redirect controls."
- [ ] **Agent publish** — POST `/agent/publish`; pause on decision + minted slug.
  - Line: "The agent promotes clean releases automatically, flagging near-duplicates."
- [ ] **Hits + stats** — `GET /api/routes/{id}/hits` then `GET /api/stats/summary`.
  - Line: "Each redirect increments click counters that feed the analytics dashboards."

## Browser Shots
- [ ] `/app` dashboard (command palette or top cards).
  - Line: "Dashboard tiles surface live activity across projects and releases."
- [ ] `/app/projects/<id>` project overview.
  - Line: "Project view tracks releases, routes, and automated agent verdicts."
- [ ] `/r/<slug>` redirect pop (expect 302 overlay in devtools or location bar).
  - Line: "Visitors hit the vanity slug and are sent to the release artifact instantly."
- [ ] `/app/routes/<id>` analytics detail (charts + referrer table).
  - Line: "Route analytics expose top sources, referrers, and user agents for each build."

## Closing Beats
- [ ] Summarize: "Agent publish → Route → Analytics, powered by TiDB for vector search + reliability."
- [ ] End screen: remind to visit `routeforge.ai` and drop a CTA for contact/demo.

Notes:
- Keep the terminal path and browser tabs static between takes.
- Re-run `make demo-validate` after retakes to refresh counts if needed.
- Use the same slug as the validate script (`ROUTEFORGE_PRIMARY_SLUG`) unless directing a specific release.
