# SaaS Addendum (PLATFORM_PLAN.md ke upar)

Ye document PLATFORM_PLAN.md ko multi-tenant SaaS mein badalta hai. Jahan conflict ho, yahan ka faisla final.

## 1. Stack (final, SaaS)

| Layer | Choice | Kyun |
|---|---|---|
| Frontend | Next.js + Tailwind + Recharts | Dashboard, marketing site, onboarding |
| Backend API | **Node.js (NestJS ya Express + TypeScript)** | Auth, tenancy, billing, CRUD, webhooks, approvals |
| SEO Intelligence | **Python (FastAPI internal service)** | Crawler, ML, keyword, content, quality gate |
| Workers | Python (RQ/Celery) | Heavy jobs |
| Queue | Redis | Job queue + cache + rate limit |
| DB | MySQL 8 | Tenant data |
| Scheduler | Queue scheduler (RQ-scheduler/Celery beat) | Daily/weekly jobs |
| Integration | **Git PR (default) + SEO SDK/API (optional)** | Dono supported |
| Storage | S3-compatible (MinIO local) | Crawl snapshots, reports |
| Deploy | Docker Compose -> Kubernetes baad mein | |

Do languages ka maintenance cost hai. Isliye split saaf rakho:
**Node = product (kaun, kya, kitna), Python = intelligence (SEO ka dimaag).**
Dono ke beech sirf internal REST/queue contract; shared database access sirf Node ka, Python worker results API/queue ke through likhta hai (ya alag schema).

## 2. Multi-tenancy

```
Organization (tenant)
  |- Users (roles: owner, admin, editor, viewer)
  |- Plan / subscription
  |- Sites (N)
        |- Config, connections (GSC, GA4, GitHub), data, tasks
```

- Har table mein `org_id`; har query tenant-scoped (middleware + DB-level check).
- Roles: **owner** (billing), **admin** (config, autonomy), **editor** (approve tasks), **viewer** (reports).
- Per-tenant secrets (OAuth tokens, GitHub tokens) encrypted at rest.
- Noisy-neighbour control: per-org queue limits aur crawl concurrency caps.

## 3. SaaS-specific modules (naye)

| Module | Detail |
|---|---|
| Auth | Email+password, Google login, 2FA optional, sessions/JWT |
| Org & Team | Invite, roles, audit log |
| Plans & Billing | Stripe/Razorpay; limits: sites, pages crawled, drafts/month, seats |
| Usage metering | Pages crawled, LLM tokens, API calls, GSC quota use |
| Onboarding wizard | URL -> verify -> connect -> first audit |
| White-label reports | PDF/email, client-facing (agency use) |
| Admin console | Tenant management, job monitoring, feature flags |
| Public API + webhooks | Apne tenant ke data ke liye |

## 4. Plans (draft)

| | Free | Pro | Agency |
|---|---|---|---|
| Sites | 1 | 5 | 25+ |
| Pages crawled/site | 100 | 2,000 | 10,000 |
| AI drafts/month | 5 | 60 | 300 |
| Autonomy modes | HITL only | + low-risk auto | Full config |
| Reports | Weekly | Weekly + PDF | White-label |
| Seats | 1 | 3 | 10 |

Aapke apne 6 sites pehle "internal tenant" ke roop mein chalenge (dogfooding).

## 5. Free AI ka SaaS mein matlab

Local Ollama/free tiers **ek user ke liye theek hain, SaaS ke liye nahi** (bahut users = rate limit aur server cost).

LLM router ke 3 tier:
1. **Platform default:** chhota local/open model (meta, titles, schema jaise short tasks).
2. **Bring Your Own Key:** user apni Gemini/OpenAI/Anthropic key dale, long-form drafts ke liye.
3. **Platform credits:** paid plans mein included usage, metered.

Free plan par long-form generation limited ya BYOK.

## 6. Google integration (SaaS ke liye zaroori baatein)

- Har tenant **apna Google account OAuth** se connect karega (GSC + GA4 read scopes).
- Production mein sensitive scopes ke liye **Google OAuth app verification** lagta hai (privacy policy, domain verification, demo video; kuch hafte). Development/testing mode mein sirf test users (100 tak).
- API quotas shared project ke hain: per-tenant budgeting, caching, aur priority queue chahiye.
- URL Inspection API: per property daily limit; important pages prioritized.

## 7. Integration: Git PR vs SDK

| | Git PR | SEO SDK |
|---|---|---|
| Approval | PR merge | Dashboard approve |
| Rollback | Git revert | Config toggle |
| Setup | GitHub connect | Site mein SDK install |
| Real-time | Nahi | Haan |
| Best for | Developer-owned sites | Quick edits, non-git sites |

Phase 3: Git PR (Next.js adapter) pehle. SDK (`@seo/sdk` for Next.js, Node middleware, Python package) Phase 4: signed responses se title/meta/schema/canonical inject; failure par safe fallback (site SEO data ke bina bhi chalni chahiye).

## 8. Updated module map

PLATFORM_PLAN ke 12 modules + aapke 17 modules ka mapping:

| Aapka module | Status |
|---|---|
| 01 Site Manager | Phase 1 |
| 02 Keyword Intelligence | Phase 2 |
| 03 SERP/Ranking Monitor | Phase 2-4 (GSC position pehle, compliant API optional) |
| 04 Technical SEO | Phase 1 |
| 05 Content Planner | Phase 3 |
| 06 AI Content Engine | Phase 3 (quality gate + HITL) |
| 07 On-Page Optimizer | Phase 2 |
| 08 Internal Linking | Phase 3 |
| 09 Local SEO (GBP, citations) | **Phase 5** (alag product module; tab tak product sites ke liye skip) |
| 10 Authority/Outreach | Phase 5, suggest-only |
| 11 Indexation Monitor | Phase 2 |
| 12 Analytics | Phase 1 |
| 13 Lead Tracking | Phase 4 (GA4 conversions + webhook/UTM) |
| 14 Footfall/Offline | Phase 5 (GBP calls/direction proxies, offline conversion import) |
| 15 Automated Reports | Phase 1 |
| 16 Task Scheduler | Phase 1 |
| 17 Multi-site Management | Phase 1 (tenancy se) |

Aapki 6 product sites ke liye Local/Footfall module relevant nahi; SaaS ke liye baad mein.

## 9. Updated roadmap

| Phase | Deliverable |
|---|---|
| 0 | Repo, Docker Compose (MySQL, Redis, Node API, Python service, Next.js), CI |
| 1 | Auth + org + sites, crawler/audit (Python), GSC/GA4 sync, dashboard, weekly report |
| 2 | Keyword engine, on-page recommendations, task + approval engine, indexation monitor |
| 3 | Git PR patcher, content planner + writer + gate, internal linking, sitemap/IndexNow |
| 4 | SDK, lead tracking, billing + plans + metering, rank alerts, impact measurement |
| 5 | Local SEO/GBP, authority suggestions, offline conversion, white-label reports |

Public launch se pehle: Google OAuth verification, privacy policy/ToS, data deletion flow, rate limiting, backups.

## 10. Nayi risks (SaaS)

| Risk | Mitigation |
|---|---|
| Tenant data leak | Org-scoped queries, tests, row-level checks |
| LLM cost badhna | BYOK + metering + caps |
| Google quota/verification | Early application, caching, per-tenant budgets |
| Users se spam-style misuse | Content gate, no mass-submission, ToS, abuse monitoring |
| Support aur trust | Rollback, audit log, kill switch, clear expectation ("no ranking guarantee") |
| Scope creep (17 modules) | Phase gating; ek site par proof pehle |

## 11. Sabse zaroori baat

SaaS banane se pehle **apni 6 sites par loop proof karo**: audit -> recommend -> approve -> PR -> measure. Tenancy/billing tab banao jab ye kaam karna dikha de. Isliye Phase 1 mein tenancy ka schema rakhenge (org_id), par billing baad mein.
