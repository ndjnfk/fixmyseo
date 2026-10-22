-- v2: local AI (Ollama) job metering and human-approved suggestions

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  job_id BIGINT UNSIGNED NULL,
  task VARCHAR(40) NOT NULL,
  model VARCHAR(80) NULL,
  prompt_version VARCHAR(20) NULL,
  status ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  input_json JSON NULL,
  output_json JSON NULL,
  usage_units INT UNSIGNED NOT NULL DEFAULT 1,
  prompt_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  duration_ms INT UNSIGNED NULL,
  error VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  KEY idx_ai_site (site_id, id),
  KEY idx_ai_org (org_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suggestions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  page_url VARCHAR(1000) NULL,
  type VARCHAR(40) NOT NULL,
  source ENUM('ai','rule') NOT NULL DEFAULT 'ai',
  title VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('proposed','approved','rejected','applied') NOT NULL DEFAULT 'proposed',
  ai_job_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  review_note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sugg_site (site_id, status, id),
  KEY idx_sugg_org (org_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
