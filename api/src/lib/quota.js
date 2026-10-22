// Plan limits + monthly usage with atomic reservations.
// reserve() succeeds only if used + reserved + n <= limit, in a single UPDATE (row-locked by MySQL).
import { db, json, one } from "../db.js";

export const period = (d = new Date()) => d.toISOString().slice(0, 7);
export const METRICS = ["crawl_pages", "ai_ops"];

export async function freePlan() {
  const p = await one("SELECT * FROM plans WHERE code='free'");
  return { ...p, limits_json: json(p?.limits_json) || {} };
}

/** Effective plan for an org. Cancelled / expired-grace subscriptions fall back to the free plan. */
export async function planFor(orgId) {
  const row = await one(
    `SELECT s.status, s.period_end, s.grace_until, s.cancel_at, p.id plan_id, p.code, p.name, p.limits_json
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.org_id=?`, [orgId]);
  if (!row) {
    const f = await freePlan();
    return { code: "free", name: f.name, limits: f.limits_json, status: "none" };
  }
  const now = Date.now();
  const graceOver = row.grace_until && new Date(row.grace_until).getTime() < now;
  const degraded = row.status === "cancelled" || (row.status === "past_due" && graceOver);
  if (degraded && row.code !== "free") {
    const f = await freePlan();
    return { code: "free", name: f.name, limits: f.limits_json, status: row.status, degraded_from: row.code };
  }
  return { code: row.code, name: row.name, limits: json(row.limits_json) || {}, status: row.status, period_end: row.period_end };
}

export async function currentUsage(orgId, p = period()) {
  const rows = await db.query("SELECT metric, used, reserved FROM usage_monthly WHERE org_id=? AND period=?", [orgId, p]).then((r) => r[0]);
  const out = {};
  for (const m of METRICS) out[m] = { used: 0, reserved: 0 };
  for (const r of rows) out[r.metric] = { used: r.used, reserved: r.reserved };
  return out;
}

/** Returns { ok, limit, used, reserved, period } ; ok=false means quota exceeded (nothing reserved). */
export async function reserve(orgId, metric, n, p = period()) {
  const plan = await planFor(orgId);
  const limit = plan.limits[metric];
  if (limit == null) return { ok: true, limit: null, period: p, unlimited: true };
  await db.query("INSERT IGNORE INTO usage_monthly (org_id, period, metric) VALUES (?,?,?)", [orgId, p, metric]);
  const [r] = await db.query(
    `UPDATE usage_monthly SET reserved = reserved + ?
     WHERE org_id=? AND period=? AND metric=? AND used + reserved + ? <= ?`,
    [n, orgId, p, metric, n, limit]);
  const cur = await one("SELECT used, reserved FROM usage_monthly WHERE org_id=? AND period=? AND metric=?", [orgId, p, metric]);
  return { ok: r.affectedRows === 1, limit, used: cur.used, reserved: cur.reserved, period: p, plan: plan.code };
}

/** Convert a reservation into real usage: used += actual, reserved -= reserved. */
export async function settle(orgId, metric, reserved, actual, p = period()) {
  await db.query("INSERT IGNORE INTO usage_monthly (org_id, period, metric) VALUES (?,?,?)", [orgId, p, metric]);
  await db.query(
    `UPDATE usage_monthly SET used = used + ?, reserved = GREATEST(0, CAST(reserved AS SIGNED) - ?)
     WHERE org_id=? AND period=? AND metric=?`,
    [Math.max(0, actual | 0), Math.max(0, reserved | 0), orgId, p, metric]);
}

export const release = (orgId, metric, reserved, p) => settle(orgId, metric, reserved, 0, p);

/** Non-monthly limit: number of active sites. */
export async function canAddSite(orgId) {
  const plan = await planFor(orgId);
  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM sites WHERE org_id=?", [orgId]);
  const limit = plan.limits.sites ?? null;
  return { ok: limit == null || n < limit, count: n, limit, plan: plan.code };
}

export async function featureEnabled(orgId, feature) {
  const plan = await planFor(orgId);
  return Boolean(plan.limits[feature]);
}
