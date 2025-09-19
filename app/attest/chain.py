from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from typing import Dict, Optional


class AttestationError(Exception):
    """Base exception for attestation failures."""

    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass
class AttestationResult:
    tx_hash: str
    metadata_uri: Optional[str]
    token_id: Optional[int]
    mode: str


def _mint_mode() -> str:
    mode = (os.getenv("MINT_MODE") or "demo").strip().lower()
    if mode in {"testnet", "nft"}:
        return "testnet"
    return "demo"


class ChainClient:
    """Demo chain client that records attestation metadata."""

    def __init__(self) -> None:
        self._mode = _mint_mode()

    def send_log(self, *, release_id: int, metadata: Dict[str, str], release_info: Dict[str, Optional[str]]) -> AttestationResult:
        tx_hash = self._fake_hash("log", release_id)
        return AttestationResult(
            tx_hash=tx_hash,
            metadata_uri=metadata.get("evidence_uri"),
            token_id=None,
            mode=self._mode,
        )

    def mint_nft(self, *, release_id: int, metadata: Dict[str, str], release_info: Dict[str, Optional[str]]) -> AttestationResult:
        tx_hash = self._fake_hash("nft", release_id)
        token_id = release_id if self._mode == "testnet" else None
        return AttestationResult(
            tx_hash=tx_hash,
            metadata_uri=metadata.get("evidence_uri"),
            token_id=token_id,
            mode=self._mode,
        )

    @staticmethod
    def _fake_hash(kind: str, release_id: int) -> str:
        suffix = secrets.token_hex(8)
        return f"{kind}-{release_id}-{suffix}"


__all__ = ["AttestationError", "AttestationResult", "ChainClient"]
