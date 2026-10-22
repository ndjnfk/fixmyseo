-- Multi-tenant core schema. Har tenant-data table mein org_id.
-- Jo database select hai usi mein chalti hai (mysql fixmyseo < 001_schema.sql). Dobara chalana safe hai.

CREATE TABLE IF NOT EXISTS orgs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  plan VARCHAR(30) NOT NULL DEFAULT 'free',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE IF NOT EXISTS sites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  domain VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  framework VARCHAR(30) NULL,
  status ENUM('active','paused') NOT NULL DEFAULT 'active',
  config_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_domain (org_id, domain),
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  pages_crawled INT NOT NULL DEFAULT 0,
  summary_json JSON NULL,
  error TEXT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  KEY idx_site (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(1000) NOT NULL,
  status VARCHAR(20) NULL,
  title VARCHAR(500) NULL,
  meta_description TEXT NULL,
  h1 VARCHAR(500) NULL,
  canonical VARCHAR(1000) NULL,
  schema_types VARCHAR(500) NULL,
  word_count INT NULL,
  response_time_s DECIMAL(6,2) NULL,
  inlinks INT NULL,
  KEY idx_run (run_id),
  KEY idx_site (site_id),
  FOREIGN KEY (run_id) REFERENCES crawl_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issues (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL,
  severity ENUM('high','med','low') NOT NULL,
  url VARCHAR(1000) NULL,
  detail VARCHAR(500) NULL,
  KEY idx_run (run_id),
  KEY idx_site (site_id),
  FOREIGN KEY (run_id) REFERENCES crawl_runs(id) ON DELETE CASCADE
);

-- Phase 2 mein: tasks, keywords, clusters, gsc_daily, ga4_daily, content_items, audit_log
