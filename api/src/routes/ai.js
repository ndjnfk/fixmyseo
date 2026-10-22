// AI tasks (queued, metered) and the human approval workflow for suggestions.
import { z } from "zod";
import { db, json, one } from "../db.js";
import { aiHealth } from "../ai/ollama.js";
import { TASK_NAMES } from "../ai/prompts.js";
import { INPUT_SCHEMAS } from "../ai/tasks.js";
import { audit } from "../lib/audit.js";
import { enqueue, hashPayload } from "../lib/queue.js";
import { release, reserve } from "../lib/quota.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";

export function aiRoutes(app) {
  app.get("/ai/status", auth, wrap(async (_req, res) => res.json(await aiHealth())));

  app.post("/sites/:id/ai/:task", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const task = req.params.task;
    if (!TASK_NAMES.includes(task)) return res.status(404).json({ error: "unknown task", tasks: TASK_NAMES });
    const input = INPUT_SCHEMAS[task].parse(req.body || {});
    const health = await aiHealth();
    if (!health.ok) return res.status(503).json({ error: "ai_disabled", reason: health.reason });
    const q = await reserve(req.org.id, "ai_ops", 1);
    if (!q.ok) return res.status(402).json({ error: "monthly AI quota exceeded", metric: "ai_ops", limit: q.limit, used: q.used, plan: q.plan });
    const [r] = await db.query("INSERT INTO ai_jobs (org_id, site_id, task, status, input_json, created_by) VALUES (?,?,?,'queued',?,?)",
      [req.org.id, site.id, task, JSON.stringify(input), req.user.id]);
    const aiJobId = r.insertId;
    let job;
    try {
      ({ job } = await enqueue({
        orgId: req.org.id, siteId: site.id, queue: "ai", type: "task", key: `ai:${site.id}:${task}:${hashPayload(input)}:${aiJobId}`, userId: req.user.id,
        payload: { aiJobId, task, period: q.period },
      }));
    } catch (e) {
      await release(req.org.id, "ai_ops", 1, q.period);
      await db.query("UPDATE ai_jobs SET status='failed', error=? WHERE id=?", ["queue unavailable", aiJobId]);
      return res.status(503).json({ error: "queue unavailable" });
    }
    await db.query("UPDATE ai_jobs SET job_id=? WHERE id=?", [job.id, aiJobId]);
    await audit(req, "ai.task.start", { entity: "ai_job", entityId: aiJobId, meta: { task, input } });
    res.status(202).json({ job_id: job.id, ai_job_id: aiJobId, task });
  }));

  app.get("/sites/:id/ai/jobs", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [rows] = await db.query(
      "SELECT id, job_id, task, model, prompt_version, status, input_json, output_json, usage_units, prompt_tokens, output_tokens, duration_ms, error, created_at, finished_at FROM ai_jobs WHERE site_id=? ORDER BY id DESC LIMIT 50", [site.id]);
    res.json(rows.map((r) => ({ ...r, input: json(r.input_json), output: json(r.output_json), input_json: undefined, output_json: undefined })));
  }));

  app.get("/sites/:id/suggestions", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const q = z.object({ status: z.enum(["proposed", "approved", "rejected", "applied"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const [rows] = await db.query(
      `SELECT s.*, u.email reviewer FROM suggestions s LEFT JOIN users u ON u.id=s.reviewed_by WHERE s.site_id=? ${q.status ? "AND s.status=?" : ""} ORDER BY s.id DESC LIMIT ?`,
      q.status ? [site.id, q.status, q.limit] : [site.id, q.limit]);
    res.json(rows.map((r) => ({ ...r, payload: json(r.payload_json), payload_json: undefined })));
  }));

  const transition = { approve: ["proposed", "approved"], reject: ["proposed", "rejected"], apply: ["approved", "applied"], reopen: ["rejected", "proposed"] };
  for (const [action, [from, to]] of Object.entries(transition)) {
    app.post(`/suggestions/:sid/${action}`, auth, requireRole("editor"), wrap(async (req, res) => {
      const s = await one("SELECT * FROM suggestions WHERE id=? AND org_id=?", [req.params.sid, req.org.id]);
      if (!s) return res.status(404).json({ error: "not found" });
      if (s.status !== from) return res.status(409).json({ error: `cannot ${action} a ${s.status} suggestion` });
      const b = z.object({ note: z.string().max(500).optional() }).parse(req.body || {});
      await db.query("UPDATE suggestions SET status=?, reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id=?", [to, req.user.id, b.note || null, s.id]);
      await audit(req, `suggestion.${action}`, { entity: "suggestion", entityId: s.id, meta: { type: s.type, page_url: s.page_url, note: b.note } });
      res.json({ ok: true, status: to });
    }));
  }
}
