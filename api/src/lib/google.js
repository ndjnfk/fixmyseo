// Google OAuth + Search Console helpers (no HTTP routes here; used by routes/google.js and workers/gsc.js).
import crypto from "node:crypto";
import { config } from "../config.js";
import { db, one } from "../db.js";
import { decrypt, encReady, encrypt } from "./secrets.js";

export const SCOPES = ["https://www.googleapis.com/auth/webmasters", "openid", "email"].join(" ");
export const configured = () => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && encReady());

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

export class GscError extends Error {
  constructor(msg, status) { super(msg); this.name = "GscError"; this.status = status; this.retryable = status === 429 || status >= 500; }
}

export async function accessToken(orgId) {
  const row = await one("SELECT refresh_token_enc FROM google_connections WHERE org_id=?", [orgId]);
  if (!row) throw new GscError("Google not connected", 400);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: decrypt(row.refresh_token_enc), grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GscError(`token refresh failed: ${j.error_description || j.error || r.status}`, r.status);
  return j.access_token;
}

export async function gsc(token, path, body, method) {
  const r = await fetch(path.startsWith("https://") ? path : `https://www.googleapis.com/webmasters/v3${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GscError(j.error?.message || `GSC error ${r.status}`, r.status);
  return j;
}

export async function storeConnection({ orgId, userId, email, refreshToken, scope }) {
  await db.query(
    `INSERT INTO google_connections (org_id, user_id, google_email, refresh_token_enc, scope) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), google_email=VALUES(google_email), refresh_token_enc=VALUES(refresh_token_enc), scope=VALUES(scope)`,
    [orgId, userId, email, encrypt(refreshToken), scope || SCOPES]);
}

/** Revoke at Google and delete everything that came from Google for this org. */
export async function disconnect(orgId) {
  const row = await one("SELECT refresh_token_enc FROM google_connections WHERE org_id=?", [orgId]);
  if (row) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(row.refresh_token_enc) }), signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
  await db.query("DELETE FROM google_connections WHERE org_id=?", [orgId]);
  await db.query("DELETE FROM gsc_daily WHERE org_id=?", [orgId]);
  await db.query("DELETE i FROM index_status i JOIN sites s ON s.id=i.site_id WHERE s.org_id=?", [orgId]);
  await db.query("UPDATE sites SET gsc_property=NULL, gsc_last_sync=NULL, gsc_sync_error=NULL WHERE org_id=?", [orgId]);
}

/** Pull search analytics rows (date, query, page) into gsc_daily. Returns row count. Throws GscError (retryable on 429/5xx). */
export async function syncSite(site, days = 90) {
  const token = await accessToken(site.org_id);
  const start = daysAgo(days), end = daysAgo(2);
  let startRow = 0, total = 0;
  for (;;) {
    const j = await gsc(token, `/sites/${encodeURIComponent(site.gsc_property)}/searchAnalytics/query`, {
      startDate: start, endDate: end, dimensions: ["date", "query", "page"], rowLimit: 25000, startRow, dataState: "final",
    });
    const rows = j.rows || [];
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => {
        const [date, query, page] = r.keys;
        const hash = crypto.createHash("md5").update(`${site.id}|${date}|${query}|${page}`).digest("hex");
        return [site.org_id, site.id, date, query.slice(0, 500), page.slice(0, 1000), r.clicks, r.impressions, r.ctr, r.position, hash];
      });
      await db.query(
        `INSERT INTO gsc_daily (org_id,site_id,date,query,page,clicks,impressions,ctr,position,row_hash) VALUES ?
         ON DUPLICATE KEY UPDATE clicks=VALUES(clicks), impressions=VALUES(impressions), ctr=VALUES(ctr), position=VALUES(position)`, [chunk]);
    }
    total += rows.length;
    if (rows.length < 25000 || total >= 500000) break;
    startRow += 25000;
  }
  await db.query("UPDATE sites SET gsc_last_sync=NOW(), gsc_sync_error=NULL WHERE id=?", [site.id]);
  return total;
}

export async function syncSafe(site, days) {
  try {
    return await syncSite(site, days);
  } catch (e) {
    await db.query("UPDATE sites SET gsc_sync_error=? WHERE id=?", [String(e.message).slice(0, 500), site.id]);
    throw e;
  }
}
