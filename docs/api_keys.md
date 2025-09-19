# API Keys (HMAC)

- Create a key: POST /api/keys (must be authenticated). Response contains key_id and secret (shown once).
- List keys: GET /api/keys
- Revoke key: POST /api/keys/revoke with { "key_id": "..." }

Signing a request
- Body is JSON; compute signature as hex(hmac_sha256(secret, raw_body_bytes))
- Headers:
  - X-RF-Key: <key_id>
  - X-RF-Sign: <hex>

Publish via HMAC
- Endpoint: POST /api/publish
- Body: { "project_id": 1, "artifact_url": "https://...", "notes": "optional" }
- On success: { "id": <release_id>, ... }
- Invalid signature -> 401 { "error": "hmac_invalid" }
