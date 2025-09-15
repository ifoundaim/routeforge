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
logger = logging.getLogger("routeforge.seed")


def main():
    parser = argparse.ArgumentParser(description="Seed demo data for RouteForge.")
    parser.add_argument("--demo", choices=["basic"], required=True, help="Demo dataset to seed")
    parser.add_argument("--dsn", dest="dsn", help="Database DSN (MySQL/TiDB)")
    args = parser.parse_args()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db import get_engine
    from app.models import Project, Release, Route

    dsn = args.dsn or os.getenv("TIDB_DSN")
    if not dsn:
        raise SystemExit("TIDB_DSN not provided. Use --dsn or set env TIDB_DSN.")

    engine = get_engine(dsn)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = SessionLocal()

    try:
        if args.demo == "basic":
            project = Project(name="RouteForge Demo", owner="routeforge", description="Demo project")
            db.add(project)
            db.commit()
            db.refresh(project)

            release = Release(
                project_id=project.id,
                version="1.0.0",
                artifact_url="https://example.com/artifacts/routeforge-1.0.0.tgz",
                notes="Initial demo release",
            )
            db.add(release)
            db.commit()
            db.refresh(release)

            route = Route(
                project_id=project.id,
                slug="demo",
                target_url="https://example.com/downloads/routeforge/latest",
                release_id=release.id,
            )
            db.add(route)
            db.commit()
            db.refresh(route)

            logger.info(
                "Seeded demo data: project_id=%s release_id=%s route_slug=%s",
                project.id,
                release.id,
                route.slug,
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()


