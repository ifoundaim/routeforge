# Webhooks

Events
- route_hit
- release_published

Manage
- List: GET /api/webhooks
- Create: POST /api/webhooks with { "url": "https://...", "event": "route_hit|release_published" }
- Toggle: POST /api/webhooks/{id}/toggle

Delivery
- POST <url> with JSON body, headers include:
  - X-RF-Webhook-Event: <event>
  - X-RF-Webhook-Sign: hex(hmac_sha256(secret, body))

Verify (Python)
```python
import hmac, hashlib

def verify(secret: str, body: bytes, header: str) -> bool:
    expected = hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or '')
```

Payloads
- route_hit: { "route_id": 123, "slug": "foo" }
- release_published: { "release_id": 456, "project_id": 42 }
