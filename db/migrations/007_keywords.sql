-- v2: keyword tables moved from runtime DDL (automation.js) into migrations; clusters added

CREATE TABLE IF NOT EXISTS keywords (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  term VARCHAR(255) NOT NULL,
  cluster VARCHAR(255) NULL,
  intent VARCHAR(30) NULL,
  target_url VARCHAR(1000) NULL,
  priority INT NOT NULL DEFAULT 5,
  status ENUM('existing','gap','planned','written','partial','ignored') NOT NULL DEFAULT 'gap',
  demand TINYINT UNSIGNED NULL,
  demand_src VARCHAR(10) NULL,
  difficulty TINYINT UNSIGNED NULL,
  source VARCHAR(12) NOT NULL DEFAULT 'auto',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_term (site_id, term),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
ALTER TABLE keywords ADD COLUMN demand TINYINT UNSIGNED NULL;
ALTER TABLE keywords ADD COLUMN demand_src VARCHAR(10) NULL;
ALTER TABLE keywords ADD COLUMN difficulty TINYINT UNSIGNED NULL;
ALTER TABLE keywords ADD COLUMN source VARCHAR(12) NOT NULL DEFAULT 'auto';
ALTER TABLE keywords ADD COLUMN cluster_id BIGINT UNSIGNED NULL;
ALTER TABLE keywords MODIFY status ENUM('existing','gap','planned','written','partial','ignored') NOT NULL DEFAULT 'gap';
ALTER TABLE keywords ADD KEY idx_kw_org (org_id);

CREATE TABLE IF NOT EXISTS keyword_clusters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  ai_name VARCHAR(255) NULL,
  target_url VARCHAR(1000) NULL,
  intent VARCHAR(30) NULL,
  size INT NOT NULL DEFAULT 0,
  terms_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_site (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL,
  severity ENUM('high','med','low') NOT NULL,
  subject VARCHAR(1000) NOT NULL,
  detail VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_site (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS index_status (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(1000) NOT NULL,
  url_hash CHAR(32) NOT NULL,
  verdict VARCHAR(40) NULL,
  coverage VARCHAR(255) NULL,
  last_crawl VARCHAR(40) NULL,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_url (site_id, url_hash),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id BIGINT UNSIGNED NOT NULL,
  job VARCHAR(30) NOT NULL,
  status ENUM('ok','skip','error') NOT NULL,
  message VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_site_job (site_id, job),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
