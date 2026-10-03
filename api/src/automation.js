// Automation engine: audit, keywords, GSC sync, indexing, alerts + scheduler.
import { z } from "zod";

const DEFAULTS = {
  autonomy: { keywords: "auto", indexing: "auto" }, // auto | off
  content: { language: "en", country: "IN", notes: "" }, // keyword research context
  keywords: { seeds: "", exclude: "" }, // apne topics (ek line = ek topic) + faltu shabd (comma/line)
  alerts: { webhook: "", pause_on_drop_pct: 25 },
};

// partial = page hai par keyword poora cover nahi; ignored = user ne faltu bola (dobara nahi aayega)
const KW_STATUS = "'existing','gap','planned','written','partial','ignored'";
const KW_COLUMNS = [["demand", "TINYINT UNSIGNED NULL"], ["demand_src", "VARCHAR(10) NULL"],
  ["difficulty", "TINYINT UNSIGNED NULL"], ["source", "VARCHAR(12) NOT NULL DEFAULT 'auto'"]];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS keywords (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, org_id BIGINT UNSIGNED NOT NULL, site_id BIGINT UNSIGNED NOT NULL,
    term VARCHAR(255) NOT NULL, cluster VARCHAR(255) NULL, intent VARCHAR(30) NULL, target_url VARCHAR(1000) NULL,
    priority INT NOT NULL DEFAULT 5, status ENUM(${KW_STATUS}) NOT NULL DEFAULT 'gap',
    demand TINYINT UNSIGNED NULL, demand_src VARCHAR(10) NULL, difficulty TINYINT UNSIGNED NULL,
    source VARCHAR(12) NOT NULL DEFAULT 'auto',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_term (site_id, term), FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, org_id BIGINT UNSIGNED NOT NULL, site_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(40) NOT NULL, severity ENUM('high','med','low') NOT NULL, subject VARCHAR(1000) NOT NULL,
    detail VARCHAR(1000) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_site (site_id), FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS index_status (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, site_id BIGINT UNSIGNED NOT NULL, url VARCHAR(1000) NOT NULL,
    url_hash CHAR(32) NOT NULL, verdict VARCHAR(40) NULL, coverage VARCHAR(255) NULL, last_crawl VARCHAR(40) NULL,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_url (site_id, url_hash), FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS job_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, site_id BIGINT UNSIGNED NOT NULL, job VARCHAR(30) NOT NULL,
    status ENUM('ok','skip','error') NOT NULL, message VARCHAR(1000) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_site_job (site_id, job), FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE)`,
];

const DAILY = ["gsc", "alerts", "indexing"];
const WEEKLY = ["audit", "keywords"];
const JOBS = [...WEEKLY, ...DAILY];

// login/account jaise pages ko kabhi touch nahi karte
const PRIVATE_PATH = /\/(account|login|signin|sign-in|signup|sign-up|register|admin|dashboard|cart|checkout|api)(\/|$)/i;

function mergeConfig(stored) {
  const out = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(stored || {})) {
    if (!(k in out)) continue; // purani hatayi gayi settings (github, fixes...) ignore
    out[k] = v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(out[k]).map(([f, d]) => [f, f in v ? v[f] : d]))
      : v;
  }
  return out;
}

export function automationRoutes(app, { db, auth, wrap, ownSite, google, INTEL_URL, INTERNAL_KEY }) {
  const running = new Set(); // per-site lock

  async function ensureSchema() {
    for (const sql of SCHEMA) await db.query(sql);
    // purani keywords table ko naye columns/status do (MySQL mein ADD COLUMN IF NOT EXISTS nahi hai)
    const [cols] = await db.query(
      "SELECT COLUMN_NAME c, COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='keywords'");
    const have = new Map(cols.map((r) => [r.c, r.t]));
    for (const [c, def] of KW_COLUMNS) if (!have.has(c)) await db.query(`ALTER TABLE keywords ADD COLUMN ${c} ${def}`);
    if (!String(have.get("status")).includes("ignored"))
      await db.query(`ALTER TABLE keywords MODIFY status ENUM(${KW_STATUS}) NOT NULL DEFAULT 'gap'`);
  }

  const log = (site, job, status, message) =>
    db.query("INSERT INTO job_log (site_id,job,status,message) VALUES (?,?,?,?)",
      [site.id, job, status, String(message || "").slice(0, 1000)]);

  const getConfig = (site) => mergeConfig(typeof site.config_json === "string" ? JSON.parse(site.config_json) : site.config_json);
  const saveConfig = (site, cfg) => db.query("UPDATE sites SET config_json=? WHERE id=?", [JSON.stringify(cfg), site.id]);

  // intel par lamba kaam: job start karo, phir poll (LLM calls kai minute le sakti hain)
  async function intel(path, body) {
    const r = await fetch(`${INTEL_URL}${path}`, {
      method: "POST", headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `intel error ${r.status}`);
    const until = Date.now() + 30 * 60 * 1000;
    while (Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, 4000));
      const p = await (await fetch(`${INTEL_URL}/jobs/${j.job_id}`, { headers: { "x-internal-key": INTERNAL_KEY } })).json();
      if (p.status === "done") return p.result;
      if (p.status === "error") throw new Error(p.error);
    }
    throw new Error("intel job timeout");
  }

  async function latestPages(site) {
    const [rows] = await db.query(
      `SELECT url,title,h1,meta_description,canonical,word_count FROM pages
       WHERE run_id=(SELECT MAX(id) FROM crawl_runs WHERE site_id=? AND status='done') AND status='200'`, [site.id]);
    return rows;
  }

  // GSC queries (90 din) + har query ka sabse zyada impressions wala page
  async function gscQueries(site, limit) {
    const [rows] = await db.query(
      `SELECT query, SUM(impressions) impressions, SUM(clicks) clicks,
         ROUND(SUM(position*impressions)/GREATEST(SUM(impressions),1),1) position,
         SUBSTRING_INDEX(GROUP_CONCAT(page ORDER BY impressions DESC SEPARATOR ' '), ' ', 1) top_page
       FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY query ORDER BY impressions DESC LIMIT ?`, [site.id, limit]);
    return rows;
  }

  const splitList = (text, re) => String(text || "").split(re).map((t) => t.trim()).filter(Boolean);

  async function keywordContext(site, cfg) {
    const pages = (await latestPages(site)).filter((p) => !PRIVATE_PATH.test(new URL(p.url).pathname));
    return {
      domain: site.domain, language: cfg.content.language, country: cfg.content.country, notes: cfg.content.notes,
      seeds: splitList(cfg.keywords.seeds, /\n/), exclude: splitList(cfg.keywords.exclude, /[,\n]/),
      pages: pages.map(({ url, title, h1 }) => ({ url, title, h1 })), gsc_queries: await gscQueries(site, 300),
    };
  }

  async function saveKeywords(site, list, source = "auto") {
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
    const own = site.domain.replace(/^www\./, "");
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
          Math.max(1, Math.min(10, k.priority | 0)), status, k.demand ?? null, k.demand_src ?? null,
          k.difficulty ?? null, source]);
    }
    return list.length;
  }

  async function notify(cfg, text) {
    if (!cfg.alerts.webhook) return;
    await fetch(cfg.alerts.webhook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }), // Slack (text) aur Discord (content) dono
    }).catch(() => {});
  }

  // ---------- jobs ----------
  const jobs = {
    async audit(site) {
      const [r] = await db.query("INSERT INTO crawl_runs (org_id,site_id,status) VALUES (?,?,'queued')", [site.org_id, site.id]);
      const resp = await fetch(`${INTEL_URL}/audit`, {
        method: "POST", headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
        body: JSON.stringify({ run_id: r.insertId, site_id: site.id, url: site.url, max_pages: 500 }),
      }).catch(() => null);
      if (!resp?.ok) {
        await db.query("UPDATE crawl_runs SET status='failed', error='intel service unreachable' WHERE id=?", [r.insertId]);
        throw new Error("intel service unreachable");
      }
      return "audit queued";
    },

    async gsc(site) {
      if (!site.gsc_property || !google.configured()) return { skip: "Search Console is not linked" };
      const rows = await google.syncSafe(site, site.gsc_last_sync ? 7 : 90);
      return `${rows} rows synced`;
    },

    async alerts(site, cfg) {
      const [[mx]] = await db.query("SELECT MAX(date) d FROM gsc_daily WHERE site_id=?", [site.id]);
      if (!mx.d) return { skip: "no Search Console data yet" };
      const win = (a, b) => `date BETWEEN DATE_SUB(?, INTERVAL ${a} DAY) AND DATE_SUB(?, INTERVAL ${b} DAY)`;
      const [[tot]] = await db.query(
        `SELECT SUM(CASE WHEN ${win(6, 0)} THEN clicks END) cur, SUM(CASE WHEN ${win(13, 7)} THEN clicks END) prev
         FROM gsc_daily WHERE site_id=?`, [mx.d, mx.d, mx.d, mx.d, site.id]);
      const made = [];
      const add = async (type, severity, subject, detail) => {
        const [dup] = await db.query(
          "SELECT id FROM alerts WHERE site_id=? AND type=? AND subject=? AND created_at > NOW() - INTERVAL 7 DAY",
          [site.id, type, subject]);
        if (dup.length) return;
        await db.query("INSERT INTO alerts (org_id,site_id,type,severity,subject,detail) VALUES (?,?,?,?,?,?)",
          [site.org_id, site.id, type, severity, subject.slice(0, 1000), detail]);
        made.push(`${subject}: ${detail}`);
      };
      const cur = Number(tot.cur || 0), prev = Number(tot.prev || 0);
      if (prev >= 20) {
        const drop = Math.round((1 - cur / prev) * 100);
        if (drop >= cfg.alerts.pause_on_drop_pct) {
          await add("traffic_drop", "high", site.domain, `Clicks ${prev} -> ${cur} (-${drop}%) over the last 7 days.`);
        }
      }
      for (const dim of ["page", "query"]) {
        const [rows] = await db.query(
          `SELECT ${dim} k,
             SUM(CASE WHEN ${win(6, 0)} THEN impressions END) ci, SUM(CASE WHEN ${win(13, 7)} THEN impressions END) pi,
             SUM(CASE WHEN ${win(6, 0)} THEN position*impressions END) cp, SUM(CASE WHEN ${win(13, 7)} THEN position*impressions END) pp
           FROM gsc_daily WHERE site_id=? AND date > DATE_SUB(?, INTERVAL 14 DAY) GROUP BY ${dim}
           HAVING pi >= 20 AND ci >= 5`, [mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, mx.d, site.id, mx.d]);
        const drops = rows.map((r) => ({ k: r.k, before: r.pp / r.pi, after: r.cp / r.ci }))
          .filter((r) => r.before <= 20 && r.after - r.before >= 3)
          .sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 10);
        for (const d of drops)
          await add("rank_drop", "med", d.k, `${dim} avg position ${d.before.toFixed(1)} -> ${d.after.toFixed(1)}`);
      }
      if (made.length) await notify(cfg, `Auto SEO alert (${site.domain}):\n- ${made.join("\n- ")}`);
      return `${made.length} new alerts`;
    },

    async indexing(site, cfg) {
      if (cfg.autonomy.indexing === "off") return { skip: "indexing off" };
      if (!site.gsc_property || !google.configured()) return { skip: "Search Console is not linked" };
      const token = await google.accessToken(site.org_id);
      const prop = encodeURIComponent(site.gsc_property);
      const notes = [];
      // 1) sitemap submit (robots.txt mein jo sitemaps likhe hain, warna /sitemap.xml)
      let maps = [];
      try {
        const txt = await (await fetch(`${site.url}/robots.txt`)).text();
        maps = [...txt.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      } catch { /* robots nahi mila */ }
      if (!maps.length) maps = [`${site.url}/sitemap.xml`];
      for (const m of maps.slice(0, 5)) {
        try {
          await google.gsc(token, `/sites/${prop}/sitemaps/${encodeURIComponent(m)}`, undefined, "PUT");
          notes.push(`sitemap submitted: ${m}`);
        } catch (e) {
          notes.push(/insufficient|permission/i.test(e.message)
            ? "reconnect Google to submit sitemaps (extra permission needed)" : `sitemap error: ${e.message}`);
        }
      }
      // 2) URL inspection: sabse purane checks pehle (quota bachane ke liye 20/day)
      const pages = await latestPages(site);
      const [checked] = await db.query("SELECT url, checked_at FROM index_status WHERE site_id=?", [site.id]);
      const last = new Map(checked.map((c) => [c.url, new Date(c.checked_at).getTime()]));
      const rest = pages.map((p) => p.url).filter((u) => !PRIVATE_PATH.test(new URL(u).pathname))
        .sort((a, b) => (last.get(a) || 0) - (last.get(b) || 0));
      const urls = rest.slice(0, 20);
      let n = 0;
      for (const u of urls) {
        try {
          const j = await google.gsc(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
            { inspectionUrl: u, siteUrl: site.gsc_property });
          const s = j.inspectionResult?.indexStatusResult || {};
          await db.query(
            `INSERT INTO index_status (site_id,url,url_hash,verdict,coverage,last_crawl) VALUES (?,?,MD5(?),?,?,?)
             ON DUPLICATE KEY UPDATE verdict=VALUES(verdict), coverage=VALUES(coverage), last_crawl=VALUES(last_crawl), checked_at=NOW()`,
            [site.id, u, u, s.verdict || null, (s.coverageState || "").slice(0, 255), s.lastCrawlTime || null]);
          n++;
        } catch (e) {
          notes.push(`inspection error: ${e.message}`);
          break;
        }
      }
      notes.push(`${n} URLs inspected`);
      return notes.join("; ");
    },

    async keywords(site, cfg) {
      if (cfg.autonomy.keywords === "off") return { skip: "keywords off" };
      const [tracked] = await db.query("SELECT term,status,source FROM keywords WHERE site_id=?", [site.id]);
      const res = await intel("/keywords", {
        ...(await keywordContext(site, cfg)),
        existing: tracked.map((t) => t.term),
        ignored: tracked.filter((t) => t.status === "ignored").map((t) => t.term),
        extra_terms: tracked.filter((t) => t.source === "manual" && t.status !== "ignored").map((t) => t.term),
      });
      const n = await saveKeywords(site, res.keywords);
      // basic mode har baar poori list dobara banata hai: purane auto keywords jo ab nahi aaye, hatao.
      // (result chhota ho to shayad Google ne block kiya; tab kuch mat hatao)
      let removed = 0;
      if (res.mode === "basic" && res.keywords.length >= 10) {
        const [d] = await db.query(
          `DELETE FROM keywords WHERE site_id=? AND source='auto' AND status IN ('gap','partial','existing') AND term NOT IN (?)`,
          [site.id, res.keywords.map((k) => k.term.slice(0, 255))]);
        removed = d.affectedRows;
      }
      return `${n} keywords saved${removed ? `, ${removed} outdated removed` : ""}`;
    },
  };

  async function runJob(site, job) {
    const cfg = getConfig(site);
    try {
      const out = await jobs[job](site, cfg);
      if (out && typeof out === "object" && out.skip) await log(site, job, "skip", out.skip);
      else await log(site, job, "ok", out);
    } catch (e) {
      console.error(`[${site.domain}] ${job}:`, e.message);
      await log(site, job, "error", e.message);
    }
  }

  async function runSite(siteId, only) {
    if (running.has(siteId)) return false;
    running.add(siteId);
    try {
      for (const job of only ? [only] : JOBS) {
        const [[site]] = await db.query("SELECT * FROM sites WHERE id=?", [siteId]);
        if (!site || site.status !== "active") break;
        if (!only) {
          const [[last]] = await db.query(
            "SELECT created_at t, status FROM job_log WHERE site_id=? AND job=? ORDER BY id DESC LIMIT 1", [siteId, job]);
          // error ho to 6 ghante baad retry; warna daily/weekly
          const every = last?.status === "error" ? 6 * 3600 * 1000
            : (WEEKLY.includes(job) ? 7 : 1) * 24 * 3600 * 1000 - 30 * 60 * 1000;
          if (last && Date.now() - new Date(last.t).getTime() < every) continue;
        }
        await runJob(site, job);
      }
    } finally {
      running.delete(siteId);
    }
    return true;
  }

  async function tick() {
    const [sites] = await db.query("SELECT id FROM sites WHERE status='active'");
    for (const s of sites) await runSite(s.id).catch((e) => console.error("tick", e));
  }

  ensureSchema().then(() => {
    setTimeout(() => tick().catch(console.error), 60 * 1000);
    setInterval(() => tick().catch(console.error), 30 * 60 * 1000);
  }).catch((e) => console.error("automation schema failed:", e));

  // ---------- routes ----------
  app.get("/sites/:id/automation", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const cfg = getConfig(site);
    const q = (sql) => db.query(sql, [site.id]).then(([r]) => r);
    res.json({
      config: cfg, running: running.has(site.id), jobs: JOBS,
      log: await q(`SELECT job,status,message,created_at FROM job_log WHERE site_id=? AND job IN (${JOBS.map((j) => `'${j}'`).join(",")})
        ORDER BY id DESC LIMIT 40`),
      alerts: await q("SELECT type,severity,subject,detail,created_at FROM alerts WHERE site_id=? ORDER BY id DESC LIMIT 30"),
      index: await q("SELECT url,verdict,coverage,last_crawl,checked_at FROM index_status WHERE site_id=? ORDER BY checked_at DESC LIMIT 100"),
      keywords: (await db.query(
        `SELECT k.term,k.cluster,k.intent,k.target_url,k.priority,k.status,k.demand,k.demand_src,k.difficulty,k.source,
           g.impressions, g.clicks, g.position
         FROM keywords k LEFT JOIN (
           SELECT query, SUM(impressions) impressions, SUM(clicks) clicks,
             ROUND(SUM(position*impressions)/GREATEST(SUM(impressions),1),1) position
           FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) GROUP BY query
         ) g ON g.query = k.term
         WHERE k.site_id=? ORDER BY k.status='ignored', k.priority DESC, k.demand DESC, k.term LIMIT 500`,
        [site.id, site.id]))[0],
    });
  }));

  const onOff = z.enum(["auto", "off"]);
  const cfgSchema = z.object({
    autonomy: z.object({ keywords: onOff, indexing: onOff }),
    content: z.object({ language: z.string().min(2).max(10), country: z.string().length(2), notes: z.string().max(2000) }),
    keywords: z.object({ seeds: z.string().max(3000), exclude: z.string().max(2000) }),
    alerts: z.object({ webhook: z.string().regex(/^$|^https:\/\//, "https URL"), pause_on_drop_pct: z.number().int().min(5).max(90) }),
  });

  app.put("/sites/:id/automation", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ config: cfgSchema }).parse(req.body);
    await saveConfig(site, { ...getConfig(site), ...b.config });
    res.json({ ok: true });
  }));

  app.post("/sites/:id/automation/run", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { job } = z.object({ job: z.enum(["all", ...JOBS]) }).parse(req.body);
    if (running.has(site.id)) return res.status(409).json({ error: "automation is already running for this site" });
    runSite(site.id, job === "all" ? null : job).catch(console.error); // background
    res.json({ started: true });
  }));

  // haath se keywords jodo: turant score hokar list mein aate hain
  app.post("/sites/:id/keywords", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { terms } = z.object({ terms: z.string().min(2).max(2000) }).parse(req.body);
    const list = [...new Set(splitList(terms.toLowerCase(), /[,\n]/))].filter((t) => t.length <= 255).slice(0, 20);
    if (!list.length) return res.status(400).json({ error: "enter at least one keyword" });
    const r = await fetch(`${INTEL_URL}/keywords/score`, {
      method: "POST", headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify({ ...(await keywordContext(site, getConfig(site))), extra_terms: list }),
    }).catch(() => null);
    if (!r?.ok) return res.status(502).json({ error: "intel service unreachable" });
    // pehle ignore kiya tha aur ab khud jod rahe ho: wapas le aao
    await db.query("UPDATE keywords SET status='gap' WHERE site_id=? AND status='ignored' AND term IN (?)", [site.id, list]);
    await db.query("UPDATE keywords SET source='manual' WHERE site_id=? AND term IN (?)", [site.id, list]);
    res.json({ added: await saveKeywords(site, (await r.json()).keywords, "manual") });
  }));

  app.patch("/sites/:id/keywords", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const b = z.object({ term: z.string().min(1).max(255), action: z.enum(["ignore", "restore"]) }).parse(req.body);
    await db.query(
      b.action === "ignore"
        ? "UPDATE keywords SET status='ignored' WHERE site_id=? AND term=?"
        : "UPDATE keywords SET status=IF(target_url IS NULL,'gap','existing') WHERE site_id=? AND term=? AND status='ignored'",
      [site.id, b.term]);
    res.json({ ok: true });
  }));
}
