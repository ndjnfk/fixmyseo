// Google OAuth connect flow + Search Console endpoints. Sync runs as a queued job.
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { db, one } from "../db.js";
import { audit } from "../lib/audit.js";
import * as google from "../lib/google.js";
import { enqueue } from "../lib/queue.js";
import { featureEnabled } from "../lib/quota.js";
import { encReady } from "../lib/secrets.js";
import { auth, ownSite, requireRole, wrap } from "../middleware/auth.js";

export function googleRoutes(app) {
  const needConfig = (_req, res, next) =>
    google.configured() ? next() : res.status(503).json({ error: "Google integration not configured (set GOOGLE_CLIENT_ID/SECRET and ENC_KEY)" });

  app.get("/google/auth-url", auth, requireRole("admin"), needConfig, wrap(async (req, res) => {
    if (!(await featureEnabled(req.org.id, "gsc"))) return res.status(402).json({ error: "Search Console is not included in your plan" });
    const state = jwt.sign({ uid: req.user.id, org: req.org.id, site: req.query.site || null }, config.JWT_SECRET, { expiresIn: "10m" });
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: "code",
      scope: google.SCOPES, access_type: "offline", prompt: "consent", state,
    });
    res.json({ url });
  }));

  app.get("/google/callback", needConfig, wrap(async (req, res) => {
    let st;
    try { st = jwt.verify(String(req.query.state), config.JWT_SECRET); } catch { return res.status(400).send("invalid state"); }
    const back = (q) => res.redirect(`${config.WEB_ORIGIN}${st.site ? `/sites/${st.site}/search-console` : "/sites"}?${q}`);
    if (req.query.error) return back("google=denied");
    // the state was signed for a specific member; re-check membership before storing anything
    const m = await one("SELECT role FROM org_members WHERE org_id=? AND user_id=?", [st.org, st.uid]);
    if (!m || !["owner", "admin"].includes(m.role)) return back("google=forbidden");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(req.query.code), client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: config.GOOGLE_REDIRECT_URI, grant_type: "authorization_code" }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) return back("google=failed");
    let email = null;
    try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email; } catch { /* optional */ }
    await google.storeConnection({ orgId: st.org, userId: st.uid, email, refreshToken: j.refresh_token, scope: j.scope });
    req.org = { id: st.org }; req.user = { id: st.uid };
    await audit(req, "google.connect", { entity: "org", entityId: st.org, meta: { email } });
    back("google=connected");
  }));

  app.get("/google/status", auth, wrap(async (req, res) => {
    const row = await one("SELECT google_email, scope FROM google_connections WHERE org_id=?", [req.org.id]);
    res.json({
      configured: google.configured(), connected: Boolean(row), email: row?.google_email || null,
      missing: [!config.GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID", !config.GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET", !encReady() && "ENC_KEY (64 characters)"].filter(Boolean),
      can_submit: /auth\/webmasters(\s|$)/.test(row?.scope || ""),
      plan_allows: await featureEnabled(req.org.id, "gsc"),
    });
  }));

  app.delete("/google/connection", auth, requireRole("admin"), wrap(async (req, res) => {
    await google.disconnect(req.org.id);
    await audit(req, "google.disconnect", { entity: "org", entityId: req.org.id });
    res.json({ ok: true });
  }));

  app.get("/google/properties", auth, needConfig, wrap(async (req, res) => {
    const j = await google.gsc(await google.accessToken(req.org.id), "/sites");
    res.json((j.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ property: s.siteUrl, level: s.permissionLevel })));
  }));

  app.post("/sites/:id/gsc", auth, requireRole("admin"), needConfig, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const { property } = z.object({ property: z.string().min(3) }).parse(req.body);
    const j = await google.gsc(await google.accessToken(req.org.id), "/sites");
    if (!(j.siteEntry || []).some((s) => s.siteUrl === property)) return res.status(400).json({ error: "property not accessible with connected Google account" });
    await db.query("UPDATE sites SET gsc_property=?, gsc_sync_error=NULL WHERE id=?", [property, site.id]);
    await audit(req, "site.gsc_link", { entity: "site", entityId: site.id, meta: { property } });
    res.json({ ok: true });
  }));

  app.post("/sites/:id/gsc/sync", auth, requireRole("editor"), needConfig, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    if (!site.gsc_property) return res.status(400).json({ error: "no Search Console property linked" });
    if (!(await featureEnabled(req.org.id, "gsc"))) return res.status(402).json({ error: "Search Console is not included in your plan" });
    const { job, duplicate } = await enqueue({ orgId: req.org.id, siteId: site.id, queue: "gsc", type: "sync", key: `gsc:${site.id}:manual`, userId: req.user.id, payload: {} });
    res.status(202).json({ job_id: job.id, duplicate });
  }));

  app.get("/sites/:id/gsc/summary", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const win = "date >= DATE_SUB((SELECT MAX(date) FROM gsc_daily WHERE site_id=?), INTERVAL 27 DAY)";
    const [daily] = await db.query(`SELECT date, SUM(clicks) clicks, SUM(impressions) impressions FROM gsc_daily WHERE site_id=? AND ${win} GROUP BY date ORDER BY date`, [site.id, site.id]);
    const grp = (col) => `SELECT ${col} AS k, SUM(clicks) clicks, SUM(impressions) impressions, ROUND(SUM(position*impressions)/SUM(impressions),1) position FROM gsc_daily WHERE site_id=? AND ${win} GROUP BY ${col}`;
    const [queries] = await db.query(`${grp("query")} ORDER BY clicks DESC, impressions DESC LIMIT 20`, [site.id, site.id]);
    const [pages] = await db.query(`${grp("page")} ORDER BY clicks DESC, impressions DESC LIMIT 20`, [site.id, site.id]);
    const [opps] = await db.query(`${grp("query")} HAVING position BETWEEN 4 AND 20 AND impressions >= 10 ORDER BY impressions DESC LIMIT 20`, [site.id, site.id]);
    res.json({
      property: site.gsc_property, last_sync: site.gsc_last_sync, sync_error: site.gsc_sync_error, source: "observed (Google Search Console)",
      totals: { clicks: daily.reduce((a, d) => a + Number(d.clicks), 0), impressions: daily.reduce((a, d) => a + Number(d.impressions), 0) },
      daily, queries, pages, opportunities: opps,
    });
  }));

  return google;
}
