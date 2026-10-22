# Database schema

MySQL 8, `utf8mb4`. Every tenant-owned table has `org_id BIGINT UNSIGNED NOT NULL` + index.
Migrations live in `db/migrations/NNN_*.sql`, applied in order by `api/src/db/migrate.js` which records them in
`schema_migrations`. 001 and 002 are the original schema (unchanged); 003+ are v2.

| Table | Key columns | Purpose |
|---|---|---|
| orgs | id, name, plan, created_at | tenant |
| users | id, org_id (default org), email UNIQUE, password_hash, role, status, email_verified_at | accounts |
| org_members | org_id, user_id, role(owner/admin/editor/viewer), UNIQUE(org_id,user_id) | membership (authoritative) |
| user_tokens | user_id, type(reset/verify), token_hash UNIQUE, expires_at, used_at | single-use tokens |
| audit_log | org_id, user_id, action, entity, entity_id, meta_json, ip, created_at | who did what |
| plans | code UNIQUE, name, price_paise, currency, limits_json, active | Free / Starter / Pro |
| subscriptions | org_id UNIQUE, plan_id, status(active/trialing/past_due/cancelled), provider, provider_id, period_start/end, cancel_at | one per org |
| payment_events | provider, provider_event_id UNIQUE, event_type, payload_json, processed_at | webhook dedupe |
| usage_monthly | org_id, period(YYYY-MM), metric, used, reserved, UNIQUE(org_id,period,metric) | quotas |
| sites | id, org_id, domain, url, status, config_json, gsc_* , UNIQUE(org_id,domain) | projects |
| jobs | id, org_id, site_id, queue, type, bull_id, idempotency_key UNIQUE, status, attempts, progress, result_json, error | job history |
| crawl_runs | id, org_id, site_id, job_id, status, pages_crawled, progress, summary_json, error | audits |
| pages | id, org_id, site_id, run_id, url, status, title, meta_description, h1, canonical, schema_types, word_count, response_time_s, inlinks, signals_json | per-URL results |
| page_links | run_id, site_id, from_url, to_url, anchor, nofollow | link graph |
| issues | id, org_id, site_id, run_id, type, severity, url, detail | audit findings |
| reports | id, org_id, site_id, run_id, kind, score, report_json, created_at | historical snapshots |
| keywords | id, org_id, site_id, term, cluster, cluster_id, intent, target_url, priority, status, demand, demand_src, difficulty, source | keyword plan |
| keyword_clusters | id, org_id, site_id, name, target_url, intent, size | clusters |
| ai_jobs | id, org_id, site_id, job_id, task, model, prompt_version, status, input_json, output_json, usage_units, duration_ms, error | AI metering |
| suggestions | id, org_id, site_id, page_url, type, source(ai/rule), payload_json, status(proposed/approved/rejected/applied), created_by, reviewed_by, reviewed_at, ai_job_id | approval queue |
| google_connections | org_id UNIQUE, refresh_token_enc, scope | OAuth |
| gsc_daily | org_id, site_id, date, query, page, clicks, impressions, ctr, position, row_hash UNIQUE | Search Console history |
| alerts, index_status, job_log | (as before) | automation |

Quota rule: a request may proceed only if `used + reserved + n <= limit` for the current period, enforced by a single
`UPDATE ... WHERE` statement (atomic under MySQL row locking). Workers call `settle(metric, reserved, actual)`.
