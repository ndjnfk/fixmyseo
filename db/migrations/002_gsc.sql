CREATE TABLE IF NOT EXISTS google_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  google_email VARCHAR(255) NULL,
  refresh_token_enc TEXT NOT NULL,
  scope VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

-- columns sirf tab jodo jab pehle se na hon (MySQL mein ADD COLUMN IF NOT EXISTS nahi hai); dobara chalana safe hai
SET @add_gsc = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE sites ADD COLUMN gsc_property VARCHAR(500) NULL, ADD COLUMN gsc_last_sync TIMESTAMP NULL, ADD COLUMN gsc_sync_error VARCHAR(500) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'gsc_property');
PREPARE add_gsc FROM @add_gsc;
EXECUTE add_gsc;
DEALLOCATE PREPARE add_gsc;

CREATE TABLE IF NOT EXISTS gsc_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  date DATE NOT NULL,
  query VARCHAR(500) NOT NULL,
  page VARCHAR(1000) NOT NULL,
  clicks INT NOT NULL,
  impressions INT NOT NULL,
  ctr FLOAT NOT NULL,
  position FLOAT NOT NULL,
  row_hash CHAR(32) NOT NULL,
  UNIQUE KEY uq_row (row_hash),
  KEY idx_site_date (site_id, date),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
