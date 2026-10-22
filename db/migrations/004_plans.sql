-- v2: plans, subscriptions, payment events, monthly usage (quotas live in data, not code)

CREATE TABLE IF NOT EXISTS plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  price_paise INT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  `interval` ENUM('month','year') NOT NULL DEFAULT 'month',
  limits_json JSON NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO plans (code, name, price_paise, limits_json) VALUES
  ('free', 'Free', 0,
   '{"sites":1,"crawl_pages":100,"ai_ops":10,"scheduled_audits":"none","gsc":false,"export":"basic"}'),
  ('starter', 'Starter', 49900,
   '{"sites":3,"crawl_pages":2000,"ai_ops":100,"scheduled_audits":"weekly","gsc":true,"export":"full"}'),
  ('pro', 'Pro', 99900,
   '{"sites":10,"crawl_pages":10000,"ai_ops":500,"scheduled_audits":"daily","gsc":true,"export":"full"}')
ON DUPLICATE KEY UPDATE name=VALUES(name), price_paise=VALUES(price_paise), limits_json=VALUES(limits_json);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL UNIQUE,
  plan_id INT UNSIGNED NOT NULL,
  status ENUM('active','trialing','past_due','cancelled') NOT NULL DEFAULT 'active',
  provider VARCHAR(20) NOT NULL DEFAULT 'test',
  provider_id VARCHAR(100) NULL,
  period_start TIMESTAMP NULL,
  period_end TIMESTAMP NULL,
  cancel_at TIMESTAMP NULL,
  grace_until TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

-- every existing org gets a subscription matching orgs.plan (default free)
INSERT IGNORE INTO subscriptions (org_id, plan_id, status, provider)
  SELECT o.id, p.id, 'active', 'test' FROM orgs o JOIN plans p ON p.code = IFNULL(o.plan, 'free');

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,
  provider_event_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  org_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider_event (provider, provider_event_id),
  KEY idx_pay_org (org_id)
);

CREATE TABLE IF NOT EXISTS usage_monthly (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  metric VARCHAR(30) NOT NULL,
  used INT UNSIGNED NOT NULL DEFAULT 0,
  reserved INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usage (org_id, period, metric),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
