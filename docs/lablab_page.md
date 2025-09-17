# lablab.ai Submission Copy

## Problem
- Growth and partnerships teams get a flood of AI-generated releases but lack a consistent signal on which ones are safe to ship.
- Manual link distribution breaks the moment an artifact changes, and nobody owns the redirect or analytics cleanup.
- Compliance needs a decision log when an autonomous agent ships an update so they can trace who approved what.

RouteForge frames the pain around confidence: teams cannot let agents hit publish without knowing where artifacts land or how they perform.

## Agent Solution
- The agent shepherds every release into staging, runs similarity search, and flags suspicious drops for a human thumbs-up.
- When clean, it auto-mints a branded download route, updates the route catalog, and pings growth with the fresh slug.
- Redirect hits stream back into the ledger so the agent can score its own performance and decide if it should iterate.

The loop keeps humans in the judgment seat while the agent handles the repetitive review -> publish -> measure grind.

## Why TiDB
- MySQL wire compatibility let us reuse our existing FastAPI + SQLAlchemy models without rewriting persistence.
- Fast writes absorb bursts of agent publishes plus redirect traffic without starving analytics.
- Hybrid transactional/analytical queries power the per-route dashboards the growth agent consumes after every drop.

TiDB became the single source of truth for both operational commands and the metrics we surface to the agent and stakeholders.

## What We Learned
- Guardrails like similarity thresholds and forced reviews help agents earn trust faster than binary allow/deny switches.
- Storing the redirect exhaust next to the transactional records gives agents actionable context without a separate analytics stack.
- People still want to see the UI, so pairing scripted API calls with a polished front end is worth the time investment.

## Next
- Layer on agent-to-agent chat so marketing can negotiate launch windows before links go live.
- Expand to artifact notarization flows so compliance can auto-file attestations from the same timeline.
- Ship a self-serve workspace so teams can drop in their own TiDB cluster and start demoing in minutes.

## Demo Video
- [2-3 minute walkthrough placeholder](https://youtu.be/ROUTEFORGE_LABLAB_TEASER)
