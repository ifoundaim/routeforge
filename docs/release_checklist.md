# RouteForge v1.0 Release Checklist

## Pre-freeze
- [ ] `ruff check .`
- [ ] `pytest` (API smoke + unit tests)
- [ ] `cd web && pnpm install && pnpm run test:e2e`
- [ ] `bash scripts/seed_demo.sh` (confirm idempotent output)
- [ ] `bash scripts/validate_demo.sh` (curl pack passes)
- [ ] Manually click README Quickstart links + video placeholder

## Freeze
- [ ] Update project version strings to `1.0.0` (FastAPI metadata, docs, UI)
- [ ] Refresh `CHANGELOG.md` with final commits
- [ ] `git status` clean; create release branch/tag pair `git tag v1.0`
- [ ] Build/publish release artifact (backend image or export bundle if required)

## Post-freeze
- [ ] Upload the 3-minute demo recording + confirm thumbnail renders correctly
- [ ] Publish Devpost entry using `docs/devpost.md`
- [ ] Share seed + validate script outputs with stakeholders
- [ ] Monitor staging telemetry for regressions within first 24h
