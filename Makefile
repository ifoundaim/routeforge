.PHONY: run migrate seed fmt lint demo-seed demo-validate demo-run

run:
	uvicorn app.app:app --reload --port $${PORT:-8000}

migrate:
	python scripts/migrate.py --dsn "$${TIDB_DSN}"

seed:
	python scripts/seed.py --demo basic --dsn "$${TIDB_DSN}"

fmt:
	ruff check --fix . || true

lint:
	ruff check .

demo-seed:
	scripts/seed_demo.sh

demo-validate:
	scripts/validate_demo.sh

demo-run:
	scripts/demo_runner.sh

web-install:
	if command -v pnpm >/dev/null 2>&1; then \
		(cd web && pnpm install); \
	else \
		(cd web && npm install); \
	fi

web-build:
	if command -v pnpm >/dev/null 2>&1; then \
		(cd web && pnpm build); \
	else \
		(cd web && npm run build); \
	fi

web-dev:
	if command -v pnpm >/dev/null 2>&1; then \
		(cd web && pnpm dev); \
	else \
		(cd web && npm run dev); \
	fi

smoke-ui:
	bash scripts/smoke_ui.sh
