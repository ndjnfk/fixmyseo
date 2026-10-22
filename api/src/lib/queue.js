// BullMQ queues + the MySQL `jobs` mirror. API code calls enqueue(); workers use runWorker() (workers/base.js).
import crypto from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { db, json, one } from "../db.js";
import { log } from "./logger.js";

export const QUEUES = ["crawl", "ai", "gsc", "scheduler"];
// one Redis can serve several databases (dev, test): namespace every queue key by DB name
export const PREFIX = `fms:${config.DB_NAME}`;

let _conn = null;
export function redis() {
  if (!_conn) {
    _conn = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });
    _conn.on("error", (e) => log.warn("redis error", { err: e.message }));
  }
  return _conn;
}

const queues = new Map();
export function getQueue(name) {
  if (!QUEUES.includes(name)) throw new Error(`unknown queue ${name}`);
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, {
      connection: redis(), prefix: PREFIX,
      defaultJobOptions: {
        attempts: 3, backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 },
      },
    }));
  }
  return queues.get(name);
}

export const hashPayload = (o) => crypto.createHash("sha1").update(JSON.stringify(o ?? {})).digest("hex").slice(0, 16);

/**
 * Insert a `jobs` row and add it to BullMQ. Idempotent while a job with the same key is queued/running:
 * the existing job is returned with duplicate=true. Finished jobs with the same key are retired (key suffixed)
 * so history is kept and a fresh run is allowed.
 */
export async function enqueue({ orgId, siteId = null, queue, type, key, payload = {}, userId = null, attempts, delay }) {
  const idem = key || `${type}:${siteId ?? "org"}:${hashPayload(payload)}`;
  let id;
  for (let i = 0; i < 3; i++) {
    try {
      const [r] = await db.query(
        `INSERT INTO jobs (org_id, site_id, queue, type, idempotency_key, payload_json, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [orgId, siteId, queue, type, idem, JSON.stringify(payload), userId]);
      id = r.insertId;
      break;
    } catch (e) {
      if (e.code !== "ER_DUP_ENTRY") throw e;
      const existing = await one("SELECT * FROM jobs WHERE idempotency_key=?", [idem]);
      if (existing && ["queued", "running"].includes(existing.status)) return { job: existing, duplicate: true };
      if (existing) await db.query("UPDATE jobs SET idempotency_key=? WHERE id=?", [`${idem}#${existing.id}`, existing.id]);
    }
  }
  if (!id) throw new Error("could not create job");
  // BullMQ dedupes on jobId, so it must be unique even if the MySQL id is reused after a reset/restore
  const bullId = `j${id}-${crypto.randomBytes(3).toString("hex")}`;
  const bull = await getQueue(queue).add(type, { jobId: id, orgId, siteId, ...payload },
    { jobId: bullId, ...(attempts ? { attempts } : {}), ...(delay ? { delay } : {}) });
  await db.query("UPDATE jobs SET bull_id=? WHERE id=?", [bull.id, id]);
  return { job: await getJob(id), duplicate: false };
}

export async function getJob(id, orgId) {
  const row = await one(orgId ? "SELECT * FROM jobs WHERE id=? AND org_id=?" : "SELECT * FROM jobs WHERE id=?",
    orgId ? [id, orgId] : [id]);
  if (!row) return null;
  return { ...row, payload_json: json(row.payload_json), result_json: json(row.result_json) };
}

export async function setJob(id, fields) {
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k}=?`);
    vals.push(k.endsWith("_json") && v != null && typeof v !== "string" ? JSON.stringify(v) : v);
  }
  if (!cols.length) return;
  await db.query(`UPDATE jobs SET ${cols.join(", ")} WHERE id=?`, [...vals, id]);
}

/** Remove every queue key of this namespace (tests / local reset only). */
export async function flushQueues() {
  const r = redis();
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `${PREFIX}:*`, "COUNT", 1000);
    cursor = next;
    if (keys.length) await r.del(...keys);
  } while (cursor !== "0");
}

export async function closeQueues() {
  for (const q of queues.values()) await q.close().catch(() => {});
  queues.clear();
  if (_conn) { await _conn.quit().catch(() => {}); _conn = null; }
}
