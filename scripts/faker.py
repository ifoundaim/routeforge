#!/usr/bin/env python3
"""Generate demo route hit traffic for RouteForge."""

import argparse
import logging
import os
import random
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Sequence, Tuple

from dotenv import load_dotenv

# Ensure repository root is importable when executed as a standalone script
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(CURRENT_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

load_dotenv()

logger = logging.getLogger("routeforge.faker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# Curated desktop and mobile user-agent strings for realism
USER_AGENTS: Sequence[str] = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Mobile Safari/537.36",
    "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0",
)

# Referrer mix containing common social sources and direct hits
REFERRERS: Sequence[Tuple[Optional[str], float]] = (
    ("https://twitter.com", 0.30),
    ("https://www.linkedin.com", 0.20),
    ("https://news.ycombinator.com", 0.15),
    (None, 0.35),  # direct traffic
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate demo traffic for existing routes.")
    parser.add_argument("--routes", type=int, default=10, help="Number of distinct routes to sample")
    parser.add_argument("--clicks", type=int, default=500, help="Total fake route hits to insert")
    parser.add_argument("--days", type=int, default=7, help="Distribute timestamps across the last D days")
    parser.add_argument("--dsn", dest="dsn", help="Database DSN (overrides TIDB_DSN env var)")
    return parser.parse_args()


def choose_referrer() -> Optional[str]:
    targets, weights = zip(*REFERRERS)
    return random.choices(targets, weights=weights, k=1)[0]


def random_ip() -> str:
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def connect_session(dsn: Optional[str]):
    from sqlalchemy.orm import sessionmaker
    from app.db import get_engine

    engine = get_engine(dsn)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return SessionLocal()


def load_routes(session, limit: int):
    from sqlalchemy import select
    from app.models import Route

    rows = session.execute(select(Route.id, Route.slug)).all()
    if not rows:
        return []

    sampled = rows if len(rows) <= limit else random.sample(rows, limit)
    return [(row[0], row[1]) for row in sampled]


def spread_timestamp(days: int) -> datetime:
    now = datetime.now(timezone.utc)
    if days <= 0:
        return now
    seconds_window = days * 24 * 60 * 60
    offset = random.randint(0, seconds_window)
    return now - timedelta(seconds=offset)


def main() -> int:
    args = parse_args()

    try:
        session = connect_session(args.dsn)
    except Exception as exc:  # connection / DSN issues -> non-zero exit
        logger.error("Unable to connect to database: %s", exc)
        return 1

    inserted = 0
    used_routes: List[int] = []

    try:
        routes = load_routes(session, max(args.routes, 1))
        if not routes:
            logger.warning("No routes found; nothing to insert.")
            print("Inserted 0 route hits across 0 routes")
            return 0

        from app.models import RouteHit

        hits = []
        for _ in range(max(args.clicks, 0)):
            route_id, _slug = random.choice(routes)
            hit = RouteHit(
                route_id=route_id,
                ts=spread_timestamp(args.days),
                ip=random_ip(),
                ua=random.choice(USER_AGENTS),
                ref=choose_referrer(),
            )
            hits.append(hit)
            used_routes.append(route_id)

        if hits:
            session.add_all(hits)
            session.commit()
            inserted = len(hits)
    except Exception as exc:
        session.rollback()
        logger.exception("Failed to generate fake traffic: %s", exc)
        return 1
    finally:
        session.close()

    distinct_routes = len(set(used_routes))
    distribution = Counter(used_routes)
    top_routes = ", ".join(
        f"{route_id}:{count}" for route_id, count in distribution.most_common(3)
    )

    print(f"Inserted {inserted} route hits across {distinct_routes} routes")
    if top_routes:
        print(f"Top route hit counts: {top_routes}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
