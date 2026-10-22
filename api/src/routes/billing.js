// Plans, subscription, usage and verified webhooks. Provider "test" activates plans without a gateway.
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { db, json, one } from "../db.js";
import { audit, auditSystem } from "../lib/audit.js";
import { log } from "../lib/logger.js";
import { currentUsage, planFor } from "../lib/quota.js";
import { auth, requireRole, wrap } from "../middleware/auth.js";

const monthFromNow = () => new Date(Date.now() + 30 * 86400000);

async function applyPlan(orgId, planCode, { provider = "test", providerId = null, status = "active", periodEnd = monthFromNow() } = {}) {
  const plan = await one("SELECT id, code FROM plans WHERE code=? AND active=1", [planCode]);
  if (!plan) throw new Error(`unknown plan ${planCode}`);
  await db.query(
    `INSERT INTO subscriptions (org_id, plan_id, status, provider, provider_id, period_start, period_end, cancel_at, grace_until)
     VALUES (?,?,?,?,?,NOW(),?,NULL,NULL)
     ON DUPLICATE KEY UPDATE plan_id=VALUES(plan_id), status=VALUES(status), provider=VALUES(provider), provider_id=VALUES(provider_id),
       period_start=NOW(), period_end=VALUES(period_end), cancel_at=NULL, grace_until=NULL`,
    [orgId, plan.id, status, provider, providerId, periodEnd]);
  await db.query("UPDATE orgs SET plan=? WHERE id=?", [plan.code, orgId]);
}

/** Verified webhook event -> subscription state. Returns a short description. */
export async function applyEvent(ev) {
  const orgId = Number(ev.org_id);
  if (!orgId) throw new Error("event has no org_id");
  switch (ev.type) {
    case "subscription.activated":
    case "subscription.renewed":
      await applyPlan(orgId, ev.plan_code, { provider: ev.provider, providerId: ev.subscription_id || null, periodEnd: ev.period_end ? new Date(ev.period_end) : monthFromNow() });
      return `plan ${ev.plan_code} active`;
    case "subscription.payment_failed":
      await db.query("UPDATE subscriptions SET status='past_due', grace_until=DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE org_id=?", [orgId]);
      return "past_due with 7-day grace";
    case "subscription.cancelled":
      await db.query("UPDATE subscriptions SET status='cancelled', cancel_at=NOW() WHERE org_id=?", [orgId]);
      await db.query("UPDATE orgs SET plan='free' WHERE id=?", [orgId]);
      return "cancelled";
    default:
      return `ignored ${ev.type}`;
  }
}

export function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(signature).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const eventSchema = z.object({
  id: z.string().min(1).max(120), type: z.string().min(1).max(60), org_id: z.coerce.number().int().positive(),
  plan_code: z.string().max(30).optional(), subscription_id: z.string().max(100).optional(), period_end: z.string().optional(),
});

/** Mounted with express.raw() in app.js (before the JSON parser). */
export async function webhookHandler(req, res) {
  const provider = req.params.provider;
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifySignature(raw, req.headers["x-webhook-signature"], config.BILLING_WEBHOOK_SECRET)) {
    log.warn("webhook rejected: bad signature", { provider });
    return res.status(401).json({ error: "invalid signature" });
  }
  let ev;
  try { ev = eventSchema.parse(JSON.parse(raw.toString("utf8"))); } catch (e) { return res.status(400).json({ error: "invalid event" }); }
  const [ins] = await db.query("INSERT IGNORE INTO payment_events (provider, provider_event_id, event_type, org_id, payload_json) VALUES (?,?,?,?,?)",
    [provider, ev.id, ev.type, ev.org_id, raw.toString("utf8").slice(0, 60000)]);
  if (!ins.affectedRows) return res.json({ ok: true, duplicate: true });
  try {
    const outcome = await applyEvent({ ...ev, provider });
    await db.query("UPDATE payment_events SET processed_at=NOW() WHERE provider=? AND provider_event_id=?", [provider, ev.id]);
    await auditSystem(ev.org_id, "billing.event", { entity: "payment_event", entityId: ev.id, meta: { type: ev.type, outcome } });
    res.json({ ok: true, outcome });
  } catch (e) {
    log.error("webhook apply failed", { err: e, provider, event: ev.id });
    // leave processed_at NULL so the provider's retry (same id) is still deduped but visible as unprocessed
    res.status(500).json({ error: "could not apply event" });
  }
}

export function billingRoutes(app) {
  app.get("/plans", wrap(async (_req, res) => {
    const [rows] = await db.query("SELECT code, name, price_paise, currency, `interval`, limits_json FROM plans WHERE active=1 ORDER BY price_paise");
    res.json(rows.map((r) => ({ ...r, limits: json(r.limits_json), limits_json: undefined })));
  }));

  app.get("/billing", auth, wrap(async (req, res) => {
    const plan = await planFor(req.org.id);
    const sub = await one("SELECT status, provider, period_start, period_end, cancel_at, grace_until FROM subscriptions WHERE org_id=?", [req.org.id]);
    const usage = await currentUsage(req.org.id);
    const [[sites]] = await db.query("SELECT COUNT(*) n FROM sites WHERE org_id=?", [req.org.id]);
    const [events] = await db.query("SELECT provider, provider_event_id, event_type, processed_at, created_at FROM payment_events WHERE org_id=? ORDER BY id DESC LIMIT 20", [req.org.id]);
    res.json({ plan, subscription: sub, usage: { ...usage, sites: { used: sites.n, limit: plan.limits.sites ?? null } }, provider: config.BILLING_PROVIDER, events });
  }));

  // Test-mode plan change (owner). A real gateway would redirect to checkout and activate via webhook instead.
  app.post("/billing/change-plan", auth, requireRole("owner"), wrap(async (req, res) => {
    const b = z.object({ plan_code: z.string().min(1).max(30) }).parse(req.body);
    if (config.BILLING_PROVIDER !== "test") return res.status(400).json({ error: "plan changes go through the payment gateway checkout" });
    const plan = await one("SELECT code FROM plans WHERE code=? AND active=1", [b.plan_code]);
    if (!plan) return res.status(404).json({ error: "unknown plan" });
    const evId = `test-${crypto.randomUUID()}`;
    await db.query("INSERT INTO payment_events (provider, provider_event_id, event_type, org_id, payload_json, processed_at) VALUES ('test',?,?,?,?,NOW())",
      [evId, "subscription.activated", req.org.id, JSON.stringify({ plan_code: plan.code, by: req.user.id })]);
    await applyPlan(req.org.id, plan.code, { provider: "test", providerId: evId });
    await audit(req, "billing.change_plan", { entity: "org", entityId: req.org.id, meta: { plan: plan.code } });
    res.json({ ok: true, plan: await planFor(req.org.id) });
  }));
}
