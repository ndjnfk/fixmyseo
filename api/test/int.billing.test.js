// Webhook signature verification and idempotent event processing.
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.BILLING_WEBHOOK_SECRET = "test-webhook-secret";
import { client, loadModules, registerUser, resetDb, startApp, stopAll } from "./helpers.js";

let base, A, m;
before(async () => { m = await loadModules(); await resetDb(); base = await startApp(); A = await registerUser(base); });
after(stopAll);

const sign = (body) => crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex");
const post = (body, sig) => client(base)("POST", "/billing/webhook/testgw", Buffer.from(body), { headers: { "content-type": "application/json", ...(sig ? { "x-webhook-signature": sig } : {}) } });

test("rejects missing or wrong signature", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "subscription.activated", org_id: A.org.id, plan_code: "starter" });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, "deadbeef")).status, 401);
  assert.equal((await post(body, sign(body + " "))).status, 401);
});

test("valid event activates plan; duplicate is acknowledged but not re-applied", async () => {
  const body = JSON.stringify({ id: "evt_2", type: "subscription.activated", org_id: A.org.id, plan_code: "starter", subscription_id: "sub_x" });
  const r1 = await post(body, sign(body));
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.duplicate, undefined);
  assert.equal((await m.planFor(A.org.id)).code, "starter");
  // cancel, then replay the activation: must be ignored as duplicate
  const cancel = JSON.stringify({ id: "evt_3", type: "subscription.cancelled", org_id: A.org.id });
  assert.equal((await post(cancel, sign(cancel))).status, 200);
  assert.equal((await m.planFor(A.org.id)).code, "free");
  const r2 = await post(body, sign(body));
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);
  assert.equal((await m.planFor(A.org.id)).code, "free", "replayed event did not re-activate");
  const [[n]] = await m.db.query("SELECT COUNT(*) n FROM payment_events WHERE provider='testgw'");
  assert.equal(n.n, 2);
});

test("payment_failed sets past_due with grace; renewal restores", async () => {
  const fail = JSON.stringify({ id: "evt_4", type: "subscription.payment_failed", org_id: A.org.id });
  const act = JSON.stringify({ id: "evt_5", type: "subscription.activated", org_id: A.org.id, plan_code: "pro" });
  await post(act, sign(act));
  await post(fail, sign(fail));
  const [[s]] = await m.db.query("SELECT status, grace_until FROM subscriptions WHERE org_id=?", [A.org.id]);
  assert.equal(s.status, "past_due");
  assert.ok(s.grace_until);
  assert.equal((await m.planFor(A.org.id)).code, "pro", "still pro during grace");
  const renew = JSON.stringify({ id: "evt_6", type: "subscription.renewed", org_id: A.org.id, plan_code: "pro" });
  await post(renew, sign(renew));
  const [[s2]] = await m.db.query("SELECT status, grace_until FROM subscriptions WHERE org_id=?", [A.org.id]);
  assert.equal(s2.status, "active");
  assert.equal(s2.grace_until, null);
  const b = await A.api("GET", "/billing");
  assert.equal(b.data.plan.code, "pro");
  assert.ok(b.data.events.length >= 3);
});

test("malformed event body is 400 (after signature check)", async () => {
  const body = "{not json";
  assert.equal((await post(body, sign(body))).status, 400);
});
