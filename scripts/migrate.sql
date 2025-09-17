-- SCHEMA: RouteForge

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  owner VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_projects_user_id (user_id),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS releases (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  version VARCHAR(64) NOT NULL,
  notes TEXT,
  artifact_url TEXT NOT NULL,
  -- embedding column: use LONGBLOB for broad MySQL compatibility (VECTOR in TiDB handled by Python migrator)
  embedding LONGBLOB NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_releases_project (project_id),
  INDEX ix_releases_user_id (user_id),
  CONSTRAINT fk_releases_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_releases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  release_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_routes_project (project_id),
  INDEX ix_routes_user_id (user_id),
  CONSTRAINT fk_routes_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_routes_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE SET NULL,
  CONSTRAINT fk_routes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS route_hits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_id BIGINT NOT NULL,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64),
  ua TEXT,
  ref TEXT,
  INDEX ix_hits_route (route_id),
  CONSTRAINT fk_hits_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
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

-- Enforce NOT NULL user ownership after backfill migrations
ALTER TABLE projects MODIFY COLUMN user_id BIGINT NOT NULL;
ALTER TABLE releases MODIFY COLUMN user_id BIGINT NOT NULL;
ALTER TABLE routes MODIFY COLUMN user_id BIGINT NOT NULL;

-- --------
-- FULL-TEXT FALLBACK (safe to keep even if VECTOR works)
-- If your cluster doesn’t support FULLTEXT, ignore; if it does, this helps search.
-- (TiDB emulates FULLTEXT via plugin in some setups—okay if no-op.)
ALTER TABLE releases ADD FULLTEXT INDEX ft_releases_notes_version (notes, version);
