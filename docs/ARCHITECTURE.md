# FixMySEO — Architecture (v2, multi-tenant AI SEO SaaS)

This document supersedes `PLATFORM_PLAN.md` / `SAAS_ADDENDUM.md` where they conflict.
Goal: a Semrush-inspired, self-hostable SEO SaaS with **no paid APIs, no paid LLM APIs and no paid SaaS dependencies**.

## 1. Stack (final)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) + plain CSS | Already in repo; dashboard only |
| API | Node.js 22, Express 4, ESM JavaScript, zod | Thin HTTP layer: validate, authorize, enqueue, read |
| Workers | Node.js, **BullMQ** on Redis | Crawl, AI, Search Console sync, scheduler; retries, backoff, progress, concurrency |
| Database | MySQL 8 (`mysql2`) | Source of truth, tenant-scoped tables |
| Cache / queue | Redis 7 (`ioredis`) | BullMQ queues, rate-limit counters |
| Local LLM | **Ollama** (`/api/chat` with JSON-schema output) | Free, local; default model `qwen2.5:1.5b` (Apache-2.0) |
| Crawler | Node `fetch` (undici) + `cheerio` + `robots-parser` | Compliant, bounded, SSRF-safe; Playwright deliberately **not** included in v2 |
| Deploy | Docker Compose (mysql, redis, ollama, api, worker, web) or PM2 + nginx | One VPS |

The former Python `intel/` service (FastAPI crawler + Anthropic keyword research) is **retired**: its logic was ported to
Node (`api/src/seo/*`) so there is one language, one queue system and no paid LLM. The old code lives in `legacy/` for reference.

## 2. Process topology

```
 browser --> Next.js (web:3000) --> Express API (api:4000) --> MySQL
                                          |  enqueue             ^
                                          v                      | writes results
                                    Redis / BullMQ <------ worker process (api/src/worker.js)
                                                            |- queue "crawl" : audit a site (bounded crawler)
                                                            |- queue "ai"    : Ollama tasks (concurrency 1)
                                                            |- queue "gsc"   : Search Console sync / indexing
                                                            '- repeatable "scheduler" : daily/weekly per-site jobs
                                                                     |
                                                                     v
                                                               Ollama (11434)
```

Rules:
* HTTP handlers never crawl or call the LLM. They insert a `jobs` row, enqueue, and return `{ job_id }`.
* Workers run in a **separate process** (`npm run worker`) so heavy work never blocks the API.
* MySQL is the source of truth. Redis holds only queue state and rate-limit counters; it can be flushed.
* Every job carries `org_id`; the worker re-loads the site and asserts `site.org_id === job.org_id` before doing anything.
* Every job has an **idempotency key** (`jobs.idempotency_key` UNIQUE) so a double click or a retry cannot create two crawls.

## 3. Modules

| Module | Code |
|---|---|
| Config & env validation | `api/src/config.js` |
| Structured logging | `api/src/lib/logger.js` |
| Migrations | `db/migrations/*.sql`, `api/src/db/migrate.js` |
| Auth (JWT, bcrypt, reset, verify) | `api/src/routes/auth.js`, `api/src/middleware/auth.js` |
| Tenancy (orgs, members, roles) | `api/src/routes/orgs.js` |
| Audit log | `api/src/lib/audit.js`, `api/src/routes/audit.js` |
| Plans, subscriptions, quotas | `api/src/routes/billing.js`, `api/src/lib/quota.js` |
| Crawler + technical audit | `api/src/seo/crawler.js`, `analyze.js`, `issues.js`, `quality.js` |
| Reports (history, health score, deltas) | `api/src/seo/report.js` |
| Internal linking suggestions | `api/src/seo/links.js` |
| Content optimisation (on-page score) | `api/src/seo/content.js` |
| Keyword research + clustering | `api/src/seo/keywords.js` |
| Local AI engine (Ollama) | `api/src/ai/*`, `api/src/workers/ai.js` |
| Suggestions + approval workflow | `api/src/routes/ai.js` |
| Search Console OAuth + sync | `api/src/routes/google.js`, `api/src/workers/gsc.js` |
| Scheduler | `api/src/workers/scheduler.js` |

## 4. Data flow: audit

1. `POST /sites/:id/audit` -> role >= editor -> **reserve quota** `crawl_pages` (atomic) -> insert `crawl_runs` + `jobs` -> enqueue `crawl`.
2. Worker: validates host (SSRF), reads `robots.txt`, discovers sitemap, BFS crawl with limits (max pages, concurrency 4,
   15 s timeout, 2 MB body, same-origin, redirect re-validation), updates `jobs.progress`.
3. Worker stores `pages`, `page_links`, `issues`, builds a `reports` snapshot (health score + deltas vs previous run) and
   **settles** the quota with the real page count.
4. Failures: BullMQ retries (3 attempts, exponential backoff); the final failure marks `crawl_runs.status='failed'` and
   releases the reserved quota.

## 5. Data flow: AI suggestion

1. `POST /sites/:id/ai/:task` -> quota `ai_ops` reserve -> `ai_jobs` + `jobs` rows -> enqueue `ai`.
2. Worker builds a bounded prompt (inputs truncated), calls Ollama with a JSON schema, validates with zod, retries once on
   invalid JSON, records model / prompt version / duration / usage units.
3. Output becomes `suggestions` rows with `status='proposed'`. Nothing is published automatically: an **editor must
   approve** (`POST /suggestions/:id/approve`). `apply` only marks it applied and writes an audit entry; this product never
   pushes changes to the customer's site.
4. If Ollama is unreachable, `/health/ready` reports `ai: false`, AI endpoints return `503 ai_disabled`, and every
   deterministic feature keeps working.

The LLM is never asked for traffic, search-volume, ranking or backlink numbers. Those come only from Search Console
(observed) or are labelled *estimated* (autocomplete heuristics). We do not claim a proprietary keyword or backlink database.

## 6. Repository layout

```
fixmyseo/
  api/            Express API + BullMQ workers (one package)
    src/
      index.js            API entry
      worker.js           worker entry
      app.js              express app factory (used by tests)
      config.js           env validation
      db.js, db/migrate.js
      lib/                logger, secrets, audit, quota, queue, ssrf, url, mailer
      middleware/         auth (jwt, tenant, roles), rate limit
      routes/             auth, orgs, sites, crawl, keywords, ai, google, billing, audit
      seo/                crawler, analyze, issues, quality, links, content, keywords, report
      ai/                 ollama client, prompts (versioned), tasks
      workers/            crawl, ai, gsc, scheduler
    test/                 node:test unit + integration tests (+ fixture site)
  db/migrations/  numbered SQL migrations (001.. are the original schema)
  web/            Next.js dashboard
  docs/           this folder
  deploy/         PM2 ecosystem, nginx snippet, backup script, runbook
  legacy/         retired Python intel service (reference only)
```
