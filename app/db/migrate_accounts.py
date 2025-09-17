"""Idempotent migration to add user accounts and scope data rows."""

from __future__ import annotations

import logging
import os
from typing import Optional

from sqlalchemy import text

from . import get_engine


logger = logging.getLogger("routeforge.migrate.accounts")

DEMO_EMAIL = "demo@routeforge.local"
DEMO_NAME = "RouteForge Demo"


def _table_has_column(conn, table: str, column: str) -> bool:
    sql = text(
        """
        SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = :table_name AND COLUMN_NAME = :column_name
        """
    )
    result = conn.execute(sql, {"table_name": table, "column_name": column})
    return bool(result.scalar())


def _index_exists(conn, table: str, index_name: str) -> bool:
    sql = text(
        """
        SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_NAME = :table_name AND INDEX_NAME = :index_name
        """
    )
    result = conn.execute(sql, {"table_name": table, "index_name": index_name})
    return bool(result.scalar())


def _constraint_exists(conn, table: str, constraint: str) -> bool:
    sql = text(
        """
        SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_NAME = :table_name AND CONSTRAINT_NAME = :constraint_name
        """
    )
    result = conn.execute(sql, {"table_name": table, "constraint_name": constraint})
    return bool(result.scalar())


def _ensure_users_table(conn) -> None:
    logger.info("Ensuring users table exists...")
    conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS users (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          email VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    logger.info("OK: users table ready")


def _ensure_user_id_column(conn, table: str) -> None:
    if _table_has_column(conn, table, "user_id"):
        return

    logger.info("Adding user_id column to %s...", table)
    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN user_id BIGINT NULL")


def _ensure_user_indexes(conn, table: str) -> None:
    index_name = f"ix_{table}_user_id"
    if not _index_exists(conn, table, index_name):
        logger.info("Adding index %s on %s.user_id", index_name, table)
        conn.exec_driver_sql(f"CREATE INDEX {index_name} ON {table} (user_id)")

    constraint_name = f"fk_{table}_user"
    if not _constraint_exists(conn, table, constraint_name):
        logger.info("Adding foreign key %s on %s.user_id", constraint_name, table)
        conn.exec_driver_sql(
            f"""
            ALTER TABLE {table}
            ADD CONSTRAINT {constraint_name}
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE
            """
        )


def _demo_user_id(conn) -> int:
    existing = conn.execute(
        text("SELECT id FROM users WHERE email = :email"),
        {"email": DEMO_EMAIL},
    ).scalar()
    if existing:
        return int(existing)

    logger.info("Creating demo user %s", DEMO_EMAIL)
    result = conn.execute(
        text("INSERT INTO users (email, name) VALUES (:email, :name)"),
        {"email": DEMO_EMAIL, "name": DEMO_NAME},
    )
    new_id = result.lastrowid if hasattr(result, "lastrowid") else None
    if new_id is None:
        # Fallback query (TiDB may not expose lastrowid here)
        new_id = conn.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": DEMO_EMAIL},
        ).scalar()
    if not new_id:
        raise RuntimeError("Failed to determine demo user id")
    return int(new_id)


def _backfill_projects(conn, demo_id: int) -> None:
    logger.info("Backfilling projects.user_id -> %s", demo_id)
    conn.execute(
        text("UPDATE projects SET user_id = :uid WHERE user_id IS NULL"),
        {"uid": demo_id},
    )


def _backfill_releases(conn) -> None:
    logger.info("Backfilling releases.user_id from projects...")
    conn.exec_driver_sql(
        """
        UPDATE releases r
        JOIN projects p ON r.project_id = p.id
        SET r.user_id = p.user_id
        WHERE r.user_id IS NULL OR r.user_id <> p.user_id
        """
    )


def _backfill_routes(conn) -> None:
    logger.info("Backfilling routes.user_id from projects...")
    conn.exec_driver_sql(
        """
        UPDATE routes rt
        JOIN projects p ON rt.project_id = p.id
        SET rt.user_id = p.user_id
        WHERE rt.user_id IS NULL OR rt.user_id <> p.user_id
        """
    )


def _enforce_not_null(conn, table: str) -> None:
    logger.info("Ensuring %s.user_id is NOT NULL", table)
    conn.exec_driver_sql(f"ALTER TABLE {table} MODIFY COLUMN user_id BIGINT NOT NULL")


def migrate(dsn: Optional[str] = None) -> None:
    dsn = dsn or os.getenv("TIDB_DSN")
    if not dsn:
        raise RuntimeError("TIDB_DSN must be provided via argument or environment")

    engine = get_engine(dsn)
    with engine.begin() as conn:
        _ensure_users_table(conn)
        for table in ("projects", "releases", "routes"):
            _ensure_user_id_column(conn, table)

        demo_id = _demo_user_id(conn)
        _backfill_projects(conn, demo_id)
        _backfill_releases(conn)
        _backfill_routes(conn)

        for table in ("projects", "releases", "routes"):
            _ensure_user_indexes(conn, table)
            _enforce_not_null(conn, table)

    logger.info("Accounts migration complete.")


if __name__ == "__main__":
    migrate()
