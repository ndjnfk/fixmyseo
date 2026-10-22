// Automation config + manual job runs (everything is enqueued; nothing runs in the request).
import { z } from "zod";
import { db } from "../db.js";
import { audit } from "../lib/audit.js";
import { JOBS, configSchema, getConfig, saveConfig, startAudit } from "../lib/automation.js";
import { enqueue } from "../lib/queue.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";
import { keywordList } from "./keywords.js";

export function automationRoutes(app) {
  app.get("/sites/:id/automation", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const q = (sql, params = [site.id]) => db.query(sql, params).then(([r]) => r);
    const active = await q("SELECT id, type, status, progress FROM jobs WHERE site_id=? AND status IN ('queued','running') ORDER BY id DESC");
    res.json({
      config: getConfig(site), running: active.length > 0, active, jobs: JOBS,
      log: await q("SELECT job, status, message, created_at FROM job_log WHERE site_id=? ORDER BY id DESC LIMIT 40"),
      alerts: await q("SELECT type, severity, subject, detail, created_at FROM alerts WHERE site_id=? ORDER BY id DESC LIMIT 30"),
      index: await q("SELECT url, verdict, coverage, last_crawl, checked_at FROM index_status WHERE site_id=? ORDER BY checked_at DESC LIMIT 100"),
      keywords: await keywordList(site.id),
    });
  }));

  app.put("/sites/:id/automation", auth, requireRole("admin"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ config: configSchema }).parse(req.body);
    await saveConfig(site, { ...getConfig(site), ...b.config });
    await audit(req, "site.settings", { entity: "site", entityId: site.id });
    res.json({ ok: true });
  }));

  app.post("/sites/:id/automation/run", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { job } = z.object({ job: z.enum(["all", ...JOBS]) }).parse(req.body);
    const list = job === "all" ? JOBS : [job];
    const started = [];
    for (const j of list) {
      if (j === "audit") {
        const r = await startAudit({ site, userId: req.user.id });
        started.push({ job: j, ...(r.ok ? { job_id: r.body.job_id } : { skipped: r.body.error }) });
        continue;
      }
      const queue = j === "gsc" || j === "indexing" ? "gsc" : "scheduler";
      const type = j === "gsc" ? "sync" : j === "indexing" ? "indexing" : "site_job";
      const { job: jb, duplicate } = await enqueue({ orgId: req.org.id, siteId: site.id, queue, type, key: `${j}:${site.id}:manual`, userId: req.user.id, payload: { job: j } });
      started.push({ job: j, job_id: jb.id, duplicate });
    }
    await audit(req, "automation.run", { entity: "site", entityId: site.id, meta: { jobs: list } });
    res.status(202).json({ started });
  }));
}
