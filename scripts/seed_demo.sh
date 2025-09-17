#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"
TARGET_HITS=150
FAKE_DAYS=${DEMO_FAKE_DAYS:-14}
DSN="${TIDB_DSN:-}"

usage() {
  cat <<USAGE
Seed a known-good RouteForge v1.0 demo workspace.

Usage: $(basename "$0") [--dsn DSN] [--target-hits N] [--days N]

Options:
  --dsn DSN         Override the database DSN (defaults to TIDB_DSN env).
  --target-hits N   Desired total fake hits across minted demo routes (default: 150).
  --days N          Spread fake hits across the last N days (default: ${FAKE_DAYS}).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dsn)
      shift
      [[ $# -gt 0 ]] || { echo "--dsn requires a value" >&2; exit 1; }
      DSN="$1"
      ;;
    --target-hits)
      shift
      [[ $# -gt 0 ]] || { echo "--target-hits requires a value" >&2; exit 1; }
      TARGET_HITS="$1"
      ;;
    --days)
      shift
      [[ $# -gt 0 ]] || { echo "--days requires a value" >&2; exit 1; }
      FAKE_DAYS="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$DSN" ]]; then
  echo "TIDB_DSN is not set and no --dsn provided." >&2
  exit 1
fi

export PYTHONPATH="$ROOT_DIR:${PYTHONPATH:-}"
export ROUTEFORGE_DEMO_DSN="$DSN"
export ROUTEFORGE_DEMO_TARGET_HITS="$TARGET_HITS"
export ROUTEFORGE_DEMO_FAKE_DAYS="$FAKE_DAYS"
export ROUTEFORGE_DEMO_ROOT="$ROOT_DIR"

exec "$PYTHON_BIN" - <<'PY'
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from dotenv import load_dotenv
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

# Ensure repo root is importable
repo_root = os.environ["ROUTEFORGE_DEMO_ROOT"]
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

load_dotenv(os.path.join(repo_root, ".env"))

from app.db import get_engine
from app.models import Project, Release, Route, RouteHit
from app.auth.accounts import ensure_demo_user

DSN = os.environ["ROUTEFORGE_DEMO_DSN"]
TARGET_HITS = int(os.environ.get("ROUTEFORGE_DEMO_TARGET_HITS", "150"))
FAKE_DAYS = int(os.environ.get("ROUTEFORGE_DEMO_FAKE_DAYS", "14"))
PYTHON_BIN = os.environ.get("PYTHON", sys.executable)

engine = get_engine(DSN)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

release_specs = [
    {
        "version": "1.0.0",
        "artifact_url": "https://cdn.routeforge.dev/artifacts/routeforge-1.0.0.tgz",
        "notes": "Initial GA build",
    },
    {
        "version": "1.1.0",
        "artifact_url": "https://cdn.routeforge.dev/artifacts/routeforge-1.1.0.tgz",
        "notes": "Redirect analytics-lite + CSV export",
    },
    {
        "version": "1.2.0",
        "artifact_url": "https://cdn.routeforge.dev/artifacts/routeforge-1.2.0.tgz",
        "notes": "Agent publish automation + reliability polish",
    },
]

route_specs = [
    {
        "slug": "routeforge-demo-1-1-0",
        "version": "1.1.0",
        "target_url": "https://go.routeforge.dev/downloads/1.1.0",
    },
    {
        "slug": "routeforge-demo-1-2-0",
        "version": "1.2.0",
        "target_url": "https://go.routeforge.dev/downloads/1.2.0",
    },
]

USER_AGENTS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Mobile Safari/537.36",
    "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0",
)

REFERRERS = (
    ("https://twitter.com", 0.30),
    ("https://www.linkedin.com", 0.20),
    ("https://news.ycombinator.com", 0.15),
    (None, 0.35),
)


def choose_referrer() -> str | None:
    targets, weights = zip(*REFERRERS)
    return random.choices(targets, weights=weights, k=1)[0]


def random_ip() -> str:
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def spread_timestamp(days: int) -> datetime:
    now = datetime.now(timezone.utc)
    if days <= 0:
        return now
    seconds_window = days * 24 * 60 * 60
    offset = random.randint(0, seconds_window)
    return now - timedelta(seconds=offset)


def ensure_demo() -> Dict[str, object]:
    session = SessionLocal()
    summary: Dict[str, object] = {"project": {}, "releases": [], "routes": []}
    minted_ids: List[int] = []

    try:
        demo_user = ensure_demo_user(session)

        project = session.execute(
            select(Project)
            .where(
                Project.name == "RouteForge Demo",
                Project.user_id == demo_user.id,
            )
            .order_by(Project.id.asc())
            .limit(1)
        ).scalar_one_or_none()

        project_created = False
        project_updated = False
        if project is None:
            project = Project(
                name="RouteForge Demo",
                owner=demo_user.email,
                description="Golden demo workspace for RouteForge v1.0",
                user_id=demo_user.id,
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_created = True
        else:
            desired_owner = demo_user.email
            desired_description = "Golden demo workspace for RouteForge v1.0"
            if project.owner != desired_owner:
                project.owner = desired_owner
                project_updated = True
            if project.description != desired_description:
                project.description = desired_description
                project_updated = True
            if project.user_id != demo_user.id:
                project.user_id = demo_user.id
                project_updated = True
            if project_updated:
                session.commit()
                session.refresh(project)

        summary["project"] = {
            "id": project.id,
            "created": project_created,
            "updated": project_updated,
        }

        release_map = {}
        for spec in release_specs:
            release = session.execute(
                select(Release)
                .where((Release.project_id == project.id) & (Release.version == spec["version"]))
                .order_by(Release.id.asc())
                .limit(1)
            ).scalar_one_or_none()

            created = False
            updated = False
            if release is None:
                release = Release(
                    project_id=project.id,
                    version=spec["version"],
                    artifact_url=spec["artifact_url"],
                    notes=spec["notes"],
                    user_id=demo_user.id,
                )
                session.add(release)
                session.commit()
                session.refresh(release)
                created = True
            else:
                if release.artifact_url != spec["artifact_url"]:
                    release.artifact_url = spec["artifact_url"]
                    updated = True
                if release.notes != spec["notes"]:
                    release.notes = spec["notes"]
                    updated = True
                if release.user_id != demo_user.id:
                    release.user_id = demo_user.id
                    updated = True
                if updated:
                    session.commit()
                    session.refresh(release)

            release_map[spec["version"]] = release
            summary["releases"].append(
                {
                    "id": release.id,
                    "version": spec["version"],
                    "created": created,
                    "updated": updated,
                }
            )

        for spec in route_specs:
            release = release_map[spec["version"]]
            route = session.execute(
                select(Route)
                .where(Route.slug == spec["slug"])
                .order_by(Route.id.asc())
                .limit(1)
            ).scalar_one_or_none()

            created = False
            updated = False
            if route is None:
                route = Route(
                    project_id=project.id,
                    release_id=release.id,
                    slug=spec["slug"],
                    target_url=spec["target_url"],
                    user_id=demo_user.id,
                )
                session.add(route)
                session.commit()
                session.refresh(route)
                created = True
            else:
                if route.project_id != project.id:
                    route.project_id = project.id
                    updated = True
                if route.release_id != release.id:
                    route.release_id = release.id
                    updated = True
                if route.user_id != demo_user.id:
                    route.user_id = demo_user.id
                    updated = True
                if route.target_url != spec["target_url"]:
                    route.target_url = spec["target_url"]
                    updated = True
                if updated:
                    session.commit()
                    session.refresh(route)

            minted_ids.append(route.id)
            summary["routes"].append(
                {
                    "id": route.id,
                    "slug": spec["slug"],
                    "version": spec["version"],
                    "created": created,
                    "updated": updated,
                }
            )

        existing_hits = 0
        if minted_ids:
            existing_hits = int(
                session.scalar(
                    select(func.count(RouteHit.id)).where(RouteHit.route_id.in_(minted_ids))
                )
                or 0
            )

        summary["hits"] = {
            "target": TARGET_HITS,
            "before": existing_hits,
        }

        return summary, minted_ids
    finally:
        session.close()


def count_hits(route_ids: List[int]) -> int:
    if not route_ids:
        return 0
    session = SessionLocal()
    try:
        return int(
            session.scalar(
                select(func.count(RouteHit.id)).where(RouteHit.route_id.in_(route_ids))
            )
            or 0
        )
    finally:
        session.close()


def top_up_minted(route_ids: List[int], amount: int) -> int:
    if amount <= 0 or not route_ids:
        return 0
    session = SessionLocal()
    try:
        hits = []
        for index in range(amount):
            route_id = route_ids[index % len(route_ids)]
            hits.append(
                RouteHit(
                    route_id=route_id,
                    ts=spread_timestamp(FAKE_DAYS),
                    ip=random_ip(),
                    ua=random.choice(USER_AGENTS),
                    ref=choose_referrer(),
                )
            )
        session.add_all(hits)
        session.commit()
        return amount
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_faker(route_ids: List[int], amount: int) -> None:
    if amount <= 0:
        return
    faker_script = os.path.join(repo_root, "scripts", "faker.py")
    cmd = [
        PYTHON_BIN,
        faker_script,
        "--routes",
        str(max(len(route_ids), 1)),
        "--clicks",
        str(amount),
        "--days",
        str(FAKE_DAYS),
        "--dsn",
        DSN,
    ]
    subprocess.run(cmd, check=True)


summary, minted_route_ids = ensure_demo()
current_hits = summary["hits"]["before"]
missing = max(TARGET_HITS - current_hits, 0)
summary["hits"]["needed"] = missing

if missing > 0:
    run_faker(minted_route_ids, missing)
    hits_after_faker = count_hits(minted_route_ids)
    remaining = max(TARGET_HITS - hits_after_faker, 0)
    manual_added = 0
    if remaining > 0:
        manual_added = top_up_minted(minted_route_ids, remaining)
    final_hits = count_hits(minted_route_ids)
    summary["hits"]["after"] = final_hits
    summary["hits"]["generated"] = final_hits - current_hits
    summary["hits"]["manual_top_up"] = manual_added
else:
    summary["hits"]["after"] = current_hits
    summary["hits"]["generated"] = 0
    summary["hits"]["manual_top_up"] = 0

print(json.dumps(summary, indent=2))
print("Seed demo complete.")
PY
