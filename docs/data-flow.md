## ASCII Data Flow

```
[Agent / client] --POST /agent/publish--> [API]
      |                                      |
      |                               ingest staging
      v                                      v
[releases_staging]                      [audit: ingest]
      |                                      |
      |--- search (embedding? fulltext?) ---> [similar releases]
      |                                      |
 decision: review <-- score>=threshold? -- yes
      |
     no
      v
[create release] -- optional embedding --> [releases]
      |                                      |
      v                                      v
[audit: publish]                        [mint route]
      |                                      |
      v                                      v
[route] <----------- slug minted ---------- [routes]
      |
      v
GET /r/{slug} --> 302 --> target_url
      |
      v
[route_hits] --count--> GET /api/routes/{id}/hits => {"count": N}
```

Notes:
- Vector similarity is used when `EMBEDDING_ENABLED=1` and embeddings exist; otherwise FULLTEXT (or LIKE) fallback is used.
- `dry_run=true` returns a decision without writing `releases`/`routes`.
- `force=true` bypasses the review decision even if similar releases are found above threshold.


