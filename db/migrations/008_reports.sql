-- v2: historical report snapshots (one per finished audit + weekly summaries)

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NULL,
  kind ENUM('audit','weekly') NOT NULL DEFAULT 'audit',
  score TINYINT UNSIGNED NULL,
  pages INT UNSIGNED NULL,
  issues_high INT UNSIGNED NULL,
  issues_med INT UNSIGNED NULL,
  issues_low INT UNSIGNED NULL,
  report_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reports_site (site_id, id),
  KEY idx_reports_org (org_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
