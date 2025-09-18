import os
from typing import Dict

import pytest
from fastapi.testclient import TestClient

from app.app import app
from app.routes_attest import _build_metadata_fields


EXPECTED_KEYS = {"artifact_sha256", "license_code", "evidence_uri"}


def test_build_metadata_fields_has_required_keys():
    metadata = _build_metadata_fields(42, None)
    assert EXPECTED_KEYS.issubset(metadata.keys())
    assert metadata["evidence_uri"].endswith("/api/releases/42/evidence.zip")


@pytest.mark.skipif(not os.getenv("TIDB_DSN"), reason="TIDB_DSN not configured")
@pytest.mark.parametrize("mode", ["log", "nft"])
def test_attest_route_emits_metadata(monkeypatch: pytest.MonkeyPatch, mode: str):
    monkeypatch.setenv("AUTH_ENABLED", "0")

    captured: Dict[str, str] = {}

    class _StubResult:
        tx_hash = "0xstub"
        metadata_uri = "ipfs://stub"
        token_id = 1
        mode = "demo"

    class _StubClient:
        def send_log(self, *, release_id: int, metadata: Dict[str, str], release_info: Dict[str, str]):
            captured.update(metadata)
            return _StubResult()

        def mint_nft(self, **kwargs):
            return self.send_log(**kwargs)

    monkeypatch.setattr("app.routes_attest.ChainClient", lambda: _StubClient())

    client = TestClient(app)
    response = client.post("/api/releases/1/attest", json={"mode": mode})
    assert response.status_code == 200
    assert EXPECTED_KEYS.issubset(captured.keys())
