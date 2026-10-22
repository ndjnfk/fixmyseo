// BullMQ worker wrapper that mirrors job state into MySQL `jobs` and gives handlers a progress() helper.
import { Worker } from "bullmq";
import { log } from "../lib/logger.js";
import { PREFIX, redis, setJob } from "../lib/queue.js";

export function runWorker(queueName, handlers, { concurrency = 1, lockDuration = 180_000 } = {}) {
  const w = new Worker(queueName, async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`no handler for ${queueName}/${job.name}`);
    const id = job.data.jobId || null;
    const jl = log.child({ queue: queueName, type: job.name, job: id, bull: job.id, attempt: job.attemptsMade + 1 });
    if (id) await setJob(id, { status: "running", started_at: new Date(), attempts: job.attemptsMade + 1, error: null });
    let lastPct = -1, lastAt = 0;
    const ctx = {
      log: jl,
      progress: async (pct) => {
        pct = Math.max(0, Math.min(99, Math.round(pct)));
        if (pct === lastPct || Date.now() - lastAt < 1500) return;
        lastPct = pct; lastAt = Date.now();
        await job.updateProgress(pct).catch(() => {});
        if (id) await setJob(id, { progress: pct }).catch(() => {});
      },
    };
    jl.info("job start");
    const result = await handler(job.data, ctx, job);
    if (id) await setJob(id, { status: "done", progress: 100, result_json: result ?? null, finished_at: new Date() });
    jl.info("job done");
    return result;
  }, { connection: redis(), prefix: PREFIX, concurrency, lockDuration, stalledInterval: 60_000, maxStalledCount: 2 });

  w.on("failed", async (job, err) => {
    if (!job) return;
    const id = job.data.jobId || null;
    const final = job.attemptsMade >= (job.opts.attempts || 1);
    log.warn("job failed", { queue: queueName, type: job.name, job: id, attempt: job.attemptsMade, final, err: err.message });
    if (id) await setJob(id, { status: final ? "failed" : "queued", error: String(err.message).slice(0, 1000), attempts: job.attemptsMade, ...(final ? { finished_at: new Date() } : {}) }).catch(() => {});
    if (final) await handlers[`${job.name}:failed`]?.(job.data, err).catch((e) => log.error("failure hook error", { err: e }));
  });
  w.on("error", (e) => log.error("worker error", { queue: queueName, err: e }));
  return w;
}
