"""Helpers for S3-compatible storage (AWS S3, Cloudflare R2, etc.)."""
from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import os
from typing import Dict
from urllib.parse import quote, urlparse

__all__ = ["presign_put"]


class S3ConfigError(RuntimeError):
    """Raised when required S3 configuration is missing."""


def _get_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise S3ConfigError(f"Missing environment variable: {name}")
    return value


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def _canonical_query(params: Dict[str, str]) -> str:
    items = sorted((quote(k, safe="-_.~"), quote(v, safe="-_.~")) for k, v in params.items())
    return "&".join(f"{k}={v}" for k, v in items)


def _canonical_uri(bucket: str, key: str) -> str:
    # Always use path-style addressing for compatibility with R2 and custom endpoints.
    # Keys may include slashes so preserve them when quoting.
    key_part = "/".join(quote(part, safe="-_.~") for part in key.split("/"))
    return f"/{bucket}/{key_part}"


def _build_public_url(endpoint: str, bucket: str, key: str) -> str:
    base_override = os.getenv("S3_PUBLIC_BASE_URL") or os.getenv("S3_PUBLIC_ENDPOINT")
    target = base_override or endpoint
    target = target.strip()
    if not target:
        raise S3ConfigError("S3 public endpoint is empty")
    if "//" not in target:
        target = f"https://{target}"

    parsed = urlparse(target)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or parsed.path
    base_path = parsed.path if parsed.netloc else ""
    base_path = base_path.rstrip("/")

    if base_path.endswith(f"/{bucket}"):
        prefix = base_path
    elif base_path:
        prefix = f"{base_path}/{bucket}"
    else:
        prefix = f"/{bucket}"

    if not prefix.startswith("/"):
        prefix = f"/{prefix}"

    key_part = "/".join(quote(part, safe="-_.~") for part in key.split("/"))
    final_path = f"{prefix.rstrip('/')}/{key_part}"

    return f"{scheme}://{netloc}{final_path}"


def presign_put(key: str, content_type: str, *, expires_in: int | None = None) -> Dict[str, object]:
    """Return a presigned PUT request payload for direct uploads.

    Parameters
    ----------
    key:
        Object key (path within the bucket).
    content_type:
        MIME type that clients should send when uploading.
    expires_in:
        Lifetime of the presigned URL in seconds. Defaults to ``S3_PRESIGN_EXPIRES`` env or 900.
    """

    endpoint = _get_env("S3_COMPAT_ENDPOINT").rstrip("/")
    bucket = _get_env("S3_BUCKET")
    access_key = _get_env("S3_ACCESS_KEY")
    secret_key = _get_env("S3_SECRET_KEY")
    region = os.getenv("S3_REGION", "us-east-1")

    if not content_type:
        content_type = "application/octet-stream"

    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        raise S3ConfigError("S3_COMPAT_ENDPOINT must include a scheme, e.g. https://example.com")

    host = parsed.netloc
    base_path = parsed.path.rstrip("/")

    method = "PUT"
    service = "s3"
    now = _dt.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"

    expires_default = int(os.getenv("S3_PRESIGN_EXPIRES", "900"))
    expires = expires_in or expires_default

    canonical_uri = _canonical_uri(bucket, key)
    canonical_headers = f"host:{host}\n"
    signed_headers = "host"
    payload_hash = "UNSIGNED-PAYLOAD"

    canonical_query_params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{access_key}/{credential_scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": signed_headers,
    }
    canonical_querystring = _canonical_query(canonical_query_params)

    canonical_request = "\n".join(
        [
            method,
            f"{base_path}{canonical_uri}" if base_path else canonical_uri,
            canonical_querystring,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )

    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    signing_key = _get_signature_key(secret_key, date_stamp, region, service)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    signed_query = f"{canonical_querystring}&X-Amz-Signature={signature}"
    url = f"{parsed.scheme}://{host}{base_path}{canonical_uri}?{signed_query}"

    public_url = _build_public_url(endpoint, bucket, key)

    return {
        "url": url,
        "method": method,
        "headers": {"Content-Type": content_type},
        "key": key,
        "public_url": public_url,
    }
