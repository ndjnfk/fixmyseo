import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { z } from "zod";
import { automationRoutes } from "./automation.js";
import { googleRoutes } from "./google.js";
import { insightRoutes } from "./insights.js";

const {
  PORT = 4000, HOST = "0.0.0.0", DB_HOST = "localhost", DB_PORT = 3306, DB_USER = "root", DB_PASSWORD = "", DB_NAME = "seo",
  JWT_SECRET = "change-me", INTERNAL_KEY = "internal-change-me",
  INTEL_URL = "http://localhost:8000", WEB_ORIGIN = "http://localhost:3000",
} = process.env;

const db = mysql.createPool({
  host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  connectionLimit: 10, charset: "utf8mb4",
});

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- auth ----------
const sign = (u) => jwt.sign({ uid: u.id, org: u.org_id, role: u.role }, JWT_SECRET, { expiresIn: "7d" });

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  try {
    req.user = jwt.verify(h.replace(/^Bearer /, ""), JWT_SECRET);
    next();
  } catch (e) {
    // reason (jaise "invalid signature", "jwt must be provided") login page par dikhta hai
    res.status(401).json({ error: "unauthorized", reason: e.message });
  }
}

app.post("/auth/register", wrap(async (req, res) => {
  const b = z.object({
    email: z.string().email(), password: z.string().min(8), orgName: z.string().min(1),
  }).parse(req.body);
  const [exists] = await db.query("SELECT id FROM users WHERE email=?", [b.email]);
  if (exists.length) return res.status(409).json({ error: "email already registered" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [o] = await conn.query("INSERT INTO orgs (name) VALUES (?)", [b.orgName]);
    const hash = await bcrypt.hash(b.password, 10);
    const [u] = await conn.query(
      "INSERT INTO users (org_id,email,password_hash,role) VALUES (?,?,?, 'owner')",
      [o.insertId, b.email, hash]);
    await conn.commit();
    res.json({ token: sign({ id: u.insertId, org_id: o.insertId, role: "owner" }) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.post("/auth/login", wrap(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const [rows] = await db.query("SELECT * FROM users WHERE email=?", [b.email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(b.password, u.password_hash)))
    return res.status(401).json({ error: "invalid credentials" });
  res.json({ token: sign(u) });
}));

// ---------- sites (har query org-scoped) ----------
function normalizeUrl(input) {
  const u = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`);
  return { url: u.origin, domain: u.hostname.replace(/^www\./, "") };
}

app.get("/sites", auth, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM issues i WHERE i.site_id=s.id AND i.run_id=
         (SELECT MAX(id) FROM crawl_runs r WHERE r.site_id=s.id AND r.status='done')) AS open_issues,
       (SELECT status FROM crawl_runs r WHERE r.site_id=s.id ORDER BY id DESC LIMIT 1) AS last_run_status
     FROM sites s WHERE s.org_id=? ORDER BY s.id DESC`, [req.user.org]);
  res.json(rows);
}));

app.post("/sites", auth, wrap(async (req, res) => {
  const b = z.object({ url: z.string().min(3), framework: z.string().optional() }).parse(req.body);
  let n;
  try { n = normalizeUrl(b.url); } catch { return res.status(400).json({ error: "invalid url" }); }
  try {
    const [r] = await db.query(
      "INSERT INTO sites (org_id,domain,url,framework) VALUES (?,?,?,?)",
      [req.user.org, n.domain, n.url, b.framework || null]);
    res.json({ id: r.insertId, ...n });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "site already added" });
    throw e;
  }
}));

async function ownSite(req, res) {
  const [rows] = await db.query("SELECT * FROM sites WHERE id=? AND org_id=?", [req.params.id, req.user.org]);
  if (!rows[0]) res.status(404).json({ error: "not found" });
  return rows[0];
}

app.get("/sites/:id", auth, wrap(async (req, res) => {
  const site = await ownSite(req, res);
  if (!site) return;
  const [runs] = await db.query(
    "SELECT id,status,pages_crawled,error,started_at,finished_at FROM crawl_runs WHERE site_id=? ORDER BY id DESC LIMIT 10", [site.id]);
  const lastDone = runs.find((r) => r.status === "done");
  let issues = [], summary = [];
  if (lastDone) {
    [issues] = await db.query(
      "SELECT type,severity,url,detail FROM issues WHERE run_id=? ORDER BY FIELD(severity,'high','med','low'),type LIMIT 2000", [lastDone.id]);
    [summary] = await db.query(
      "SELECT type,severity,COUNT(*) AS count FROM issues WHERE run_id=? GROUP BY type,severity ORDER BY FIELD(severity,'high','med','low')", [lastDone.id]);
  }
  res.json({ site, runs, summary, issues });
}));

app.get("/sites/:id/pages", auth, wrap(async (req, res) => {
  const site = await ownSite(req, res);
  if (!site) return;
  const [rows] = await db.query(
    `SELECT url,status,title,meta_description,h1,canonical,schema_types,word_count,response_time_s,inlinks
     FROM pages WHERE run_id=(SELECT MAX(id) FROM crawl_runs WHERE site_id=? AND status='done')`, [site.id]);
  res.json(rows);
}));

app.post("/sites/:id/audit", auth, wrap(async (req, res) => {
  const site = await ownSite(req, res);
  if (!site) return;
  const [running] = await db.query(
    "SELECT id FROM crawl_runs WHERE site_id=? AND status IN ('queued','running')", [site.id]);
  if (running.length) return res.status(409).json({ error: "audit already running" });
  const [r] = await db.query(
    "INSERT INTO crawl_runs (org_id,site_id,status) VALUES (?,?,'queued')", [req.user.org, site.id]);
  const resp = await fetch(`${INTEL_URL}/audit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ run_id: r.insertId, site_id: site.id, url: site.url, max_pages: 200 }),
  }).catch(() => null);
  if (!resp || !resp.ok) {
    await db.query("UPDATE crawl_runs SET status='failed', error=? WHERE id=?", ["intel service unreachable", r.insertId]);
    return res.status(502).json({ error: "intel service unreachable" });
  }
  res.json({ run_id: r.insertId, status: "queued" });
}));

// ---------- internal (Python service -> API) ----------
function internal(req, res, next) {
  if (req.headers["x-internal-key"] !== INTERNAL_KEY) return res.status(403).json({ error: "forbidden" });
  next();
}

app.post("/internal/audit-started", internal, wrap(async (req, res) => {
  await db.query("UPDATE crawl_runs SET status='running' WHERE id=?", [req.body.run_id]);
  res.json({ ok: true });
}));

app.post("/internal/audit-result", internal, wrap(async (req, res) => {
  const { run_id, error, pages = [], issues = [], summary = {} } = req.body;
  const [rr] = await db.query("SELECT org_id,site_id FROM crawl_runs WHERE id=?", [run_id]);
  if (!rr[0]) return res.status(404).json({ error: "run not found" });
  const { org_id, site_id } = rr[0];
  if (error) {
    await db.query("UPDATE crawl_runs SET status='failed', error=?, finished_at=NOW() WHERE id=?", [error, run_id]);
    return res.json({ ok: true });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (pages.length) {
      await conn.query(
        `INSERT INTO pages (org_id,site_id,run_id,url,status,title,meta_description,h1,canonical,schema_types,word_count,response_time_s,inlinks) VALUES ?`,
        [pages.map((p) => [org_id, site_id, run_id, p.url, String(p.status), p.title, p.meta_desc, p.h1,
          p.canonical, p.schema_types, p.word_count ?? null, p.time_s ?? null, p.inlinks ?? 0])]);
    }
    if (issues.length) {
      await conn.query(
        "INSERT INTO issues (org_id,site_id,run_id,type,severity,url,detail) VALUES ?",
        [issues.map((i) => [org_id, site_id, run_id, i.type, i.severity, i.url, i.detail])]);
    }
    await conn.query(
      "UPDATE crawl_runs SET status='done', pages_crawled=?, summary_json=?, finished_at=NOW() WHERE id=?",
      [pages.length, JSON.stringify(summary), run_id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json({ ok: true });
}));

const google = googleRoutes(app, { db, auth, wrap, ownSite, JWT_SECRET, WEB_ORIGIN });
automationRoutes(app, { db, auth, wrap, ownSite, google, INTEL_URL, INTERNAL_KEY });
insightRoutes(app, { db, auth, wrap, ownSite });

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid input", details: err.issues });
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

app.listen(PORT, HOST, () => console.log(`api on ${HOST}:${PORT}`));
