-- v2: background job history (BullMQ mirror), crawl progress, link graph, page signals

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NULL,
  queue VARCHAR(20) NOT NULL,
  type VARCHAR(40) NOT NULL,
  bull_id VARCHAR(64) NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  status ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  payload_json JSON NULL,
  result_json JSON NULL,
  error VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  UNIQUE KEY uq_idem (idempotency_key),
  KEY idx_jobs_org (org_id, id),
  KEY idx_jobs_site (site_id, type, id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

ALTER TABLE crawl_runs ADD COLUMN job_id BIGINT UNSIGNED NULL;
ALTER TABLE crawl_runs ADD COLUMN progress TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE crawl_runs ADD COLUMN config_json JSON NULL;
ALTER TABLE crawl_runs ADD KEY idx_runs_org (org_id, id);

ALTER TABLE pages ADD COLUMN signals_json JSON NULL;
ALTER TABLE pages ADD COLUMN robots_meta VARCHAR(100) NULL;
ALTER TABLE pages ADD COLUMN lang VARCHAR(20) NULL;
ALTER TABLE pages ADD COLUMN imgs_no_alt INT NULL;
ALTER TABLE pages ADD COLUMN h1_count INT NULL;
ALTER TABLE pages ADD COLUMN content_hash CHAR(32) NULL;

CREATE TABLE IF NOT EXISTS page_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  from_url VARCHAR(1000) NOT NULL,
  to_url VARCHAR(1000) NOT NULL,
  anchor VARCHAR(255) NULL,
  nofollow TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_links_run (run_id),
  FOREIGN KEY (run_id) REFERENCES crawl_runs(id) ON DELETE CASCADE
);
