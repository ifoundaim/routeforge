# Webhooks

Events
- route_hit
- release_published

Manage
- List: GET /api/webhooks
- Create: POST /api/webhooks with { "url": "https://...", "event": "route_hit|release_published", "secret"?: string }
- Toggle: POST /api/webhooks/{id}/toggle
- Delete: DELETE /api/webhooks/{id}
- Test delivery: POST /api/webhooks/{id}/test

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

Curl example
```bash
# Create
curl -sS -X POST http://localhost:8000/api/webhooks \
  -H 'content-type: application/json' \
  -d '{"url":"https://webhook.site/your-id","event":"release_published","secret":"dev-secret"}'

# List
curl -sS http://localhost:8000/api/webhooks | jq

# Send test delivery (replace :id)
curl -sS -X POST http://localhost:8000/api/webhooks/1/test | jq

# Verify signature in a handler (pseudo-code)
# header: X-RF-Webhook-Sign
# event:  X-RF-Webhook-Event
```

Payloads
- route_hit: { "route_id": 123, "slug": "foo" }
- release_published: { "release_id": 456, "project_id": 42 }
