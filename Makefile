.PHONY: run migrate seed fmt lint

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


