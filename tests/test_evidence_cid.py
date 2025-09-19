from types import SimpleNamespace

from app.evidence import extract_ipfs_cid
from app.routes_evidence import get_release_evidence_uris


def test_extract_ipfs_cid_parses_valid_uri():
    assert extract_ipfs_cid("ipfs://bafybeiexample") == "bafybeiexample"


def test_extract_ipfs_cid_ignores_non_ipfs():
    assert extract_ipfs_cid("https://example.com") is None
    assert extract_ipfs_cid(None) is None


def test_get_release_evidence_uris_prefers_stored_cid(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.test")
    release = SimpleNamespace(evidence_ipfs_cid="bafybeiaux")
    uris = get_release_evidence_uris(12, release)
    assert uris["http"] == "https://app.test/api/releases/12/evidence.zip"
    assert uris["ipfs"] == "ipfs://bafybeiaux"


def test_get_release_evidence_uris_http_fallback(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.test")
    uris = get_release_evidence_uris(7, None)
    assert uris["http"] == "https://app.test/api/releases/7/evidence.zip"
    assert "ipfs" not in uris
