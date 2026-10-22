// Audits, runs, issues, reports, internal-link suggestions, content score, generic job status.
import { z } from "zod";
import { db, json, one } from "../db.js";
import { audit } from "../lib/audit.js";
import { startAudit } from "../lib/automation.js";
import { getJob } from "../lib/queue.js";
import { normalizeUrl } from "../lib/url.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";
import { contentScore } from "../seo/content.js";
import { ISSUE_META } from "../seo/issues.js";
import { suggestInternalLinks } from "../seo/links.js";
import { listReports } from "../seo/report.js";

const latestRun = (siteId) => one("SELECT id FROM crawl_runs WHERE site_id=? AND status='done' ORDER BY id DESC LIMIT 1", [siteId]);

export function crawlRoutes(app) {
  app.post("/sites/:id/audit", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ max_pages: z.number().int().min(1).max(5000).optional() }).parse(req.body || {});
    const r = await startAudit({ site, userId: req.user.id, maxPages: b.max_pages });
    if (r.ok) await audit(req, "audit.start", { entity: "crawl_run", entityId: r.body.run_id, meta: { max_pages: r.body.max_pages } });
    res.status(r.status).json(r.body);
  }));

  app.get("/sites/:id/runs", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [rows] = await db.query(
      `SELECT r.id, r.job_id, r.status, r.progress, r.pages_crawled, r.error, r.started_at, r.finished_at, p.score, p.issues_high, p.issues_med, p.issues_low
       FROM crawl_runs r LEFT JOIN reports p ON p.run_id=r.id AND p.kind='audit' WHERE r.site_id=? ORDER BY r.id DESC LIMIT 50`, [site.id]);
    res.json(rows);
  }));

  app.get("/runs/:runId", auth, wrap(async (req, res) => {
    const run = await one("SELECT * FROM crawl_runs WHERE id=? AND org_id=?", [req.params.runId, req.org.id]);
    if (!run) return res.status(404).json({ error: "not found" });
    const job = run.job_id ? await getJob(run.job_id, req.org.id) : null;
    res.json({ ...run, summary_json: json(run.summary_json), config_json: json(run.config_json), job: job && { status: job.status, progress: job.progress, attempts: job.attempts, error: job.error } });
  }));

  app.get("/sites/:id/issues", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const q = z.object({
      run_id: z.coerce.number().int().optional(), severity: z.enum(["high", "med", "low"]).optional(), type: z.string().max(60).optional(),
      limit: z.coerce.number().int().min(1).max(2000).default(500), offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const runId = q.run_id || (await latestRun(site.id))?.id;
    if (!runId) return res.json({ run_id: null, total: 0, items: [], meta: ISSUE_META });
    const where = ["site_id=?", "run_id=?"], vals = [site.id, runId];
    if (q.severity) { where.push("severity=?"); vals.push(q.severity); }
    if (q.type) { where.push("type=?"); vals.push(q.type); }
    const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM issues WHERE ${where.join(" AND ")}`, vals);
    const [items] = await db.query(
      `SELECT id, type, severity, url, detail FROM issues WHERE ${where.join(" AND ")} ORDER BY FIELD(severity,'high','med','low'), type, id LIMIT ? OFFSET ?`,
      [...vals, q.limit, q.offset]);
    res.json({ run_id: runId, total: n, items, meta: ISSUE_META });
  }));

  app.get("/sites/:id/reports", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    res.json(await listReports(site.id));
  }));

  app.get("/sites/:id/reports/:reportId", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const r = await one("SELECT * FROM reports WHERE id=? AND site_id=?", [req.params.reportId, site.id]);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json({ ...r, report: json(r.report_json), report_json: undefined });
  }));

  app.get("/sites/:id/links", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const run = await latestRun(site.id);
    if (!run) return res.json({ run_id: null, items: [] });
    const [pages] = await db.query(
      "SELECT url, status, title, h1, h2s_json, text_excerpt, inlinks FROM pages WHERE run_id=? LIMIT 3000", [run.id]);
    const [links] = await db.query("SELECT from_url, to_url FROM page_links WHERE run_id=? LIMIT 100000", [run.id]);
    const rows = pages.map((p) => ({ ...p, status: Number(p.status) || p.status, text: p.text_excerpt, h2s: json(p.h2s_json) || [] }));
    res.json({ run_id: run.id, items: suggestInternalLinks(rows, links, { max: 150 }) });
  }));

  app.get("/sites/:id/content", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const q = z.object({ url: z.string().url().max(1000), keyword: z.string().trim().min(2).max(120) }).parse(req.query);
    const run = await latestRun(site.id);
    if (!run) return res.status(400).json({ error: "run an audit first" });
    const n = normalizeUrl(q.url) || q.url;
    const p = await one("SELECT * FROM pages WHERE run_id=? AND url IN (?, ?) LIMIT 1", [run.id, n, q.url]);
    if (!p) return res.status(404).json({ error: "page not found in the latest audit" });
    const page = { ...p, text: p.text_excerpt || "", h2s: json(p.h2s_json) || [], meta_desc: p.meta_description };
    res.json({ run_id: run.id, ...contentScore(page, q.keyword), page: { title: p.title, h1: p.h1, meta_description: p.meta_description, word_count: p.word_count, inlinks: p.inlinks } });
  }));

  app.get("/jobs/:jobId", auth, wrap(async (req, res) => {
    const job = await getJob(req.params.jobId, req.org.id);
    if (!job) return res.status(404).json({ error: "not found" });
    res.json({ id: job.id, site_id: job.site_id, queue: job.queue, type: job.type, status: job.status, progress: job.progress, attempts: job.attempts, error: job.error, result: job.result_json, created_at: job.created_at, started_at: job.started_at, finished_at: job.finished_at });
  }));

  app.get("/sites/:id/jobs", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [rows] = await db.query("SELECT id, queue, type, status, progress, attempts, error, created_at, finished_at FROM jobs WHERE site_id=? ORDER BY id DESC LIMIT 50", [site.id]);
    res.json(rows);
  }));
}
