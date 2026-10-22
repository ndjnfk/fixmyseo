// Worker process entry: runs all BullMQ workers and registers the scheduler tick. Start with `npm run worker`.
import { config } from "./config.js";
import { log } from "./lib/logger.js";
import { closeQueues, getQueue } from "./lib/queue.js";
import { closeDb } from "./db.js";
import { migrate } from "./db/migrate.js";
import { runWorker } from "./workers/base.js";
import { crawlHandlers } from "./workers/crawl.js";
import { aiHandlers } from "./workers/ai.js";
import { gscHandlers } from "./workers/gsc.js";
import { schedulerHandlers } from "./workers/scheduler.js";
import { aiHealth } from "./ai/ollama.js";
import { closeAgents } from "./seo/crawler.js";

if (process.env.AUTO_MIGRATE !== "0") await migrate({ quiet: true });

const workers = [
  runWorker("crawl", crawlHandlers, { concurrency: config.WORKER_CONCURRENCY_CRAWL, lockDuration: 600_000 }),
  runWorker("ai", aiHandlers, { concurrency: config.WORKER_CONCURRENCY_AI, lockDuration: config.AI_TIMEOUT_MS + 60_000 }),
  runWorker("gsc", gscHandlers, { concurrency: 2 }),
  runWorker("scheduler", schedulerHandlers, { concurrency: 2 }),
];

if (config.SCHEDULER_ENABLED) {
  await getQueue("scheduler").upsertJobScheduler("tick", { every: 30 * 60 * 1000 }, { name: "tick", data: {}, opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 10 } });
}
const ai = await aiHealth(true);
log.info("worker started", { queues: ["crawl", "ai", "gsc", "scheduler"], ai: ai.ok, ai_reason: ai.reason, model: config.OLLAMA_MODEL });

async function shutdown(sig) {
  log.info("worker shutting down", { sig });
  for (const w of workers) await w.close().catch(() => {});
  await closeAgents();
  await closeQueues();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
