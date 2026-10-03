import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { decrypt, encReady, encrypt } from "./secrets.js";

const {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI = "http://localhost:4000/google/callback",
} = process.env;

// webmasters (read+write) sitemap submit ke liye chahiye; data sirf padhte hain
const SCOPES = ["https://www.googleapis.com/auth/webmasters", "openid", "email"].join(" ");
const configured = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && encReady());

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

export function googleRoutes(app, { db, auth, wrap, ownSite, JWT_SECRET, WEB_ORIGIN }) {
  const needConfig = (_req, res, next) =>
    configured() ? next() : res.status(503).json({ error: "Google integration not configured (set GOOGLE_CLIENT_ID/SECRET and ENC_KEY)" });

  async function accessToken(orgId) {
    const [rows] = await db.query("SELECT refresh_token_enc FROM google_connections WHERE org_id=?", [orgId]);
    if (!rows[0]) throw new Error("Google not connected");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: decrypt(rows[0].refresh_token_enc), grant_type: "refresh_token",
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`token refresh failed: ${j.error_description || j.error}`);
    return j.access_token;
  }

  async function gsc(token, path, body, method) {
    const r = await fetch(path.startsWith("https://") ? path : `https://www.googleapis.com/webmasters/v3${path}`, {
      method: method || (body ? "POST" : "GET"),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `GSC error ${r.status}`);
    return j;
  }

  async function syncSite(site, days = 90) {
    const token = await accessToken(site.org_id);
    const start = daysAgo(days), end = daysAgo(2); // GSC data ~2 din late aata hai
    let startRow = 0, total = 0;
    for (;;) {
      const j = await gsc(token, `/sites/${encodeURIComponent(site.gsc_property)}/searchAnalytics/query`, {
        startDate: start, endDate: end, dimensions: ["date", "query", "page"],
        rowLimit: 25000, startRow, dataState: "final",
      });
      const rows = j.rows || [];
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000).map((r) => {
          const [date, query, page] = r.keys;
          const hash = crypto.createHash("md5").update(`${site.id}|${date}|${query}|${page}`).digest("hex");
          return [site.org_id, site.id, date, query.slice(0, 500), page.slice(0, 1000),
            r.clicks, r.impressions, r.ctr, r.position, hash];
        });
        await db.query(
          `INSERT INTO gsc_daily (org_id,site_id,date,query,page,clicks,impressions,ctr,position,row_hash) VALUES ?
           ON DUPLICATE KEY UPDATE clicks=VALUES(clicks), impressions=VALUES(impressions), ctr=VALUES(ctr), position=VALUES(position)`,
          [chunk]);
      }
      total += rows.length;
      if (rows.length < 25000 || total >= 500000) break;
      startRow += 25000;
    }
    await db.query("UPDATE sites SET gsc_last_sync=NOW(), gsc_sync_error=NULL WHERE id=?", [site.id]);
    return total;
  }

  async function syncSafe(site, days) {
    try {
      return await syncSite(site, days);
    } catch (e) {
      await db.query("UPDATE sites SET gsc_sync_error=? WHERE id=?", [String(e.message).slice(0, 500), site.id]);
      throw e;
    }
  }

  // ---- connect flow ----
  app.get("/google/auth-url", auth, needConfig, wrap(async (req, res) => {
    const state = jwt.sign({ uid: req.user.uid, org: req.user.org, site: req.query.site || null }, JWT_SECRET, { expiresIn: "10m" });
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: "code",
      scope: SCOPES, access_type: "offline", prompt: "consent", state,
    });
    res.json({ url });
  }));

  app.get("/google/callback", needConfig, wrap(async (req, res) => {
    let st;
    try { st = jwt.verify(String(req.query.state), JWT_SECRET); } catch { return res.status(400).send("invalid state"); }
    const back = (q) => res.redirect(`${WEB_ORIGIN}${st.site ? `/sites/${st.site}/search-console` : "/sites"}?${q}`);
    if (req.query.error) return back(`google=denied`);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(req.query.code), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI, grant_type: "authorization_code",
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) return back("google=failed");
    let email = null;
    try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email; } catch { /* optional */ }
    await db.query(
      `INSERT INTO google_connections (org_id,user_id,google_email,refresh_token_enc,scope) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), google_email=VALUES(google_email),
         refresh_token_enc=VALUES(refresh_token_enc), scope=VALUES(scope)`,
      [st.org, st.uid, email, encrypt(j.refresh_token), j.scope || SCOPES]);
    back("google=connected");
  }));

  app.get("/google/status", auth, wrap(async (req, res) => {
    const [rows] = await db.query("SELECT google_email FROM google_connections WHERE org_id=?", [req.user.org]);
    const [sc] = await db.query("SELECT scope FROM google_connections WHERE org_id=?", [req.user.org]);
    res.json({
      configured: configured(), connected: rows.length > 0, email: rows[0]?.google_email || null,
      // kaunsi setting kami hai, taaki UI saaf bata sake
      missing: [!GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID", !GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
        !encReady() && "ENC_KEY (64 characters)"].filter(Boolean),
      can_submit: /auth\/webmasters(\s|$)/.test(sc[0]?.scope || ""),
    });
  }));

  // Disconnect: Google par token revoke + Google se aaya saara data delete (privacy policy yahi wada karti hai)
  app.delete("/google/connection", auth, wrap(async (req, res) => {
    const [rows] = await db.query("SELECT refresh_token_enc FROM google_connections WHERE org_id=?", [req.user.org]);
    if (rows[0]) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decrypt(rows[0].refresh_token_enc) }),
      }).catch(() => {}); // Google tak na pahunche to bhi local data hatao
    }
    await db.query("DELETE FROM google_connections WHERE org_id=?", [req.user.org]);
    await db.query("DELETE FROM gsc_daily WHERE org_id=?", [req.user.org]);
    await db.query("DELETE i FROM index_status i JOIN sites s ON s.id=i.site_id WHERE s.org_id=?", [req.user.org]);
    await db.query("UPDATE sites SET gsc_property=NULL, gsc_last_sync=NULL, gsc_sync_error=NULL WHERE org_id=?", [req.user.org]);
    res.json({ ok: true });
  }));

  app.get("/google/properties", auth, needConfig, wrap(async (req, res) => {
    const j = await gsc(await accessToken(req.user.org), "/sites");
    res.json((j.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser")
      .map((s) => ({ property: s.siteUrl, level: s.permissionLevel })));
  }));

  // ---- per-site ----
  app.post("/sites/:id/gsc", auth, needConfig, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { property } = z.object({ property: z.string().min(3) }).parse(req.body);
    const j = await gsc(await accessToken(req.user.org), "/sites");
    if (!(j.siteEntry || []).some((s) => s.siteUrl === property))
      return res.status(400).json({ error: "property not accessible with connected Google account" });
    await db.query("UPDATE sites SET gsc_property=?, gsc_sync_error=NULL WHERE id=?", [property, site.id]);
    res.json({ ok: true });
  }));

  app.post("/sites/:id/gsc/sync", auth, needConfig, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    if (!site.gsc_property) return res.status(400).json({ error: "no Search Console property linked" });
    try {
      res.json({ rows: await syncSafe(site, 90) });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }));

  app.get("/sites/:id/gsc/summary", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const win = "date >= DATE_SUB((SELECT MAX(date) FROM gsc_daily WHERE site_id=?), INTERVAL 27 DAY)";
    const [daily] = await db.query(
      `SELECT date, SUM(clicks) clicks, SUM(impressions) impressions FROM gsc_daily WHERE site_id=? AND ${win} GROUP BY date ORDER BY date`,
      [site.id, site.id]);
    const grp = (col) => `SELECT ${col} AS k, SUM(clicks) clicks, SUM(impressions) impressions,
        ROUND(SUM(position*impressions)/SUM(impressions),1) position
      FROM gsc_daily WHERE site_id=? AND ${win} GROUP BY ${col}`;
    const [queries] = await db.query(`${grp("query")} ORDER BY clicks DESC, impressions DESC LIMIT 20`, [site.id, site.id]);
    const [pages] = await db.query(`${grp("page")} ORDER BY clicks DESC, impressions DESC LIMIT 20`, [site.id, site.id]);
    const [opps] = await db.query(
      `${grp("query")} HAVING position BETWEEN 4 AND 20 AND impressions >= 10 ORDER BY impressions DESC LIMIT 20`, [site.id, site.id]);
    res.json({
      property: site.gsc_property, last_sync: site.gsc_last_sync, sync_error: site.gsc_sync_error,
      totals: {
        clicks: daily.reduce((a, d) => a + Number(d.clicks), 0),
        impressions: daily.reduce((a, d) => a + Number(d.impressions), 0),
      },
      daily, queries, pages, opportunities: opps,
    });
  }));

  // daily sync ab automation scheduler (automation.js) chalata hai
  return { configured, accessToken, gsc, syncSafe };
}
