"""Backfill user ownership for existing records."""

from __future__ import annotations

import logging
import os
from typing import Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from . import get_engine
from ..auth.accounts import ensure_demo_user


logger = logging.getLogger("routeforge.migrate.backfill_owner")


def _ensure_demo_id(engine) -> int:
    """Ensure the demo user exists and return their id."""
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with SessionLocal() as session:
        demo = ensure_demo_user(session)
        session.commit()
        return int(demo.id)


def _run_update(conn, sql: str, **params) -> int:
    statement = text(sql)
    result = conn.execute(statement, params) if params else conn.execute(statement)
    try:
        return int(result.rowcount or 0)
    except Exception:  # pragma: no cover - driver specific edge case
        return 0


def backfill(dsn: Optional[str] = None) -> Dict[str, int]:
    """Assign orphaned ownership records to the demo user and align child rows."""
    effective_dsn = dsn or os.getenv("TIDB_DSN")
    if not effective_dsn:
        raise RuntimeError("TIDB_DSN must be provided via argument or environment")

    engine = get_engine(effective_dsn)
    demo_id = _ensure_demo_id(engine)

    summary: Dict[str, int] = {}
    with engine.begin() as conn:
        summary["projects"] = _run_update(
            conn,
            """
            UPDATE projects
            SET user_id = :uid
            WHERE user_id IS NULL
               OR user_id NOT IN (SELECT id FROM users)
            """,
            uid=demo_id,
        )

        summary["releases"] = _run_update(
            conn,
            """
            UPDATE releases
            SET user_id = (
                SELECT p.user_id FROM projects p WHERE p.id = releases.project_id
            )
            WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = releases.project_id)
              AND (
                    user_id IS NULL OR user_id <> (
                        SELECT p.user_id FROM projects p WHERE p.id = releases.project_id
                    )
              )
            """,
        )

        summary["routes"] = _run_update(
            conn,
            """
            UPDATE routes
            SET user_id = (
                SELECT p.user_id FROM projects p WHERE p.id = routes.project_id
            )
            WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = routes.project_id)
              AND (
                    user_id IS NULL OR user_id <> (
                        SELECT p.user_id FROM projects p WHERE p.id = routes.project_id
                    )
              )
            """,
        )

    logger.info("Backfill complete: %s", summary)
    return summary


def main() -> None:
    summary = backfill()
    for table, count in summary.items():
        print(f"{table}: {count} rows updated")


if __name__ == "__main__":  # pragma: no cover - manual invocation helper
    main()
