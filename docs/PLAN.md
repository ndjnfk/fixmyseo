# Phased plan and status

| Phase | Deliverable | Status |
|---|---|---|
| 1 Foundation | Config validation, structured logs, migrations runner, BullMQ queues, health checks, Docker Compose (mysql, redis, ollama, api, worker, web), test harness | done |
| 2 Auth + tenancy | org_members with roles, `/me`, members CRUD, password reset + email verification interfaces, rate limits, audit log, cross-tenant tests | done |
| 3 Crawler + audits | Node crawler (robots, sitemap, SSRF, limits, redirects), issue detection, quality checks, link graph, reports with history + deltas, internal-link and content-score endpoints, fixture-site tests | done |
| 4 Local AI | Ollama client (JSON schema, timeouts, retries), tasks: titles/meta, brief, FAQ, cluster names, issue explanation; metering; suggestions + approval; disabled-AI mode; mock-Ollama tests | done |
| 5 Plans + quotas | plans/subscriptions/usage tables, atomic reservation, enforcement in API and workers, test-mode plan change, HMAC webhook with dedupe, concurrency tests | done (real gateway = follow-up, needs merchant account) |
| 6 Search data + launch | GSC sync as queued job with backoff, scheduler on BullMQ repeatables, backup/restore script, runbook | done (load tests + monitoring stack = follow-up) |

## Follow-ups (not in this iteration)
* Razorpay (or other India gateway) live integration: needs merchant account; `billing/webhook/:provider` is ready for it.
* SMTP mailer implementation (`lib/mailer.js` interface exists; console transport in dev).
* Playwright rendering for JS-only sites (opt-in per site; heavy on a small VPS).
* Monitoring/alerting (Prometheus exporter) and load tests.
* Export to PDF/CSV (CSV export of issues exists via JSON; PDF is a follow-up).

## Running

```
cp .env.example .env            # fill secrets
docker compose up -d mysql redis ollama
docker compose exec ollama ollama pull qwen2.5:1.5b
cd api && npm install && npm run migrate && npm run dev     # API on :4000
cd api && npm run worker                                    # workers (separate terminal)
cd web && npm install && npm run dev                        # dashboard on :3000
cd api && npm test                                          # unit tests; integration tests need DB + Redis
```
