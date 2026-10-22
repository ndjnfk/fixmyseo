// Per-site automation: config defaults, audit start (quota + queue), and the scheduled jobs (gsc, alerts, indexing, keywords).
// Jobs here run inside workers; routes only enqueue.
import { z } from "zod";
import { config } from "../config.js";
import { db, json, one } from "../db.js";
import { enqueue } from "./queue.js";
import { planFor, reserve } from "./quota.js";
import { isPrivatePath } from "./url.js";
import * as google from "./google.js";
import { Ctx, basicResearch, scoreTerms } from "../seo/keywords.js";
import { auditSystem } from "./audit.js";

export const DEFAULTS = {
  autonomy: { keywords: "auto", indexing: "auto" }, // auto | off
  content: { language: "en", country: "IN", notes: "" },
  keywords: { seeds: "", exclude: "" },
  alerts: { webhook: "", pause_on_drop_pct: 25 },
  crawl: { max_pages: 0 }, // 0 = plan default
};

export const DAILY = ["gsc", "alerts", "indexing"];
export const WEEKLY = ["audit", "keywords"];
export const JOBS = [...WEEKLY, ...DAILY];

const onOff = z.enum(["auto", "off"]);
export const configSchema = z.object({
  autonomy: z.object({ keywords: onOff, indexing: onOff }),
  content: z.object({ language: z.string().min(2).max(10), country: z.string().length(2), notes: z.string().max(2000) }),
  keywords: z.object({ seeds: z.string().max(3000), exclude: z.string().max(2000) }),
  alerts: z.object({ webhook: z.string().regex(/^$|^https:\/\//, "https URL"), pause_on_drop_pct: z.number().int().min(5).max(90) }),
  crawl: z.object({ max_pages: z.number().int().min(0).max(config.CRAWL_HARD_MAX_PAGES) }).optional(),
});

export function mergeConfig(stored) {
  const out = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(stored || {})) {
    if (!(k in out)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(out[k]).map(([f, d]) => [f, f in v ? v[f] : d])) : v;
  }
  return out;
}
export const getConfig = (site) => mergeConfig(json(site.config_json));
export const saveConfig = (site, cfg) => db.query("UPDATE sites SET config_json=? WHERE id=?", [JSON.stringify(cfg), site.id]);

export const splitList = (text, re) => String(text || "").split(re).map((t) => t.trim()).filter(Boolean);

export const logJob = (siteId, job, status, message) =>
  db.query("INSERT INTO job_log (site_id, job, status, message) VALUES (?,?,?,?)", [siteId, job, status, String(message || "").slice(0, 1000)]);

/**
 * Start an audit: one active run per site, quota reservation, crawl_runs row, crawl job.
 * Returns { ok, status, body } ready for an HTTP response.
 */
export async function startAudit({ site, userId = null, maxPages }) {
  const active = await one("SELECT id FROM crawl_runs WHERE site_id=? AND status IN ('queued','running')", [site.id]);
  if (active) return { ok: false, status: 409, body: { error: "audit already running", run_id: active.id } };
  const plan = await planFor(site.org_id);
  const cfg = getConfig(site);
  const want = maxPages || cfg.crawl?.max_pages || config.CRAWL_MAX_PAGES_DEFAULT;
  const pages = Math.max(1, Math.min(want, plan.limits.crawl_pages ?? config.CRAWL_HARD_MAX_PAGES, config.CRAWL_HARD_MAX_PAGES));
  const q = await reserve(site.org_id, "crawl_pages", pages);
  if (!q.ok) return { ok: false, status: 402, body: { error: "monthly crawl quota exceeded", metric: "crawl_pages", limit: q.limit, used: q.used, reserved: q.reserved, plan: q.plan } };
  const [r] = await db.query("INSERT INTO crawl_runs (org_id, site_id, status, config_json) VALUES (?,?,'queued',?)",
    [site.org_id, site.id, JSON.stringify({ max_pages: pages })]);
  const runId = r.insertId;
  let job;
  try {
    ({ job } = await enqueue({
      orgId: site.org_id, siteId: site.id, queue: "crawl", type: "audit", key: `audit:${site.id}:${runId}`, userId,
      payload: { runId, maxPages: pages, reserved: pages, period: q.period },
    }));
  } catch (e) {
    await db.query("UPDATE crawl_runs SET status='failed', error=? WHERE id=?", ["queue unavailable: " + e.message.slice(0, 200), runId]);
    const { release } = await import("./quota.js");
    await release(site.org_id, "crawl_pages", pages, q.period);
    return { ok: false, status: 503, body: { error: "queue unavailable" } };
  }
  await db.query("UPDATE crawl_runs SET job_id=? WHERE id=?", [job.id, runId]);
  return { ok: true, status: 202, body: { job_id: job.id, run_id: runId, max_pages: pages } };
}

export async function latestPages(site) {
  const [rows] = await db.query(
    `SELECT url, title, h1, meta_description, canonical, word_count, inlinks FROM pages
     WHERE run_id=(SELECT MAX(id) FROM crawl_runs WHERE site_id=? AND status='done') AND status='200'`, [site.id]);
  return rows;
}

export async function gscQueries(site, limit) {
  const [rows] = await db.query(
    `SELECT query, SUM(impressions) impressions, SUM(clicks) clicks,
       ROUND(SUM(position*impressions)/GREATEST(SUM(impressions),1),1) position,
       SUBSTRING_INDEX(GROUP_CONCAT(page ORDER BY impressions DESC SEPARATOR ' '), ' ', 1) top_page
     FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY query ORDER BY impressions DESC LIMIT ?`, [site.id, limit]);
  return rows;
}

export async function keywordContext(site, cfg) {
  const pages = (await latestPages(site)).filter((p) => !isPrivatePath(p.url));
  return {
    domain: site.domain, language: cfg.content.language, country: cfg.content.country, notes: cfg.content.notes,
    seeds: splitList(cfg.keywords.seeds, /\n/), exclude: splitList(cfg.keywords.exclude, /[,\n]/),
    pages: pages.map(({ url, title, h1 }) => ({ url, title, h1 })), gscQueries: await gscQueries(site, 300),
  };
}

export async function saveKeywords(site, list, source = "auto") {
  const own = site.domain.replace(/^www\./, "");
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  for (const k of list) {
    const target = k.target_url && host(k.target_url) === own ? k.target_url : null;
    const status = target ? (k.status === "partial" ? "partial" : "existing") : "gap";
    await db.query(
      `INSERT INTO keywords (org_id,site_id,term,cluster,intent,target_url,priority,status,demand,demand_src,difficulty,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE cluster=VALUES(cluster), intent=VALUES(intent), priority=VALUES(priority),
         demand=VALUES(demand), demand_src=VALUES(demand_src), difficulty=VALUES(difficulty),
         target_url=IF(status IN ('planned','written','ignored'), target_url, VALUES(target_url)),
         status=IF(status IN ('planned','written','ignored'), status, VALUES(status))`,
      [site.org_id, site.id, k.term.slice(0, 255), (k.cluster || "").slice(0, 255), k.intent, target,
        Math.max(1, Math.min(10, k.priority | 0)), status, k.demand ?? null, k.demand_src ?? null, k.difficulty ?? null, source]);
  }
  return list.length;
}

export async function scoreManualTerms(site, terms) {
  const cfg = getConfig(site);
  const ctx = new Ctx(await keywordContext(site, cfg));
  return scoreTerms(ctx, terms.slice(0, 20));
}

async function notify(cfg, text) {
  if (!cfg.alerts.webhook) return;
  await fetch(cfg.alerts.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10000) }).catch(() => {});
}

// ---------- scheduled jobs (run in workers) ----------
export const siteJobs = {
  async gsc(site) {
    if (!site.gsc_property || !google.configured()) return { skip: "Search Console is not linked" };
    const plan = await planFor(site.org_id);
    if (!plan.limits.gsc) return { skip: `Search Console sync is not included in the ${plan.code} plan` };
    const rows = await google.syncSafe(site, site.gsc_last_sync ? 7 : 90);
    return `${rows} rows synced`;
  },

  async alerts(site, cfg) {
    const [[mx]] = await db.query("SELECT MAX(date) d FROM gsc_daily WHERE site_id=?", [site.id]);
    if (!mx.d) return { skip: "no Search Console data yet" };
    const win = (a, b) => `date BETWEEN DATE_SUB(?, INTERVAL ${a} DAY) AND DATE_SUB(?, INTERVAL ${b} DAY)`;
    const [[tot]] = await db.query(
      `SELECT SUM(CASE WHEN ${win(6, 0)} THEN clicks END) cur, SUM(CASE WHEN ${win(13, 7)} THEN clicks END) prev FROM gsc_daily WHERE site_id=?`,
      [mx.d, mx.d, mx.d, mx.d, site.id]);
    const made = [];
    const add = async (type, severity, subject, detail) => {
      const dup = await one("SELECT id FROM alerts WHERE site_id=? AND type=? AND subject=? AND created_at > NOW() - INTERVAL 7 DAY", [site.id, type, subject]);
      if (dup) return;
      await db.query("INSERT INTO alerts (org_id,site_id,type,severity,subject,detail) VALUES (?,?,?,?,?,?)", [site.org_id, site.id, type, severity, subject.slice(0, 1000), detail]);
      made.push(`${subject}: ${detail}`);
    };
    const cur = Number(tot.cur || 0), prev = Number(tot.prev || 0);
    if (prev >= 20) {
      const drop = Math.round((1 - cur / prev) * 100);
      if (drop >= cfg.alerts.pause_on_drop_pct) await add("traffic_drop", "high", site.domain, `Clicks ${prev} -> ${cur} (-${drop}%) over the last 7 days.`);
    }
    for (const dim of ["page", "query"]) {
      const [rows] = await db.query(
        `SELECT ${dim} k, SUM(CASE WHEN ${win(6, 0)} THEN impressions END) ci, SUM(CASE WHEN ${win(13, 7)} THEN impressions END) pi,
           SUM(CASE WHEN ${win(6, 0)} THEN position*impressions END) cp, SUM(CASE WHEN ${win(13, 7)} THEN position*impressions END) pp
         FROM gsc_daily WHERE site_id=? AND date > DATE_SUB(?, INTERVAL 14 DAY) GROUP BY ${dim} HAVING pi >= 20 AND ci >= 5`,
        [mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, site.id, mx.d]);
      const drops = rows.map((r) => ({ k: r.k, before: r.pp / r.pi, after: r.cp / r.ci }))
        .filter((r) => r.before <= 20 && r.after - r.before >= 3).sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 10);
      for (const d of drops) await add("rank_drop", "med", d.k, `${dim} avg position ${d.before.toFixed(1)} -> ${d.after.toFixed(1)}`);
    }
    if (made.length) await notify(cfg, `FixMySEO alert (${site.domain}):\n- ${made.join("\n- ")}`);
    return `${made.length} new alerts`;
  },

  async indexing(site, cfg) {
    if (cfg.autonomy.indexing === "off") return { skip: "indexing off" };
    if (!site.gsc_property || !google.configured()) return { skip: "Search Console is not linked" };
    const token = await google.accessToken(site.org_id);
    const prop = encodeURIComponent(site.gsc_property);
    const notes = [];
    let maps = [];
    try {
      const { safeFetch } = await import("../seo/crawler.js");
      const r = await safeFetch(`${site.url}/robots.txt`, { accept: "text/plain" });
      if (r.status === 200) maps = [...r.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    } catch { /* no robots */ }
    if (!maps.length) maps = [`${site.url}/sitemap.xml`];
    for (const m of maps.slice(0, 5)) {
      try { await google.gsc(token, `/sites/${prop}/sitemaps/${encodeURIComponent(m)}`, undefined, "PUT"); notes.push(`sitemap submitted: ${m}`); }
      catch (e) { notes.push(/insufficient|permission/i.test(e.message) ? "reconnect Google to submit sitemaps (extra permission needed)" : `sitemap error: ${e.message}`); }
    }
    const pages = await latestPages(site);
    const [checked] = await db.query("SELECT url, checked_at FROM index_status WHERE site_id=?", [site.id]);
    const last = new Map(checked.map((c) => [c.url, new Date(c.checked_at).getTime()]));
    const urls = pages.map((p) => p.url).filter((u) => !isPrivatePath(u)).sort((a, b) => (last.get(a) || 0) - (last.get(b) || 0)).slice(0, 20);
    let n = 0;
    for (const u of urls) {
      try {
        const j = await google.gsc(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: u, siteUrl: site.gsc_property });
        const s = j.inspectionResult?.indexStatusResult || {};
        await db.query(
          `INSERT INTO index_status (site_id,url,url_hash,verdict,coverage,last_crawl) VALUES (?,?,MD5(?),?,?,?)
           ON DUPLICATE KEY UPDATE verdict=VALUES(verdict), coverage=VALUES(coverage), last_crawl=VALUES(last_crawl), checked_at=NOW()`,
          [site.id, u, u, s.verdict || null, (s.coverageState || "").slice(0, 255), s.lastCrawlTime || null]);
        n++;
      } catch (e) { notes.push(`inspection error: ${e.message}`); break; }
    }
    notes.push(`${n} URLs inspected`);
    return notes.join("; ");
  },

  async keywords(site, cfg) {
    if (cfg.autonomy.keywords === "off") return { skip: "keywords off" };
    const [tracked] = await db.query("SELECT term, status, source FROM keywords WHERE site_id=?", [site.id]);
    const ctx = new Ctx({
      ...(await keywordContext(site, cfg)),
      ignored: tracked.filter((t) => t.status === "ignored").map((t) => t.term),
    });
    const extra = tracked.filter((t) => t.source === "manual" && t.status !== "ignored").map((t) => t.term);
    const list = await basicResearch(ctx, extra);
    const n = await saveKeywords(site, list);
    let removed = 0;
    if (list.length >= 10) {
      const [d] = await db.query(
        "DELETE FROM keywords WHERE site_id=? AND source='auto' AND status IN ('gap','partial','existing') AND term NOT IN (?)",
        [site.id, list.map((k) => k.term.slice(0, 255))]);
      removed = d.affectedRows;
    }
    return `${n} keywords saved${removed ? `, ${removed} outdated removed` : ""} (${ctx.requests} autocomplete requests)`;
  },
};

/** Run one site job inside a worker and write job_log. Returns the message. */
export async function runSiteJob(siteId, job) {
  const site = await one("SELECT * FROM sites WHERE id=?", [siteId]);
  if (!site) throw new Error("site not found");
  if (site.status !== "active") { await logJob(siteId, job, "skip", "site paused"); return "site paused"; }
  const cfg = getConfig(site);
  try {
    const out = await siteJobs[job](site, cfg);
    if (out && typeof out === "object" && out.skip) { await logJob(siteId, job, "skip", out.skip); return out.skip; }
    await logJob(siteId, job, "ok", out);
    return out;
  } catch (e) {
    await logJob(siteId, job, "error", e.message);
    await auditSystem(site.org_id, `job.${job}.failed`, { entity: "site", entityId: site.id, meta: { error: e.message.slice(0, 300) } });
    throw e;
  }
}
