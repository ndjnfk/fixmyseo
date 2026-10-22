# Security model

## Tenant isolation
* Tenant = `orgs` row. Every tenant-owned table has `org_id` and an index on it.
* The client never supplies `org_id`. The JWT carries only `uid`; the active org is the user's default org or the
  `X-Org-Id` header, and **membership is verified on every request** (`org_members`). A non-member gets `403`.
* Site-scoped routes load the site with `WHERE id=? AND org_id=?`; a foreign site is a `404` (no existence leak).
* Workers re-check `site.org_id === job.org_id` before processing.
* Integration tests (`api/test/tenancy.test.js`) assert that user B cannot read, mutate, audit or approve anything of user A.

## Roles
| Role | Can |
|---|---|
| viewer | read everything in the org |
| editor | + run audits, AI tasks, approve/reject suggestions, edit keywords |
| admin | + site settings, add/remove sites, members, Google connection |
| owner | + billing / plan changes |

Enforced with `requireRole('editor')` etc. The frontend hides buttons, but **the API is the gate**.

## Authentication
* Passwords: bcrypt cost 12, min 8 chars. Login errors are generic ("invalid credentials").
* JWT HS256, 7-day expiry. `JWT_SECRET` must be >= 32 chars in production (startup fails otherwise).
* Password reset / email verification use single-use tokens stored **hashed** (`user_tokens`), 1 h / 24 h expiry.
  Mail delivery is an interface (`lib/mailer.js`): console in dev; plug SMTP later. No paid email API.
* Rate limits: `/auth/*` 20 req / 10 min / IP; all API 600 req / 15 min / IP (configurable).

## Secrets at rest
* Google refresh tokens: AES-256-GCM with `ENC_KEY` (64 hex). Rotating the key invalidates stored tokens by design.
* Payment webhook secrets, JWT secret, DB password only from environment. `.env` is git-ignored.

## Crawler safety (SSRF)
`lib/ssrf.js` + `seo/crawler.js`:
* Only `http:`/`https:`; host must resolve via DNS to **public unicast** addresses. Blocked: loopback, private
  (10/8, 172.16/12, 192.168/16), link-local (169.254/16 incl. cloud metadata `169.254.169.254`), CGNAT 100.64/10,
  `0.0.0.0/8`, multicast, reserved, IPv6 ULA / link-local / loopback, IPv4-mapped IPv6.
* Redirects are followed **manually** (max 5 hops) and every hop is re-validated; cross-origin redirects stop that URL.
* DNS is resolved per request and the resolved IP is pinned for the connection (undici `connect.lookup`) so a host cannot
  rebind to a private address between validation and fetch.
* Limits: max pages (plan), concurrency 4, 15 s timeout, 2 MB response cap, HTML only, polite delay,
  UA `FixMySEOBot/2.0`.
* `robots.txt` is honoured (`robots-parser`); disallowed URLs are recorded as skipped, never fetched.
* Tests: `api/test/ssrf.test.js` and `api/test/crawler.test.js` (local fixture site with private-IP links, redirect loop,
  oversize body, robots-disallowed path).
* `ALLOW_PRIVATE_HOSTS=1` exists only for tests/local fixtures and is refused when `NODE_ENV=production`.

## Jobs
* BullMQ `attempts: 3`, exponential backoff, history kept in MySQL `jobs`.
* Idempotency key per logical job; duplicates return the existing job.
* Quotas are reserved **atomically** (`UPDATE usage_monthly SET reserved=reserved+? WHERE used+reserved+? <= ?`)
  before enqueue and settled/released by the worker. Tested with concurrent reservations (`api/test/quota.test.js`).

## Billing webhooks
* `POST /billing/webhook/:provider` verifies an HMAC-SHA256 signature over the raw body with the provider secret, then
  inserts into `payment_events` (UNIQUE `provider_event_id`); duplicates are acknowledged and ignored.
* Subscription status is updated only from verified events, never from a browser redirect.

## HTTP hardening
`helmet`, strict CORS (single `WEB_ORIGIN`), JSON body limit 1 MB, zod validation on every body/query, generic 500s,
structured logs without secrets, `/health` (liveness) and `/health/ready` (db, redis, ollama).

## Audit log
`audit_log(org_id, user_id, action, entity, entity_id, meta_json, ip, created_at)` is written for: register, login,
member changes, site create/delete/settings, audit start, AI task start, suggestion approve/reject/apply, plan change,
Google connect/disconnect. `GET /audit-log` (admin) lists it.

## Out of scope / explicitly refused
Google SERP scraping, mass directory/backlink submission, fake reviews, auto-publishing AI content without approval.
