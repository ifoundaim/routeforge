from __future__ import annotations

import json
import logging
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from .. import models
from ..db import try_get_session
from ..evidence import persist_evidence_ipfs_cid
from ..routes_evidence import get_release_evidence_uris
from ..storage.ipfs import pin_json
from .metadata import build_nft_metadata


logger = logging.getLogger("routeforge.attest.chain")

_DEFAULT_CHAIN_ID = 84532
_DEFAULT_CHAIN_NAME = "Base Sepolia"
_DEFAULT_RPC_URL = "https://sepolia.base.org"
_DEFAULT_EXPLORER_TX = "https://sepolia.basescan.org/tx"
_DEFAULT_MINT_SIGNATURE = "safeMint(address,string)"
_DEFAULT_ERC721_ABI: List[Dict[str, Any]] = [
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "string", "name": "uri", "type": "string"},
        ],
        "name": "safeMint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "string", "name": "uri", "type": "string"},
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


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
    if mode == "off":
        return "off"
    return "demo"


class ChainClient:
    """Chain client capable of direct minting with wallet relay fallback."""

    def __init__(self) -> None:
        self._mode = _mint_mode()
        raw_rpc_url = os.getenv("BASE_RPC_URL") or ""
        rpc_url_candidate = (raw_rpc_url or _DEFAULT_RPC_URL).strip()
        self._rpc_url = rpc_url_candidate or _DEFAULT_RPC_URL
        self._base_rpc_env_set = bool(raw_rpc_url.strip())
        self._contract_address = (os.getenv("NFT_CONTRACT") or "").strip()
        self._abi_path = (os.getenv("NFT_ABI_PATH") or "").strip()
        self._mint_signature = (os.getenv("NFT_MINT_FN") or _DEFAULT_MINT_SIGNATURE).strip() or _DEFAULT_MINT_SIGNATURE
        self._private_key = (os.getenv("MINT_PRIVKEY") or "").strip()
        self._requires_wallet = self._private_key == ""
        self._custodial_enabled = bool(self._private_key)
        self._wallet_enabled = self._mode != "off"
        explorer_override = (os.getenv("BASE_EXPLORER_TX") or "").strip()
        self._explorer_tx_base = explorer_override or _DEFAULT_EXPLORER_TX
        self._chain_id = _DEFAULT_CHAIN_ID
        self._chain_name = _DEFAULT_CHAIN_NAME

        self._abi = self._load_abi()
        self._mint_name, self._mint_inputs = self._parse_signature(self._mint_signature)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def describe_config(self) -> Dict[str, Any]:
        has_contract = self._has_contract()
        return {
            "chain_id": self._chain_id,
            "chain_name": self._chain_name,
            "rpc_url": self._rpc_url,
            "contract": self._contract_address or None,
            "mint_function": self._mint_signature,
            "mint_inputs": list(self._mint_inputs),
            "abi": self._abi if has_contract else None,
            "requires_wallet": self._requires_wallet,
            "mode": self._mode,
            "explorer_tx_base": self._explorer_tx_base,
            "wallet_enabled": self._wallet_enabled,
            "custodial_enabled": self._custodial_enabled,
            "abi_fn": self._mint_signature,
            "base_rpc_url_set": self._base_rpc_env_set or self._rpc_url != _DEFAULT_RPC_URL,
        }

    # ------------------------------------------------------------------
    # Mint + log flows
    # ------------------------------------------------------------------
    def send_log(
        self,
        *,
        release_id: int,
        metadata: Dict[str, str],
        release_info: Dict[str, Optional[str]],
    ) -> AttestationResult:
        tx_hash = self._fake_hash("log", release_id)
        metadata_uri = self._ensure_metadata_uri(release_id, metadata, release_info)
        return AttestationResult(
            tx_hash=tx_hash,
            metadata_uri=metadata_uri,
            token_id=None,
            mode=self._mode,
        )

    def mint_nft(
        self,
        *,
        release_id: int,
        metadata: Dict[str, str],
        release_info: Dict[str, Optional[str]],
        tx_hash: Optional[str] = None,
        signed_tx: Optional[str] = None,
    ) -> AttestationResult:
        if self._mode == "off":
            logger.info("Mint disabled via MINT_MODE=off; using log fallback")
            return self.send_log(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )

        if not self._has_contract():
            logger.info("Mint fallback to log path: contract or ABI not configured")
            return self.send_log(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )

        metadata_uri = self._ensure_metadata_uri(release_id, metadata, release_info)

        relay_hash: Optional[str] = tx_hash
        if signed_tx:
            relay_hash = self._relay_raw_transaction(signed_tx)

        if relay_hash:
            logger.info("Mint recorded using wallet transaction %s", relay_hash)
            token_id = self._try_persist_token_id(release_id, relay_hash)
            return AttestationResult(
                tx_hash=relay_hash,
                metadata_uri=metadata_uri,
                token_id=token_id,
                mode=self._mode,
            )

        if not self._requires_wallet:
            raise AttestationError("custodial_signer_not_implemented")

        raise AttestationError("wallet_tx_hash_required")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _has_contract(self) -> bool:
        return bool(self._contract_address and self._abi)

    def _resolve_metadata_uri(self, release_id: int, metadata: Dict[str, str]) -> Optional[str]:
        session = try_get_session()
        release = None
        persisted_cid: Optional[str] = None
        try:
            if session is not None:
                release = session.get(models.Release, release_id)

            uris = get_release_evidence_uris(release_id, release)
            stored_ipfs = uris.get("ipfs")
            if stored_ipfs and release is not None:
                logger.info("Reusing stored evidence CID for release %s", release_id)
                metadata["evidence_uri"] = stored_ipfs
                return stored_ipfs

            evidence_uri = metadata.get("evidence_uri")
            if not evidence_uri:
                evidence_uri = uris.get("http")

            if session is not None and release is not None:
                persisted_cid = persist_evidence_ipfs_cid(session, release, evidence_uri)
            if persisted_cid:
                ipfs_uri = f"ipfs://{persisted_cid}"
                metadata["evidence_uri"] = ipfs_uri
                return ipfs_uri

            if evidence_uri:
                metadata["evidence_uri"] = evidence_uri
            return evidence_uri
        finally:
            if session is not None:
                session.close()

    def _ensure_metadata_uri(
        self, release_id: int, metadata: Dict[str, str], release_info: Dict[str, Optional[str]]
    ) -> Optional[str]:
        """Return ipfs://<cid> for metadata JSON, pinning/caching as needed.

        Falls back to evidence URI if IPFS is not configured.
        """
        # Ensure evidence_uri is set and CID persisted if available
        evidence_uri = self._resolve_metadata_uri(release_id, metadata)

        session = try_get_session()
        release = None
        try:
            if session is not None:
                release = session.get(models.Release, release_id)
            # Reuse existing metadata CID if present
            if release is not None and getattr(release, "metadata_ipfs_cid", None):
                return f"ipfs://{release.metadata_ipfs_cid}"

            # Build metadata JSON
            name = None
            ver = (release_info.get("version") if isinstance(release_info, dict) else None) or None
            if ver:
                name = f"RouteForge Release v{ver}"
            description = None
            metadata_obj = build_nft_metadata(
                release_id=release_id,
                name=name,
                description=description,
                evidence_uri=evidence_uri or "",
                artifact_sha256=metadata.get("artifact_sha256") or None,
                license_code=metadata.get("license_code") or None,
            )

            # Pin JSON to IPFS if configured
            cid = pin_json(metadata_obj, filename=f"release-{release_id}-metadata.json")
            if not cid:
                return evidence_uri

            if session is not None and release is not None:
                release.metadata_ipfs_cid = cid
                session.add(release)
                try:
                    session.commit()
                except Exception:
                    session.rollback()
                else:
                    logger.info("Persisted metadata CID %s for release %s", cid, release_id)

            return f"ipfs://{cid}"
        finally:
            if session is not None:
                session.close()

    def _fake_hash(self, kind: str, release_id: int) -> str:
        suffix = secrets.token_hex(8)
        return f"{kind}-{release_id}-{suffix}"

    def _load_abi(self) -> List[Dict[str, Any]]:
        if not self._abi_path:
            return _DEFAULT_ERC721_ABI

        candidate = Path(self._abi_path).expanduser()
        if not candidate.is_absolute():
            candidate = Path(os.getcwd()) / candidate

        try:
            data = json.loads(candidate.read_text())
        except FileNotFoundError:
            logger.warning("NFT_ABI_PATH %s not found; using default ABI", candidate)
            return _DEFAULT_ERC721_ABI
        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse ABI JSON %s: %s", candidate, exc)
            return _DEFAULT_ERC721_ABI

        if isinstance(data, list):
            return data

        logger.warning("ABI file %s is not a list; using default ABI", candidate)
        return _DEFAULT_ERC721_ABI

    @staticmethod
    def _parse_signature(signature: str) -> Tuple[str, Sequence[str]]:
        if "(" not in signature or not signature.endswith(")"):
            return signature, ()
        name, args = signature[:-1].split("(", 1)
        cleaned = [part.strip() for part in args.split(",") if part.strip()]
        return name.strip(), tuple(cleaned)

    def _relay_raw_transaction(self, raw_tx: str) -> str:
        payload = raw_tx.strip()
        if not payload.startswith("0x"):
            payload = f"0x{payload}"

        request = {
            "jsonrpc": "2.0",
            "method": "eth_sendRawTransaction",
            "params": [payload],
            "id": secrets.randbelow(1_000_000),
        }
        try:
            response = httpx.post(self._rpc_url, json=request, timeout=15.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Failed to relay raw transaction: %s", exc)
            raise AttestationError("relay_failed", status_code=502) from exc

        data = response.json()
        error = data.get("error") if isinstance(data, dict) else None
        if error:
            message = error.get("message", "rpc_error") if isinstance(error, dict) else "rpc_error"
            logger.error("RPC rejected raw transaction: %s", message)
            raise AttestationError("relay_rejected", status_code=502)

        result = data.get("result") if isinstance(data, dict) else None
        if not isinstance(result, str):
            raise AttestationError("relay_no_result", status_code=502)

        return result

    def _try_persist_token_id(self, release_id: int, tx_hash: str) -> Optional[int]:
        """Attempt to read tokenId from Transfer event logs and persist it.

        Returns the token_id if extracted; otherwise None.
        """
        # ERC-721 Transfer(address,address,uint256) topic0
        TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a7ca3b3b7a"

        # Fetch receipt
        request = {
            "jsonrpc": "2.0",
            "method": "eth_getTransactionReceipt",
            "params": [tx_hash],
            "id": secrets.randbelow(1_000_000),
        }
        receipt: Optional[Dict[str, Any]] = None
        try:
            response = httpx.post(self._rpc_url, json=request, timeout=15.0)
            response.raise_for_status()
            data = response.json()
            receipt = data.get("result") if isinstance(data, dict) else None
        except httpx.HTTPError:
            return None

        if not isinstance(receipt, dict):
            return None

        logs = receipt.get("logs")
        if not isinstance(logs, list):
            return None

        contract_addr = (self._contract_address or "").lower()
        token_id: Optional[int] = None
        for log in logs:
            if not isinstance(log, dict):
                continue
            if str(log.get("address", "")).lower() != contract_addr:
                continue
            topics = log.get("topics") or []
            if not (isinstance(topics, list) and len(topics) >= 4):
                continue
            topic0 = str(topics[0]).lower()
            if topic0 != TRANSFER_TOPIC0:
                continue
            try:
                token_hex = str(topics[3])
                token_id = int(token_hex, 16)
                break
            except Exception:
                continue

        if token_id is None:
            return None

        session = try_get_session()
        if session is None:
            return token_id
        try:
            release = session.get(models.Release, release_id)
            if release is None:
                return token_id
            if getattr(release, "token_id", None) is None:
                release.token_id = int(token_id)
                session.add(release)
                try:
                    session.commit()
                except Exception:
                    session.rollback()
                else:
                    logger.info("Persisted token_id=%s for release %s", token_id, release_id)
        finally:
            session.close()

        return token_id


class StarknetClient:
    """Minimal Starknet client used for wallet-submitted mints with demo fallback.

    Notes:
    - We do not relay transactions server-side; only accept a wallet-provided tx_hash.
    - If STARKNET_CONTRACT is not configured, we always fall back to demo log path.
    - Metadata URI handling mirrors the EVM client to ensure parity.
    """

    def __init__(self) -> None:
        self._rpc_url = (os.getenv("STARKNET_RPC_URL") or "").strip()
        self._contract_address = (os.getenv("STARKNET_CONTRACT") or "").strip()
        explorer_override = (os.getenv("STARKNET_EXPLORER") or "").strip()
        # Default explorer: Starkscan Sepolia
        self._explorer_tx_base = explorer_override or "https://sepolia.starkscan.co/tx"

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def describe_config(self) -> Dict[str, Any]:
        has_contract = bool(self._contract_address)
        mode = "starknet" if has_contract else "demo"
        return {
            "rpc_url": self._rpc_url or None,
            "contract": self._contract_address or None,
            "requires_wallet": True,
            "mode": mode,
            "explorer_tx_base": self._explorer_tx_base,
            "wallet_enabled": has_contract,
        }

    # ------------------------------------------------------------------
    # Flows
    # ------------------------------------------------------------------
    def send_log(
        self,
        *,
        release_id: int,
        metadata: Dict[str, str],
        release_info: Dict[str, Optional[str]],
    ) -> AttestationResult:
        tx_hash = f"starknet-log-{release_id}-{secrets.token_hex(8)}"
        metadata_uri = self._ensure_metadata_uri(release_id, metadata, release_info)
        return AttestationResult(
            tx_hash=tx_hash,
            metadata_uri=metadata_uri,
            token_id=None,
            mode="demo",
        )

    def mint_wallet(
        self,
        *,
        release_id: int,
        metadata: Dict[str, str],
        release_info: Dict[str, Optional[str]],
        tx_hash: Optional[str] = None,
    ) -> AttestationResult:
        # Not configured → always demo path
        if not self._contract_address:
            logger.info("Starknet not configured; using demo log path")
            return self.send_log(
                release_id=release_id,
                metadata=metadata,
                release_info=release_info,
            )

        metadata_uri = self._ensure_metadata_uri(release_id, metadata, release_info)

        if not tx_hash:
            # Wallet signature required for Starknet path
            raise AttestationError("wallet_tx_hash_required")

        # We do not introspect receipts for token_id on Starknet here.
        return AttestationResult(
            tx_hash=tx_hash,
            metadata_uri=metadata_uri,
            token_id=None,
            mode="starknet",
        )

    # ------------------------------------------------------------------
    # Internal helpers (reuse EVM helpers for metadata)
    # ------------------------------------------------------------------
    def _ensure_metadata_uri(
        self, release_id: int, metadata: Dict[str, str], release_info: Dict[str, Optional[str]]
    ) -> Optional[str]:
        # Delegate to shared logic in EVM client for parity
        # (copy the minimal code to avoid coupling)
        session = try_get_session()
        release = None
        persisted_cid: Optional[str] = None
        try:
            if session is not None:
                release = session.get(models.Release, release_id)

            uris = get_release_evidence_uris(release_id, release)
            stored_ipfs = uris.get("ipfs")
            if stored_ipfs and release is not None:
                logger.info("Reusing stored evidence CID for release %s", release_id)
                metadata["evidence_uri"] = stored_ipfs
                return stored_ipfs

            evidence_uri = metadata.get("evidence_uri")
            if not evidence_uri:
                evidence_uri = uris.get("http")

            if session is not None and release is not None:
                persisted_cid = persist_evidence_ipfs_cid(session, release, evidence_uri)
            if persisted_cid:
                ipfs_uri = f"ipfs://{persisted_cid}"
                metadata["evidence_uri"] = ipfs_uri
                return ipfs_uri

            if evidence_uri:
                metadata["evidence_uri"] = evidence_uri
            return evidence_uri
        finally:
            if session is not None:
                session.close()


__all__ = ["AttestationError", "AttestationResult", "ChainClient", "StarknetClient"]
