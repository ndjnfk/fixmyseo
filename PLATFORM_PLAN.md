# Auto-SEO Platform: Poora Plan

Version 1 | Owner: apni 6 product sites ke liye, baad mein scalable

---

## 1. Goal

URL daalo -> platform us site ka SEO khud shuru kare aur chalata rahe:

- audit, keyword plan, on-page fixes, daily content/blog drafts, Google ko sitemap/URL submit
- jahan risk hai wahan **HITL (human approval)**, jahan risk nahi wahan auto
- weekly report dashboard mein
- 6 sites (React/Next.js, Node.js, Python), sab free tools se

**Guarantee nahi:** ranking Google decide karta hai. Platform measurable signals improve karta hai (technical health, relevance, content, internal links, CTR) aur result track karta hai. Pehla asar aam taur par 2-6 mahine mein dikhta hai.

## 2. Design principles

1. **Recommend -> Approve -> Apply -> Monitor.** Har change ek task hai jiska status hota hai.
2. **Risk ke hisaab se autonomy.** Har site/har task type ka mode configurable: `auto`, `hitl`, `off`.
3. **Sab kuch Git PR se.** Platform site ka code seedha live nahi badalta; PR banata hai. Merge = approval, revert = rollback.
4. **Quality gate pehle, publish baad mein.** Daily content bhi gate pass kare tabhi queue mein jaye.
5. **Spam nahi.** Mass directory/backlink submission, fake reviews, doorway pages, scaled low-value AI content: sab out of scope.
6. **Free-first.** Local models + free APIs. Paid cheez sirf optional plug-in.
7. **Data-driven.** Search Console / GA4 ka data decision ka basis; andaaza nahi.

## 3. Architecture

```
                        DASHBOARD (Next.js)
                              |
                         API (FastAPI)
                              |
   +--------------+-----------+------------+----------------+
   |              |           |            |                |
 Site Manager  Task/Approval  Config      Reports        Auth
   |           Engine          Engine
   |              |
   |        Redis queue (RQ/Celery) <-- Scheduler (APScheduler)
   |              |
   |   +----------+-----------+-----------+-----------+
   |   |          |           |           |           |
 Crawler   Keyword/ML   Content     Git Patcher   Google
 + Audit   Engine       Engine      (PR bot)      Connectors
   |          |           |           |           (GSC, GA4,
   |          |           |           |            Indexing)
   +----------+-----------+-----------+-----------+
                              |
                           MySQL 8
```

**Ek hi language: Python** (API, workers, ML, crawler). Frontend sirf dashboard ke liye Next.js. Node ki zarurat nahi.

Platform ko domain nahi chahiye. Wo local ya kisi chhote server par chal sakta hai. Domain sirf aapki product sites ke liye chahiye (Search Console verification ke liye).

## 4. Modules

| # | Module | Kaam | Phase |
|---|---|---|---|
| 1 | Site Manager | URL add, per-site config, GitHub repo link, GSC/GA4 link | 1 |
| 2 | Crawler + Audit | Pages, meta, headings, canonical, schema, links, speed, rendered (Playwright) | 1 |
| 3 | GSC/GA4 Sync | Daily queries, clicks, impressions, position, sessions, conversions | 1 |
| 4 | Dashboard + Weekly Report | Funnel, trends, tasks, approvals | 1 |
| 5 | Keyword Engine | Discovery, clustering, intent, keyword -> URL mapping, gaps | 2 |
| 6 | On-Page Optimizer | Title/meta/H1/alt/schema/internal-link recommendations | 2 |
| 7 | Task + Approval Engine | Queue, diff preview, approve/reject, audit log | 2 |
| 8 | Git Patcher | Framework-wise patch -> branch -> PR | 3 |
| 9 | Content Planner + Writer | Calendar, briefs, drafts, quality gate | 3 |
| 10 | Indexing / Submission | Sitemap submit, indexing status, URL inspection | 3 |
| 11 | Authority Suggestions | Relevant citation/outreach opportunities (suggest only) | 4 |
| 12 | Rank + Alerts | GSC position trend, drop alerts | 4 |

## 5. Onboarding flow (jab URL daalte ho)

1. URL + business details (type, audience, language, country, services, competitors optional).
2. Platform crawl karta hai (raw + rendered), baseline audit banata hai.
3. Site ownership: GSC mein verify hona zaroori (DNS/meta tag). Platform wizard dikhata hai.
4. GitHub repo connect (App/token); framework detect (Next.js / Node / Python).
5. GSC + GA4 connect; 16 mahine tak ka historical data pull.
6. Keyword engine seed keywords + GSC queries se universe banata hai.
7. Pehla **SEO roadmap** + task list bana. Low-risk tasks auto, baaki approval queue mein.
8. Daily/weekly jobs schedule ho jaate hain.

## 6. Autonomy / HITL policy

Har site ke config mein per-task mode. Defaults:

| Task | Risk | Default |
|---|---|---|
| Image alt text, html lang | Low | auto |
| Sitemap.xml, robots.txt `Sitemap:` line | Low | auto |
| Missing meta description / title | Low-Med | auto (PR) |
| Title/meta rewrite of **ranking** pages | Med | hitl |
| JSON-LD schema | Med | hitl |
| Canonical / noindex / redirects | **High** | hitl (hamesha) |
| Internal link insertion | Med | hitl |
| Existing page content rewrite | High | hitl |
| New blog / page publish | High | hitl (draft daily, publish approve) |
| Backlink/citation outreach | High | suggest only |
| Delete/merge pages | High | hitl (hamesha) |

Rules:
- High-risk tasks ko `auto` par set karna config mein allowed nahi.
- Jis page par traffic hai, uska koi bhi change hamesha hitl.
- Har auto change ka PR banta hai; "auto-merge" optional aur sirf low-risk par.
- **Kill switch:** site-level pause, aur traffic drop par auto-pause (neeche section 12).

## 7. Config (har site ka)

```yaml
site:
  domain: example.com
  repo: github.com/me/example
  framework: nextjs            # nextjs | node | python
  language: [en, hi]
  country: IN
  business: {type: product, services: [...], audience: "..."}
  brand_voice: "simple, helpful, no hype"
  conversions: [signup, purchase, whatsapp_click]

content:
  frequency: daily             # daily | 3_per_week | weekly | off
  drafts_per_day: 1
  publish_mode: hitl           # hitl | auto_if_gate_passes
  min_words: 900
  require_human_input: true    # author notes / examples mandatory
  languages: [en]

autonomy:
  alt_text: auto
  meta_missing: auto
  meta_rewrite: hitl
  schema: hitl
  canonical: hitl
  internal_links: hitl

safety:
  pause_on_traffic_drop_pct: 25
  max_changes_per_day: 10
  protected_urls: ["/", "/pricing"]

reports:
  weekly_day: monday
  email: me@example.com
```

Dashboard mein ye form ki tarah editable hai; config versioned rahega.

## 8. AI/ML (sab free)

### LLM strategy (router)
```
Task -> LLM Router
         1. Ollama (local)  [default, no limit]
         2. Gemini free / Groq free  [fallback or heavy tasks]
         3. (optional) paid API plug-in
```
- Local: 7-8B model (Llama 3.1 8B / Qwen2.5 7B) ke liye 16GB RAM kaafi hai; GPU ho to tez.
- Short structured tasks (meta, titles, schema) local par; long-form draft ke liye jo model best ho wo.
- Free-tier rate limits ke liye retry + backoff + daily budget counter.
- Sab prompts versioned aur repo mein; output hamesha JSON schema se validate.

### ML (non-LLM)
| Kaam | Tool |
|---|---|
| Keyword embeddings, clustering | sentence-transformers (multilingual MiniLM) + HDBSCAN/KMeans |
| Intent classification | Rules + zero-shot / small classifier |
| Keyword -> URL mapping | Embedding cosine similarity + GSC query data |
| Content gap | Competitor page topics vs apne pages |
| Duplicate / cannibalization detect | Embeddings + GSC (ek query, multiple URLs) |
| Quality scoring | Readability, length, originality (similarity vs web/own pages), heading structure |
| Change impact | Pre/post GSC comparison (simple diff-in-diff) |

### Keyword data (free)
Search Console queries (sabse reliable), Google Autocomplete/People Also Ask (compliant, rate-limited), competitor page analysis, LLM-assisted expansion. Volume ke liye free sources limited hain; GSC impressions ko proxy maanenge.

## 9. Content engine

```
Cluster -> Calendar -> Brief -> Draft -> Quality gate -> Review queue -> PR -> Publish -> Monitor -> Refresh
```

**Brief:** search intent, target keyword, outline, FAQs, internal links, sources, aur **"human input needed"** (aapka experience/example/data).

**Quality gate (pass hona zaroori):**
- Length >= configured minimum
- Duplicate check vs apne pages (cosine < threshold) aur web snippet check
- Factual claims par sources/flags
- H1/H2 structure, readability
- Brand voice check
- "Generic AI" red flags (filler, repeated phrases)
- Topic site ke niche mein relevant

**Daily output:** daily draft ban sakte hain, par default publish approval ke baad. `auto_if_gate_passes` sirf us site par jahan aap jaanbujhkar on karo, aur tab bhi `max_publish_per_week` limit ke saath.

**Refresh loop:** jo post ka CTR/position gir raha ho uska update task banta hai.

## 10. Git Patcher (PR bot)

- GitHub App/token se repo clone -> branch `seo/<task-id>` -> patch -> PR with diff, reason, expected impact, rollback note.
- Framework adapters:
  - **Next.js:** `metadata`/`generateMetadata`, `app/sitemap.ts`, `app/robots.ts`, JSON-LD component, MDX blog files
  - **Node (Express etc.):** template/head partials, sitemap route
  - **Python (Django/Flask/FastAPI):** template head blocks, sitemap view
- Patch ke baad CI/lint/build chalne do; fail ho to PR draft rahe.
- Naya adapter = ek plug-in file; 6 sites ke baad aur sites aasani se judengi.

## 11. Google connectors & submission

| Cheez | Kaise |
|---|---|
| Search data | Search Console API (free) |
| Analytics | GA4 Data API (free) |
| Sitemap submit | Search Console API `sitemaps.submit` |
| Indexing status | URL Inspection API (daily quota limited, prioritized) |
| Indexing API | Sirf JobPosting/BroadcastEvent ke liye officially; normal pages ke liye use nahi karenge |
| Bing | IndexNow + Bing Webmaster (free) |

"Submission" = sitemap + IndexNow + URL inspection monitoring. Directory/backlink mass submission **nahi**.

## 12. Safety & monitoring

- **Traffic drop guard:** page/site clicks `x%` gire (config) -> auto-pause aur alert + last change ka rollback suggestion.
- **Per-change tracking:** har change ke 14/28 din baad impact measure.
- **Daily crawl diff:** accidentally noindex, canonical error, 404 spike, sitemap break alert.
- **Rate limits:** crawler polite (robots.txt respect, delay), API quotas ka budget.
- **Audit log:** kisne/kisne kya approve kiya.
- Secrets `.env`/vault mein; GitHub token least-privilege.

## 13. Authority / backlinks (suggest only)

- Relevant citations/directories ki list quality-score ke saath (relevance, spam signals).
- Outreach ideas: guest post, resource pages, digital PR; personalized pitch **draft** (aap bhejte ho).
- Bhejna/submit karna manual ya approval ke baad; mass automation nahi.
- Link velocity aur anchor diversity ka monitoring.

## 14. Dashboard

1. **Portfolio:** 6 sites ki cards: clicks, impressions, indexed pages, health score, pending approvals.
2. **Site detail:** funnel (impressions -> clicks -> sessions -> conversions), top queries/pages, ranking movers.
3. **Approvals:** diff view, approve/reject/edit, bulk actions.
4. **Content:** calendar, drafts, gate scores, publish state.
5. **Audit:** issues by severity, trend.
6. **Config:** per-site editable settings.
7. **Weekly report:** auto-generated (summary, wins, drops, tasks done, next week plan), PDF/email optional.

## 15. Data model (MySQL, core tables)

```
sites(id, domain, repo, framework, status, config_json, created_at)
pages(id, site_id, url, status, title, meta, h1, canonical, word_count, last_crawled)
crawl_runs(id, site_id, started_at, summary_json)
issues(id, site_id, page_id, type, severity, status, first_seen, resolved_at)
keywords(id, site_id, term, cluster_id, intent, language, source)
clusters(id, site_id, name, target_page_id)
gsc_daily(site_id, date, page, query, clicks, impressions, ctr, position)
ga4_daily(site_id, date, page, sessions, engaged, conversions)
tasks(id, site_id, type, risk, mode, status, payload_json, diff, pr_url, created_at, approved_by)
task_results(task_id, metric, before, after, window_days)
content_items(id, site_id, cluster_id, title, brief_json, draft, gate_json, status, publish_at)
reports(id, site_id, week_start, body, created_at)
audit_log(id, actor, action, entity, ts)
```

## 16. Scheduler (jobs)

| Frequency | Job |
|---|---|
| Daily | GSC + GA4 sync, crawl diff, content draft generation, indexing check, pause-guard check |
| Daily | New tasks generate (recommendations) |
| Weekly | Full crawl + audit, keyword refresh/clustering, impact measurement, **weekly report** |
| Monthly | Content refresh candidates, competitor gap refresh, authority suggestions |

## 17. Tech stack (final)

| Layer | Choice |
|---|---|
| API / workers | Python 3.12, FastAPI |
| Queue | Redis + RQ (simple) |
| Scheduler | APScheduler |
| DB | MySQL 8 (SQLAlchemy + Alembic) |
| Crawl | requests/BeautifulSoup + Playwright (rendered) |
| ML | sentence-transformers, scikit-learn, hdbscan |
| LLM | Ollama (local) + Gemini/Groq free fallback |
| Git | PyGithub / GitHub App |
| Frontend | Next.js + Tailwind + Recharts |
| Deploy | Docker Compose (local ya VPS) |

## 18. Repo layout

```
D:\SEO
  api/            FastAPI app, routes
  core/           config, db, models, llm router
  crawler/        audit.py (existing prototype), rendered crawl
  seo/            keyword, onpage, content, quality gate
  connectors/     gsc, ga4, github, indexnow
  patchers/       nextjs, node, python adapters
  workers/        jobs, scheduler
  web/            dashboard (Next.js)
  prompts/        versioned prompts
  docs/           this plan
```

## 19. Roadmap

| Phase | Deliverable | Rough scope |
|---|---|---|
| 1 | Site manager, crawler+rendered audit, GSC/GA4 sync, dashboard (portfolio + funnel), weekly report | Foundation |
| 2 | Keyword engine, on-page recommendations, task + approval engine | Intelligence |
| 3 | Git PR patcher (Next.js pehle), content planner/writer + gate, sitemap/indexing | Action |
| 4 | Rank/alerts, authority suggestions, impact measurement, more adapters | Optimization |

Pehle **ek site** par pura loop validate karo, phir baki 5 jodo.

## 20. Risks aur mitigations

| Risk | Mitigation |
|---|---|
| Wrong canonical/noindex se traffic girna | Hamesha HITL + traffic guard |
| AI content se spam penalty | Quality gate, human input, publish limit, default HITL |
| Free LLM ki quality/limits | Router + fallback + structured prompts + human review |
| GSC quota/data delay | Caching, prioritization, 2-3 din ka lag manna |
| 6 sites ek jaisa content (cannibalization/duplicate) | Per-site embeddings, cross-site duplicate check |
| Site ka framework alag | Adapter pattern; Phase 3 mein Next.js se shuru |
| Unrealistic expectations | Dashboard mein leading indicators (indexing, impressions) pehle dikhana |

## 21. Out of scope (jaanbujhkar)

- Mass backlink/directory submission, link networks, PBNs
- Fake reviews, fake businesses/locations
- Unreviewed mass AI page generation
- Google SERP scraping (ToS); GSC data ya compliant APIs

## 22. Open items

1. Sites ke repos GitHub par hain? (PR flow ke liye zaroori)
2. Har site ka niche/audience/language (config ke liye)
3. PC specs (RAM/GPU) -> local LLM model decide hoga
4. GSC/GA4 par aapka owner access (domains kharidne ke baad)
5. Dashboard ka login: sirf aap ya team bhi?
