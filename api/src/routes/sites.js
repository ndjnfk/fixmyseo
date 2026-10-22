// Sites (= projects). Every query is org-scoped through ownSite / req.org.id.
import { z } from "zod";
import { db, json } from "../db.js";
import { audit } from "../lib/audit.js";
import { canAddSite } from "../lib/quota.js";
import { normalizeUrl } from "../lib/url.js";
import { assertUrlShape, resolvePublic } from "../lib/ssrf.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";

export function parseSiteUrl(input) {
  const raw = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const norm = normalizeUrl(raw);
  if (!norm) throw new Error("invalid url");
  const u = assertUrlShape(norm);
  return { url: `${u.protocol}//${u.host}`, domain: u.hostname.replace(/^www\./, "") };
}

export function siteRoutes(app) {
  app.get("/sites", auth, wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT s.id, s.domain, s.url, s.framework, s.status, s.gsc_property, s.gsc_last_sync, s.created_at,
         (SELECT COUNT(*) FROM issues i WHERE i.site_id=s.id AND i.run_id=
           (SELECT MAX(id) FROM crawl_runs r WHERE r.site_id=s.id AND r.status='done')) AS open_issues,
         (SELECT status FROM crawl_runs r WHERE r.site_id=s.id ORDER BY id DESC LIMIT 1) AS last_run_status,
         (SELECT score FROM reports p WHERE p.site_id=s.id AND p.kind='audit' ORDER BY id DESC LIMIT 1) AS score
       FROM sites s WHERE s.org_id=? ORDER BY s.id DESC`, [req.org.id]);
    res.json(rows);
  }));

  app.post("/sites", auth, requireRole("admin"), wrap(async (req, res) => {
    const b = z.object({ url: z.string().trim().min(3).max(500), framework: z.string().max(30).optional() }).parse(req.body);
    let n;
    try { n = parseSiteUrl(b.url); } catch (e) { return res.status(400).json({ error: e.message || "invalid url" }); }
    try { await resolvePublic(new URL(n.url).hostname); } catch (e) { return res.status(400).json({ error: e.message }); }
    const q = await canAddSite(req.org.id);
    if (!q.ok) return res.status(402).json({ error: "plan limit reached", limit: q.limit, plan: q.plan, metric: "sites" });
    try {
      const [r] = await db.query("INSERT INTO sites (org_id, domain, url, framework) VALUES (?,?,?,?)",
        [req.org.id, n.domain, n.url, b.framework || null]);
      await audit(req, "site.create", { entity: "site", entityId: r.insertId, meta: { domain: n.domain } });
      res.status(201).json({ id: r.insertId, ...n });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "site already added" });
      throw e;
    }
  }));

  app.get("/sites/:id", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [runs] = await db.query(
      "SELECT id, job_id, status, progress, pages_crawled, error, started_at, finished_at FROM crawl_runs WHERE site_id=? ORDER BY id DESC LIMIT 10", [site.id]);
    const lastDone = runs.find((r) => r.status === "done");
    let issues = [], summary = [], report = null;
    if (lastDone) {
      [issues] = await db.query(
        "SELECT type, severity, url, detail FROM issues WHERE run_id=? ORDER BY FIELD(severity,'high','med','low'), type LIMIT 2000", [lastDone.id]);
      [summary] = await db.query(
        "SELECT type, severity, COUNT(*) AS count FROM issues WHERE run_id=? GROUP BY type, severity ORDER BY FIELD(severity,'high','med','low'), count DESC", [lastDone.id]);
      const [[rep]] = await db.query("SELECT id, score, pages, issues_high, issues_med, issues_low, created_at FROM reports WHERE run_id=? AND kind='audit' LIMIT 1", [lastDone.id]);
      report = rep || null;
    }
    res.json({ site: { ...site, config_json: json(site.config_json) }, runs, summary, issues, report, role: req.org.role });
  }));

  app.patch("/sites/:id", auth, requireRole("admin"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ status: z.enum(["active", "paused"]).optional(), framework: z.string().max(30).nullable().optional() }).parse(req.body);
    const sets = [], vals = [];
    if (b.status) { sets.push("status=?"); vals.push(b.status); }
    if ("framework" in b) { sets.push("framework=?"); vals.push(b.framework); }
    if (sets.length) await db.query(`UPDATE sites SET ${sets.join(",")} WHERE id=?`, [...vals, site.id]);
    await audit(req, "site.update", { entity: "site", entityId: site.id, meta: b });
    res.json({ ok: true });
  }));

  app.delete("/sites/:id", auth, requireRole("admin"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    await db.query("DELETE FROM sites WHERE id=? AND org_id=?", [site.id, req.org.id]);
    await audit(req, "site.delete", { entity: "site", entityId: site.id, meta: { domain: site.domain } });
    res.json({ ok: true });
  }));

  app.get("/sites/:id/pages", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const runId = req.query.run_id ? Number(req.query.run_id) : null;
    const [rows] = await db.query(
      `SELECT id, url, status, title, meta_description, h1, h1_count, canonical, robots_meta, lang, schema_types, word_count,
              response_time_s, inlinks, imgs_no_alt
       FROM pages WHERE site_id=? AND run_id=${runId ? "?" : "(SELECT MAX(id) FROM crawl_runs WHERE site_id=? AND status='done')"}
       ORDER BY inlinks DESC, url LIMIT 5000`, [site.id, runId || site.id]);
    res.json(rows);
  }));
}
