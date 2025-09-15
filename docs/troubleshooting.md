## Troubleshooting

- Port already in use
  - Symptom: `Address already in use` when starting Uvicorn.
  - Fix: choose another port. Example: `PORT=8001 make run`.

- DSN/connection issues
  - Use DSN format `mysql+pymysql://user:password@host:4000/dbname`.
  - Ensure the database exists and the user has DDL rights (for migrations).
  - If `TIDB_DSN` is not set, commands like `make migrate` will exit early.

- TLS/SSL to TiDB/MySQL
  - Prefer your provider's TLS-enabled endpoint. Most servers negotiate TLS automatically if required.
  - For certificate errors, install the provider CA in your OS trust store or use the provider's "public" endpoint that includes trusted CA.
  - If your provider mandates explicit TLS flags, use their recommended DSN parameters for PyMySQL/SQLAlchemy.

- Migrations: VECTOR or FULLTEXT not supported
  - The migration is idempotent and falls back automatically (VECTOR -> LONGBLOB; FULLTEXT -> skipped with LIKE fallback).
  - If errors persist, ensure your user has `ALTER TABLE` privileges.

- Similarity disabled or too sensitive
  - Enable vector search: set `EMBEDDING_ENABLED=1` and re-publish to write embeddings.
  - Tune decision: set `SIMILARITY_THRESHOLD` (default `0.83`). Higher = stricter review.

- Redirect works but hit counting doesn't
  - Ensure DB connection is healthy; the redirect endpoint writes to `route_hits` before issuing 302.
  - If running behind a proxy, pass `X-Forwarded-For` for accurate client IP.


