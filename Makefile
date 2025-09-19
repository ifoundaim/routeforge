.PHONY: run migrate seed fmt lint demo-seed demo-validate demo-run og-preview
.PHONY: docker-build docker-up docker-down

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

og-preview:
	@if [ -z "$(REL)" ]; then \
		echo "REL is required (usage: make og-preview REL=1)" >&2; \
		exit 1; \
	fi
	API="$$API" PORT="$$PORT" bash scripts/og_preview.sh "$(REL)"

docker-build:
	docker compose build

docker-up:
	TIDB_DSN="$$TIDB_DSN" AUTH_ENABLED="$$AUTH_ENABLED" SESSION_SECRET="$$SESSION_SECRET" APP_BASE_URL="$$APP_BASE_URL" \
	VITE_API_BASE="$$VITE_API_BASE" docker compose up -d

docker-down:
	docker compose down
