// Atomic quota reservations under concurrency, settle/release, plan fallback.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadModules, registerUser, resetDb, startApp, stopAll } from "./helpers.js";

let base, A, m;
before(async () => { m = await loadModules(); await resetDb(); base = await startApp(); A = await registerUser(base); });
after(stopAll);

test("concurrent reservations never exceed the plan limit", async () => {
  // free plan: crawl_pages = 100. 30 parallel requests of 10 each -> exactly 10 succeed.
  const results = await Promise.all(Array.from({ length: 30 }, () => m.reserve(A.org.id, "crawl_pages", 10)));
  const ok = results.filter((r) => r.ok).length;
  assert.equal(ok, 10);
  const u = await m.currentUsage(A.org.id);
  assert.equal(u.crawl_pages.reserved, 100);
  assert.equal(u.crawl_pages.used, 0);
});

test("settle converts reservation to usage; release frees it", async () => {
  const p = m.period();
  await m.settle(A.org.id, "crawl_pages", 10, 7, p);
  let u = await m.currentUsage(A.org.id);
  assert.equal(u.crawl_pages.reserved, 90);
  assert.equal(u.crawl_pages.used, 7);
  await m.release(A.org.id, "crawl_pages", 90, p);
  u = await m.currentUsage(A.org.id);
  assert.equal(u.crawl_pages.reserved, 0);
  assert.equal(u.crawl_pages.used, 7);
  // 93 left: 94 refused, 93 accepted
  assert.equal((await m.reserve(A.org.id, "crawl_pages", 94)).ok, false);
  assert.equal((await m.reserve(A.org.id, "crawl_pages", 93)).ok, true);
});

test("audit endpoint reserves pages and refuses when the monthly quota is gone", async () => {
  const s = await A.api("POST", "/sites", { url: "http://8.8.8.8" });
  assert.equal(s.status, 201);
  const r = await A.api("POST", `/sites/${s.data.id}/audit`, { max_pages: 50 });
  assert.equal(r.status, 402, JSON.stringify(r.data));
  assert.equal(r.data.metric, "crawl_pages");
});

test("cancelled subscription falls back to free limits; owner can change plan in test mode", async () => {
  const B = await registerUser(base);
  assert.equal((await B.api("POST", "/billing/change-plan", { plan_code: "pro" })).status, 200);
  let plan = await m.planFor(B.org.id);
  assert.equal(plan.code, "pro");
  assert.equal(plan.limits.crawl_pages, 10000);
  await m.db.query("UPDATE subscriptions SET status='cancelled' WHERE org_id=?", [B.org.id]);
  plan = await m.planFor(B.org.id);
  assert.equal(plan.code, "free");
  assert.equal(plan.degraded_from, "pro");
  // past_due inside grace keeps the plan, after grace degrades
  await m.db.query("UPDATE subscriptions SET status='past_due', grace_until=DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE org_id=?", [B.org.id]);
  assert.equal((await m.planFor(B.org.id)).code, "pro");
  await m.db.query("UPDATE subscriptions SET grace_until=DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE org_id=?", [B.org.id]);
  assert.equal((await m.planFor(B.org.id)).code, "free");
  // non-owner cannot change plan
  const viewer = await registerUser(base);
  await B.api("POST", "/org/members", { email: viewer.email, role: "admin" });
  const asAdmin = (await import("./helpers.js")).client(base, viewer.token, { "x-org-id": String(B.org.id) });
  assert.equal((await asAdmin("POST", "/billing/change-plan", { plan_code: "starter" })).status, 403);
});
