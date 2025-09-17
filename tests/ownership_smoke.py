import os
import tempfile
import unittest
from pathlib import Path
from typing import Dict
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

# Configure the test database before importing app modules that rely on TIDB_DSN
_TMP_DIR = Path(tempfile.mkdtemp(prefix="routeforge-tests-"))
_TEST_DB_PATH = _TMP_DIR / "ownership_smoke.sqlite"
os.environ["TIDB_DSN"] = f"sqlite+pysqlite:///{_TEST_DB_PATH}"
os.environ.setdefault("AUTH_ENABLED", "0")

import app.routes_api as routes_api
from app import models
from app.app import app
from app.auth.accounts import create_user
from app.db import get_engine


engine = get_engine()
models.Base.metadata.create_all(engine)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

with SessionLocal() as session:
    user_a = create_user(session, email="user-a@example.com", name="User A")
    user_b = create_user(session, email="user-b@example.com", name="User B")
    TEST_USERS: Dict[str, Dict[str, object]] = {
        "A": {"user_id": int(user_a.id), "email": user_a.email, "name": user_a.name},
        "B": {"user_id": int(user_b.id), "email": user_b.email, "name": user_b.name},
    }


def _fake_require_user(request, db):
    header = request.headers.get("X-Test-User", "A")
    template = TEST_USERS.get(header)
    if template is None:
        raise AssertionError(f"Unknown test user header: {header}")
    session_user = {"user_id": template["user_id"], "email": template["email"], "name": template["name"]}
    request.state.user = session_user
    return session_user, None


class OwnershipGuardsSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.require_user_patcher = patch.object(routes_api, "_require_user", side_effect=_fake_require_user)
        cls.require_user_patcher.start()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.require_user_patcher.stop()

    def test_cross_user_access_is_blocked(self):
        project_resp = self.client.post(
            "/api/projects",
            json={"name": "Sample", "owner": "ignored", "description": None},
            headers={"X-Test-User": "A"},
        )
        self.assertEqual(project_resp.status_code, 201, project_resp.text)
        project_id = project_resp.json()["id"]

        release_payload = {
            "project_id": project_id,
            "version": "1.0.0",
            "artifact_url": "https://example.com/build.tar.gz",
            "notes": "initial",
        }
        release_resp = self.client.post(
            "/api/releases",
            json=release_payload,
            headers={"X-Test-User": "A"},
        )
        self.assertEqual(release_resp.status_code, 201, release_resp.text)
        release_id = release_resp.json()["id"]

        route_resp = self.client.post(
            "/api/routes",
            json={
                "project_id": project_id,
                "slug": "sample-route",
                "target_url": "https://example.com/landing",
                "release_id": release_id,
            },
            headers={"X-Test-User": "A"},
        )
        self.assertEqual(route_resp.status_code, 201, route_resp.text)
        route_id = route_resp.json()["id"]

        forbidden_release = self.client.post(
            "/api/releases",
            json={**release_payload, "version": "2.0.0"},
            headers={"X-Test-User": "B"},
        )
        self.assertEqual(forbidden_release.status_code, 403, forbidden_release.text)
        self.assertEqual(forbidden_release.json()["error"], "forbidden")

        forbidden_route = self.client.post(
            "/api/routes",
            json={
                "project_id": project_id,
                "slug": "blocked-route",
                "target_url": "https://example.com/other",
            },
            headers={"X-Test-User": "B"},
        )
        self.assertEqual(forbidden_route.status_code, 403, forbidden_route.text)
        self.assertEqual(forbidden_route.json()["error"], "forbidden")

        hidden_release = self.client.get(
            f"/api/releases/{release_id}",
            headers={"X-Test-User": "B"},
        )
        self.assertEqual(hidden_release.status_code, 404, hidden_release.text)
        self.assertEqual(hidden_release.json()["error"], "not_found")

        hidden_hits = self.client.get(
            f"/api/routes/{route_id}/hits",
            headers={"X-Test-User": "B"},
        )
        self.assertEqual(hidden_hits.status_code, 404, hidden_hits.text)
        self.assertEqual(hidden_hits.json()["error"], "not_found")


if __name__ == "__main__":
    unittest.main()
