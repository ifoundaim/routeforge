## Quickstart (5 steps)

Prereqs:
- Python 3.11+
- TiDB/MySQL-compatible database DSN

Install dependencies once:
```bash
pip install -r requirements.txt
```

1) Environment
```bash
# Create .env with your DSN (example shown)
cat > .env << 'EOF'
TIDB_DSN=mysql+pymysql://user:password@host:4000/routeforge
# Optional tuning
# PORT=8000
# LOG_LEVEL=INFO
# EMBEDDING_ENABLED=0
# SIMILARITY_THRESHOLD=0.83
EOF
```

2) Migrate (create/update tables)
```bash
make migrate
```

3) Seed demo data
```bash
make seed
```

4) Run the API
```bash
make run
# Server: http://localhost:${PORT:-8000}
```

5) Validate with cURL
```bash
API="http://localhost:${PORT:-8000}"

# Health
curl -s "$API/healthz" | jq .

# Create a project
PROJECT=$(curl -s -X POST "$API/api/projects" \
  -H 'content-type: application/json' \
  -d '{"name":"RouteForge","owner":"routeforge","description":"demo"}')
echo "$PROJECT" | jq .
PROJECT_ID=$(echo "$PROJECT" | jq -r .id)

# Create a release
RELEASE=$(curl -s -X POST "$API/api/releases" \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"version":"1.0.0","artifact_url":"https://example.com/artifacts/1.0.0.tgz","notes":"init"}')
echo "$RELEASE" | jq .
RELEASE_ID=$(echo "$RELEASE" | jq -r .id)

# Create a route
ROUTE=$(curl -s -X POST "$API/api/routes" \
  -H 'content-type: application/json' \
  -d '{"project_id":'"$PROJECT_ID"',"slug":"demo","target_url":"https://example.com/downloads/latest","release_id":'"$RELEASE_ID"'}')
echo "$ROUTE" | jq .
ROUTE_ID=$(echo "$ROUTE" | jq -r .id)

# Redirect (302)
curl -i "$API/r/demo" | sed -n '1,5p'

# Hits
curl -s "$API/api/routes/$ROUTE_ID/hits" | jq .
```


