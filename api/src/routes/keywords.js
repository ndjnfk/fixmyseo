// Keyword plan: list, manual add (scored), ignore/restore, research job, deterministic clusters.
import { z } from "zod";
import { db, json } from "../db.js";
import { audit } from "../lib/audit.js";
import { getConfig, latestPages, saveKeywords, scoreManualTerms, splitList } from "../lib/automation.js";
import { enqueue } from "../lib/queue.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";
import { clusterKeywords } from "../seo/keywords.js";

export async function keywordList(siteId) {
  const [rows] = await db.query(
    `SELECT k.id, k.term, k.cluster, k.cluster_id, k.intent, k.target_url, k.priority, k.status, k.demand, k.demand_src, k.difficulty, k.source,
       g.impressions, g.clicks, g.position
     FROM keywords k LEFT JOIN (
       SELECT query, SUM(impressions) impressions, SUM(clicks) clicks, ROUND(SUM(position*impressions)/GREATEST(SUM(impressions),1),1) position
       FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) GROUP BY query
     ) g ON g.query = k.term
     WHERE k.site_id=? ORDER BY k.status='ignored', k.priority DESC, k.demand DESC, k.term LIMIT 1000`, [siteId, siteId]);
  return rows;
}

export function keywordRoutes(app) {
  app.get("/sites/:id/keywords", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    res.json(await keywordList(site.id));
  }));

  app.post("/sites/:id/keywords", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { terms } = z.object({ terms: z.string().min(2).max(2000) }).parse(req.body);
    const list = [...new Set(splitList(terms.toLowerCase(), /[,\n]/))].filter((t) => t.length <= 255).slice(0, 20);
    if (!list.length) return res.status(400).json({ error: "enter at least one keyword" });
    const scored = await scoreManualTerms(site, list);
    await db.query("UPDATE keywords SET status='gap' WHERE site_id=? AND status='ignored' AND term IN (?)", [site.id, list]);
    const added = await saveKeywords(site, scored, "manual");
    await db.query("UPDATE keywords SET source='manual' WHERE site_id=? AND term IN (?)", [site.id, list]);
    await audit(req, "keywords.add", { entity: "site", entityId: site.id, meta: { terms: list } });
    res.json({ added });
  }));

  app.patch("/sites/:id/keywords", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ term: z.string().min(1).max(255), action: z.enum(["ignore", "restore", "planned", "written"]) }).parse(req.body);
    const sql = {
      ignore: "UPDATE keywords SET status='ignored' WHERE site_id=? AND term=?",
      restore: "UPDATE keywords SET status=IF(target_url IS NULL,'gap','existing') WHERE site_id=? AND term=? AND status='ignored'",
      planned: "UPDATE keywords SET status='planned' WHERE site_id=? AND term=?",
      written: "UPDATE keywords SET status='written' WHERE site_id=? AND term=?",
    }[b.action];
    await db.query(sql, [site.id, b.term]);
    res.json({ ok: true });
  }));

  app.post("/sites/:id/keywords/research", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { job, duplicate } = await enqueue({
      orgId: req.org.id, siteId: site.id, queue: "scheduler", type: "site_job", key: `keywords:${site.id}:manual`, userId: req.user.id, payload: { job: "keywords" },
    });
    if (!duplicate) await audit(req, "keywords.research", { entity: "site", entityId: site.id });
    res.status(202).json({ job_id: job.id, duplicate });
  }));

  app.get("/sites/:id/keywords/clusters", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [rows] = await db.query("SELECT id, name, ai_name, intent, target_url, size, terms_json FROM keyword_clusters WHERE site_id=? ORDER BY size DESC, id", [site.id]);
    res.json(rows.map((r) => ({ ...r, terms: json(r.terms_json) || [], terms_json: undefined })));
  }));

  // (re)build deterministic clusters from the current keyword list and persist them
  app.post("/sites/:id/keywords/cluster", auth, requireRole("editor"), wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [kws] = await db.query("SELECT term, intent, target_url, priority, demand FROM keywords WHERE site_id=? AND status<>'ignored'", [site.id]);
    if (!kws.length) return res.status(400).json({ error: "no keywords yet; run research or add keywords first" });
    const pages = await latestPages(site);
    const clusters = clusterKeywords(kws, pages);
    const cfg = getConfig(site);
    await db.query("DELETE FROM keyword_clusters WHERE site_id=?", [site.id]);
    for (const c of clusters) {
      const [r] = await db.query("INSERT INTO keyword_clusters (org_id, site_id, name, intent, target_url, size, terms_json) VALUES (?,?,?,?,?,?,?)",
        [site.org_id, site.id, c.name.slice(0, 255), c.intent, c.target_url, c.size, JSON.stringify(c.terms)]);
      await db.query("UPDATE keywords SET cluster_id=?, cluster=? WHERE site_id=? AND term IN (?)", [r.insertId, c.name.slice(0, 255), site.id, c.terms]);
    }
    await audit(req, "keywords.cluster", { entity: "site", entityId: site.id, meta: { clusters: clusters.length, language: cfg.content.language } });
    res.json({ clusters: clusters.length, items: clusters });
  }));
}
