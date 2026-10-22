# Production runbook (single VPS, 8 GB RAM)

## Components
| Process | Start | Port | Health |
|---|---|---|---|
| MySQL 8 | systemd | 3306 | `mysqladmin ping` |
| Redis 7 (`maxmemory-policy noeviction`) | systemd | 6379 | `redis-cli ping` |
| Ollama | systemd (`ollama serve`) | 11434 | `curl :11434/api/tags` |
| API | pm2 `fixmyseo-api` | 4100 | `GET /health/ready` |
| Worker | pm2 `fixmyseo-worker` | - | pm2 logs, `jobs` table |
| Web | pm2 `fixmyseo-web` | 3100 | `GET /` |
| nginx | systemd | 443 | `deploy/nginx.conf` snippet |

## First deploy
```
git clone ... /srv/fixmyseo && cd /srv/fixmyseo
cp .env.production.example .env           # fill every value; openssl rand -hex 32 for secrets
cd api && npm ci --omit=dev && npm run migrate && cd ..
cd web && npm ci && NEXT_PUBLIC_BASE_PATH=/fixmyseo NEXT_PUBLIC_API_URL=https://host/fixmyseo/api npm run build && cd ..
ollama pull qwen2.5:1.5b                  # or qwen2.5:3b if RAM allows (~4 GB)
pm2 start deploy/ecosystem.config.cjs && pm2 save
```
Migrations run automatically when the API starts (`AUTO_MIGRATE=0` disables).

## Daily operations
* **Backups**: `deploy/backup.sh` via cron at 03:00; it also restores into a scratch DB to verify. Copy `backups/` off-site.
* **Logs**: JSON lines from pm2 (`pm2 logs fixmyseo-worker`). Grep by `"job":<id>`.
* **Queues**: stuck jobs show `status='running'` in `jobs` with an old `started_at`; BullMQ marks them stalled and retries (max 2 stalls). To cancel: `UPDATE jobs SET status='cancelled' WHERE id=?` and remove from Redis with `bullmq` CLI or restart the worker.
* **AI down**: `/health/ready` reports `ai:false`; AI endpoints return 503 and everything else works. Restart with `systemctl restart ollama`.
* **Quota reset**: usage is per calendar month (`usage_monthly.period`); nothing to do.
* **Rotate ENC_KEY**: not supported in place; users must reconnect Google afterwards.

## Scaling notes
* Crawl concurrency per worker: `WORKER_CONCURRENCY_CRAWL` (default 2) x `CRAWL_CONCURRENCY` (4 requests). Keep AI concurrency at 1 on CPU-only hosts.
* Add a second worker host by pointing it at the same MySQL + Redis; nothing else is needed.
* Redis must not evict keys (`noeviction`), otherwise BullMQ loses jobs; MySQL `jobs` keeps history either way.

## Incident checklist
1. `GET /health/ready` -> which dependency is false?
2. `pm2 status`, `pm2 logs --lines 200`.
3. Disk full? (`df -h`; backups and `ollama` models are the usual suspects.)
4. Traffic drop alerts for a site: see Automation tab -> Alerts; nothing is auto-applied, so no rollback is needed.
