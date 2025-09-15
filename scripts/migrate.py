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
    parser = argparse.ArgumentParser(description="Create database tables if not exist.")
    parser.add_argument("--dsn", dest="dsn", help="Database DSN (MySQL/TiDB)")
    args = parser.parse_args()

    from app.db import get_engine
    from app.models import Base

    dsn = args.dsn or os.getenv("TIDB_DSN")
    if not dsn:
        raise SystemExit("TIDB_DSN not provided. Use --dsn or set env TIDB_DSN.")

    engine = get_engine(dsn)
    logger.info("Creating tables on DSN host...")
    Base.metadata.create_all(engine)
    logger.info("Migration complete.")


if __name__ == "__main__":
    main()


