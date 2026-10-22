# FixMySEO v2

Self-hosted, multi-tenant AI SEO SaaS: technical audits, keyword research + clustering, content optimisation,
internal-link suggestions, Search Console reports, local-LLM suggestions with human approval, historical reports.
No paid APIs, no paid LLM, no paid SaaS dependencies.

* Stack: Node.js 22 (Express + BullMQ workers), MySQL 8, Redis 7, Ollama (`qwen2.5:1.5b`), Next.js 15.
* Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SCHEMA.md](docs/SCHEMA.md), [docs/API.md](docs/API.md),
  [docs/SECURITY.md](docs/SECURITY.md), [docs/PLAN.md](docs/PLAN.md), [docs/OSS_EVALUATION.md](docs/OSS_EVALUATION.md),
  [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Run locally
```
cp .env.example .env                                   # edit secrets
docker compose up -d mysql redis                       # (ollama too, unless installed natively)
ollama pull qwen2.5:1.5b
cd api && npm install && npm run migrate
npm run dev            # API  http://localhost:4000   (terminal 1)
npm run worker         # BullMQ workers               (terminal 2)
cd ../web && npm install && npm run dev                # http://localhost:3000 (terminal 3)
```
Everything in Docker: `docker compose up --build` then `docker compose exec ollama ollama pull qwen2.5:1.5b`.

## Tests
```
cd api && npm test            # 39 tests: unit (SSRF, URLs, crawler on a fixture site, prompts, clustering)
                              # + integration (auth, tenancy, quotas, billing webhooks, full audit->AI->approval pipeline)
```
Integration tests need MySQL + Redis (they use the `seo_test` database and a mock Ollama).

## Layout
`api/` API + workers, `web/` dashboard, `db/migrations/` schema, `deploy/` PM2/nginx/backup, `legacy/` retired Python service.
