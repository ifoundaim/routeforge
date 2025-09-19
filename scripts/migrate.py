#!/usr/bin/env python3
import argparse
import logging
import os
import sys

from dotenv import load_dotenv

# Ensure repository root is on sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(CURRENT_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("routeforge.migrate")


def main():
    parser = argparse.ArgumentParser(description="Idempotent migration for RouteForge.")
    parser.add_argument("--dsn", dest="dsn", help="Database DSN (MySQL/TiDB)")
    args = parser.parse_args()

    from app.db import get_engine
    from app.models import Base
    from app.db.migrate_accounts import migrate as migrate_accounts

    dsn = args.dsn or os.getenv("TIDB_DSN")
    if not dsn:
        raise SystemExit("TIDB_DSN not provided. Use --dsn or set env TIDB_DSN.")

    engine = get_engine(dsn)
    logger.info("Ensuring base tables via SQLAlchemy metadata...")
    Base.metadata.create_all(engine)
    logger.info("Running accounts migration (users + user_id backfill)...")
    migrate_accounts(dsn)

    with engine.begin() as conn:
        # releases_staging
        logger.info("Ensuring table releases_staging exists...")
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS releases_staging (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              artifact_url TEXT NOT NULL,
              notes TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        logger.info("OK: releases_staging ready")

        # audit
        logger.info("Ensuring table audit exists...")
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS audit (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              entity_type VARCHAR(32) NOT NULL,
              entity_id BIGINT NOT NULL,
              action VARCHAR(64) NOT NULL,
              meta JSON,
              ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX ix_audit_ts (ts)
            )
            """
        )
        logger.info("OK: audit ready")

        # embedding column
        logger.info("Ensuring releases.embedding exists (prefer VECTOR(768))...")
        col_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'releases' AND COLUMN_NAME = 'embedding'
            """
        ).scalar()
        if not col_exists:
            try:
                conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN embedding VECTOR(768) NULL")
                logger.info("OK: releases.embedding added as VECTOR(768)")
            except Exception as e:
                logger.warning("VECTOR unavailable (%s). Falling back to LONGBLOB...", e)
                conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN embedding LONGBLOB NULL")
                logger.info("OK: releases.embedding added as LONGBLOB")
        else:
            logger.info("OK: releases.embedding already present")

        # FULLTEXT fallback
        logger.info("Ensuring FULLTEXT index ft_releases_notes_version exists...")
        idx_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_NAME = 'releases' AND INDEX_NAME = 'ft_releases_notes_version'
            """
        ).scalar()
        if not idx_exists:
            try:
                conn.exec_driver_sql(
                    "ALTER TABLE releases ADD FULLTEXT INDEX ft_releases_notes_version (notes, version)"
                )
                logger.info("OK: FULLTEXT index created")
            except Exception as e:
                logger.warning("FULLTEXT unsupported or failed (%s). Skipping.", e)
        else:
            logger.info("OK: FULLTEXT index already present")

        # artifact_sha256 column
        logger.info("Ensuring releases.artifact_sha256 exists...")
        sha_col_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'releases' AND COLUMN_NAME = 'artifact_sha256'
            """
        ).scalar()
        if not sha_col_exists:
            conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN artifact_sha256 VARCHAR(128) NULL")
            logger.info("OK: releases.artifact_sha256 added")
        else:
            logger.info("OK: releases.artifact_sha256 already present")

        logger.info("Ensuring releases.evidence_ipfs_cid exists...")
        cid_col_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'releases' AND COLUMN_NAME = 'evidence_ipfs_cid'
            """
        ).scalar()
        if not cid_col_exists:
            conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN evidence_ipfs_cid VARCHAR(128) NULL")
            logger.info("OK: releases.evidence_ipfs_cid added")
        else:
            logger.info("OK: releases.evidence_ipfs_cid already present")

        # api_keys table
        logger.info("Ensuring api_keys table exists...")
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS api_keys (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              user_id BIGINT NOT NULL,
              key_id VARCHAR(64) NOT NULL,
              secret_hash VARCHAR(128) NOT NULL,
              active TINYINT NOT NULL DEFAULT 1,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              last_used_at TIMESTAMP NULL,
              UNIQUE KEY uq_api_keys_key_id (key_id),
              INDEX ix_api_keys_user_id (user_id)
            )
            """
        )
        logger.info("OK: api_keys ready")

        # webhooks table
        logger.info("Ensuring webhooks table exists...")
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS webhooks (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              user_id BIGINT NOT NULL,
              url VARCHAR(2048) NOT NULL,
              secret VARCHAR(128) NOT NULL,
              event VARCHAR(64) NOT NULL,
              active TINYINT NOT NULL DEFAULT 1,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              last_failed_at TIMESTAMP NULL,
              INDEX ix_webhooks_user_id (user_id),
              INDEX ix_webhooks_event (event)
            )
            """
        )
        logger.info("OK: webhooks ready")

        # token_id column
        logger.info("Ensuring releases.token_id exists...")
        token_col_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'releases' AND COLUMN_NAME = 'token_id'
            """
        ).scalar()
        if not token_col_exists:
            conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN token_id BIGINT NULL")
            logger.info("OK: releases.token_id added")
        else:
            logger.info("OK: releases.token_id already present")

        # metadata_ipfs_cid column
        logger.info("Ensuring releases.metadata_ipfs_cid exists...")
        mcol_exists = conn.exec_driver_sql(
            """
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'releases' AND COLUMN_NAME = 'metadata_ipfs_cid'
            """
        ).scalar()
        if not mcol_exists:
            conn.exec_driver_sql("ALTER TABLE releases ADD COLUMN metadata_ipfs_cid VARCHAR(128) NULL")
            logger.info("OK: releases.metadata_ipfs_cid added")
        else:
            logger.info("OK: releases.metadata_ipfs_cid already present")

    logger.info("Migration complete.")


if __name__ == "__main__":
    main()
