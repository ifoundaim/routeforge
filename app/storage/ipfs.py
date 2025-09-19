from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict, Optional, Tuple

import httpx


logger = logging.getLogger("routeforge.storage.ipfs")


def _detect_provider() -> Tuple[Optional[str], Optional[str]]:
    """Return (provider, token) where provider is 'web3' or 'pinata'."""
    provider = (os.getenv("EVIDENCE_IPFS_PROVIDER") or os.getenv("IPFS_PROVIDER") or "").strip().lower()
    token = None

    # Prefer explicit tokens
    web3_token = (os.getenv("WEB3_STORAGE_TOKEN") or "").strip()
    pinata_jwt = (os.getenv("PINATA_JWT") or "").strip()
    pinata_key = (os.getenv("PINATA_API_KEY") or "").strip()
    pinata_secret = (os.getenv("PINATA_SECRET_API_KEY") or "").strip()

    if provider == "web3" or (web3_token and provider in {None, ""}):
        return "web3", web3_token or None

    if provider == "pinata" or pinata_jwt or (pinata_key and pinata_secret):
        if pinata_jwt:
            return "pinata", pinata_jwt
        if pinata_key and pinata_secret:
            # Construct HTTP Basic token for Pinata key/secret
            raw = f"{pinata_key}:{pinata_secret}".encode("utf-8")
            basic = base64.b64encode(raw).decode("ascii")
            return "pinata_basic", basic

    return None, None


def pin_bytes(filename: str, content: bytes) -> Optional[str]:
    provider, token = _detect_provider()
    if provider is None:
        logger.info("IPFS provider not configured; skipping pin.")
        return None

    try:
        if provider == "web3":
            return _pin_web3(filename, content, token)
        if provider == "pinata":
            return _pin_pinata_jwt(filename, content, token)
        if provider == "pinata_basic":
            return _pin_pinata_basic(filename, content, token)
    except Exception as exc:
        logger.warning("IPFS pin failed via %s: %s", provider, exc)
        return None

    logger.warning("Unknown IPFS provider: %s", provider)
    return None


def pin_json(obj: Dict[str, Any], *, filename: str = "metadata.json") -> Optional[str]:
    payload = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return pin_bytes(filename, payload)


def _pin_web3(filename: str, content: bytes, token: Optional[str]) -> Optional[str]:
    if not token:
        raise RuntimeError("WEB3_STORAGE_TOKEN missing")
    headers = {
        "Authorization": f"Bearer {token}",
        "X-NAME": filename,
        "Content-Type": "application/octet-stream",
    }
    resp = httpx.post("https://api.web3.storage/upload", headers=headers, content=content, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()
    cid = data.get("cid") or data.get("value", {}).get("cid")
    return cid


def _pin_pinata_jwt(filename: str, content: bytes, token: Optional[str]) -> Optional[str]:
    if not token:
        raise RuntimeError("PINATA_JWT missing")
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": (filename, content, "application/octet-stream")}
    resp = httpx.post("https://api.pinata.cloud/pinning/pinFileToIPFS", headers=headers, files=files, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()
    return data.get("IpfsHash")


def _pin_pinata_basic(filename: str, content: bytes, basic_token: Optional[str]) -> Optional[str]:
    if not basic_token:
        raise RuntimeError("PINATA API key/secret missing")
    headers = {"Authorization": f"Basic {basic_token}"}
    files = {"file": (filename, content, "application/octet-stream")}
    resp = httpx.post("https://api.pinata.cloud/pinning/pinFileToIPFS", headers=headers, files=files, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()
    return data.get("IpfsHash")


__all__ = ["pin_json", "pin_bytes"]


