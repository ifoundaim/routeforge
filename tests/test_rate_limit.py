from starlette.testclient import TestClient

from app.app import app


def test_redirect_rate_limit_returns_429(monkeypatch):
    # Tighten window for test determinism
    monkeypatch.setenv("RATE_LIMIT_LIMIT", "3")
    monkeypatch.setenv("RATE_LIMIT_WINDOW_SEC", "60")

    client = TestClient(app)

    # Without DB configured, redirect returns 404 after rate check. We only assert 429 on overflow.
    for _ in range(3):
        res = client.get("/r/demo", headers={"X-Forwarded-For": "1.2.3.4"})
        assert res.status_code in (404, 422) or res.status_code == 200

    # Next one should be 429
    res = client.get("/r/demo", headers={"X-Forwarded-For": "1.2.3.4"})
    assert res.status_code == 429
    body = res.json()
    assert body.get("error") == "rate_limited"

