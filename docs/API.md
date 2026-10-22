# API contracts

Base URL: `http://localhost:4000` (behind nginx: `https://host/fixmyseo/api`). JSON in, JSON out.
Auth: `Authorization: Bearer <jwt>`. Active org: the user's default org, or `X-Org-Id: <id>` (must be a member).
Errors: `{ "error": "<code or message>", "details"?: [...] }` with 400 / 401 / 403 / 404 / 409 / 429 / 503.
Long work never runs inside a request: endpoints marked **(job)** return `{ job_id }`; poll `GET /jobs/:id`.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness `{ ok: true }` |
| GET | `/health/ready` | `{ ok, db, redis, ai, model }` (503 if db or redis is down) |

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password(>=8), orgName }` | `{ token }` (creates org + owner membership) |
| POST | `/auth/login` | `{ email, password }` | `{ token }` |
| GET | `/me` | | `{ user: {id,email,email_verified}, org: {id,name,role,plan}, orgs: [...] }` |
| POST | `/auth/forgot` | `{ email }` | `{ ok: true }` always (token delivered via mailer) |
| POST | `/auth/reset` | `{ token, password }` | `{ ok }` |
| POST | `/auth/verify/request` | | `{ ok }` sends verification mail |
| POST | `/auth/verify` | `{ token }` | `{ ok }` |

Rate limited: 20 requests / 10 min / IP on `/auth/*`.

## Orgs and members (admin+)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/orgs` | | orgs the user belongs to |
| GET | `/org/members` | | members of active org |
| POST | `/org/members` | `{ email, role }` | user must already exist; role in viewer/editor/admin |
| PATCH | `/org/members/:userId` | `{ role }` | cannot change the owner |
| DELETE | `/org/members/:userId` | | cannot remove the owner |
| GET | `/audit-log?limit=` | | admin+ |

## Sites (projects)
| Method | Path | Body | Role |
|---|---|---|---|
| GET | `/sites` | | viewer |
| POST | `/sites` | `{ url, framework? }` | admin (quota `sites`) |
| GET | `/sites/:id` | | viewer: `{ site, runs, summary, issues }` |
| DELETE | `/sites/:id` | | admin |
| GET | `/sites/:id/pages` | | viewer (latest done run) |
| GET | `/sites/:id/automation` / PUT | config | viewer / admin |
| POST | `/sites/:id/automation/run` | `{ job }` | editor |

## Crawl / audit
| Method | Path | Notes |
|---|---|---|
| POST | `/sites/:id/audit` **(job)** | editor; `{ max_pages? }`; 409 if a run is active; reserves `crawl_pages` quota. Returns `{ job_id, run_id }` |
| GET | `/sites/:id/runs` | run history with progress |
| GET | `/runs/:runId` | one run incl. `progress`, `summary_json` |
| GET | `/sites/:id/issues?run_id=&severity=&type=` | paged issues |
| GET | `/sites/:id/reports` | historical report snapshots (score, counts) |
| GET | `/sites/:id/reports/:reportId` | full report JSON incl. deltas vs previous |
| GET | `/sites/:id/links` | internal-linking suggestions from the latest run |
| GET | `/sites/:id/content?url=&keyword=` | deterministic on-page content score + checklist |
| GET | `/jobs/:id` | `{ id, type, status, progress, attempts, error, result }` |

## Keywords
| Method | Path | Notes |
|---|---|---|
| POST | `/sites/:id/keywords` | `{ terms }` add + score manually |
| PATCH | `/sites/:id/keywords` | `{ term, action: ignore|restore }` |
| POST | `/sites/:id/keywords/research` **(job)** | editor; autocomplete expansion + scoring |
| GET | `/sites/:id/keywords/clusters` | deterministic clusters (token overlap) with target page |

## AI (Ollama) — all **(job)**, editor, quota `ai_ops`
| Method | Path | Body |
|---|---|---|
| POST | `/sites/:id/ai/titles` | `{ url }` title + meta description suggestions |
| POST | `/sites/:id/ai/brief` | `{ keyword, url? }` content brief |
| POST | `/sites/:id/ai/faq` | `{ url }` FAQ ideas |
| POST | `/sites/:id/ai/cluster-names` | `{}` names deterministic keyword clusters |
| POST | `/sites/:id/ai/explain` | `{ issue_type }` plain-language explanation of an audit issue |
| GET | `/sites/:id/ai/jobs` | AI job history (model, prompt version, duration) |
| GET | `/sites/:id/suggestions?status=` | suggestions list |
| POST | `/suggestions/:id/approve` / `reject` / `apply` | editor; writes audit log |

`503 { error: "ai_disabled" }` when Ollama is unreachable or `AI_ENABLED=0`.

## Search Console
Unchanged paths: `GET /google/auth-url`, `GET /google/callback`, `GET /google/status`, `DELETE /google/connection`,
`GET /google/properties`, `POST /sites/:id/gsc`, `POST /sites/:id/gsc/sync` **(job)**, `GET /sites/:id/gsc/summary`.

## Billing
| Method | Path | Notes |
|---|---|---|
| GET | `/plans` | public plan list with limits |
| GET | `/billing` | subscription + current-month usage per metric |
| POST | `/billing/change-plan` | owner; `{ plan_code }`; in test mode activates immediately and records a `payment_events` row |
| POST | `/billing/webhook/:provider` | raw body; header `x-webhook-signature` = HMAC-SHA256(secret, body); idempotent |

Plan limits (stored in `plans.limits_json`, not in code):
`{ sites, crawl_pages, ai_ops, scheduled_audits: "none|weekly|daily", gsc: bool, export: "basic|full" }`.
