-- SCHEMA: RouteForge

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  owner VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS releases (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  version VARCHAR(64) NOT NULL,
  notes TEXT,
  artifact_url TEXT NOT NULL,
  -- Prefer TiDB VECTOR type if available in your cluster (>= v7.x):
  embedding VECTOR(768) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_releases_project (project_id),
  CONSTRAINT fk_releases_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS routes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  release_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_routes_project (project_id),
  CONSTRAINT fk_routes_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_routes_release FOREIGN KEY (release_id) REFERENCES releases(id)
);

CREATE TABLE IF NOT EXISTS route_hits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_id BIGINT NOT NULL,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64),
  ua TEXT,
  ref TEXT,
  INDEX ix_hits_route (route_id),
  CONSTRAINT fk_hits_route FOREIGN KEY (route_id) REFERENCES routes(id)
);

CREATE TABLE IF NOT EXISTS releases_staging (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  artifact_url TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(64) NOT NULL,
  meta JSON,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_audit_ts (ts)
);

-- --------
-- FULL-TEXT FALLBACK (safe to keep even if VECTOR works)
-- If your cluster doesn’t support FULLTEXT, ignore; if it does, this helps search.
-- (TiDB emulates FULLTEXT via plugin in some setups—okay if no-op.)
ALTER TABLE releases ADD FULLTEXT INDEX ft_releases_notes_version (notes, version);
