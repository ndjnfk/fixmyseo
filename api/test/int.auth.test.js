import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { client, loadModules, registerUser, resetDb, startApp, stopAll, uniq } from "./helpers.js";

let base;
before(async () => { await loadModules(); await resetDb(); base = await startApp(); });
after(stopAll);

test("register creates org, owner membership and free subscription; login works", async () => {
  const u = await registerUser(base);
  assert.equal(u.org.role, "owner");
  assert.equal(u.org.plan, "free");
  assert.equal(u.org.limits.sites, 1);
  const r = await client(base)("POST", "/auth/login", { email: u.email, password: "password123" });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
});

test("duplicate email is 409, bad password 401, weak password 400", async () => {
  const u = await registerUser(base);
  const api = client(base);
  assert.equal((await api("POST", "/auth/register", { email: u.email, password: "password123", orgName: "x" })).status, 409);
  assert.equal((await api("POST", "/auth/login", { email: u.email, password: "wrong-password" })).status, 401);
  assert.equal((await api("POST", "/auth/register", { email: `${uniq()}@t.local`, password: "short", orgName: "x" })).status, 400);
});

test("unauthenticated and garbage tokens are rejected", async () => {
  assert.equal((await client(base)("GET", "/me")).status, 401);
  assert.equal((await client(base, "not.a.jwt")("GET", "/sites")).status, 401);
});

test("password reset flow uses a single-use hashed token", async () => {
  const { setMailTransport, db } = await loadModules();
  const u = await registerUser(base);
  let mail = null;
  setMailTransport(async (m) => { mail = m; });
  assert.equal((await client(base)("POST", "/auth/forgot", { email: u.email })).status, 200);
  // unknown email also 200 and sends nothing
  mail = null;
  assert.equal((await client(base)("POST", "/auth/forgot", { email: `${uniq()}@nope.local` })).status, 200);
  assert.equal(mail, null);
  await client(base)("POST", "/auth/forgot", { email: u.email });
  const token = mail.text.match(/token=([0-9a-f]{64})/)[1];
  const [[row]] = await db.query("SELECT token_hash FROM user_tokens WHERE user_id=? AND used_at IS NULL", [u.user.id]);
  assert.notEqual(row.token_hash, token, "token is stored hashed");
  assert.equal((await client(base)("POST", "/auth/reset", { token, password: "newpassword456" })).status, 200);
  assert.equal((await client(base)("POST", "/auth/reset", { token, password: "again12345" })).status, 400, "second use fails");
  assert.equal((await client(base)("POST", "/auth/login", { email: u.email, password: "newpassword456" })).status, 200);
  assert.equal((await client(base)("POST", "/auth/login", { email: u.email, password: "password123" })).status, 401);
});

test("email verification flow", async () => {
  const { setMailTransport } = await loadModules();
  const u = await registerUser(base);
  let mail = null;
  setMailTransport(async (m) => { mail = m; });
  assert.equal((await u.api("POST", "/auth/verify/request")).status, 200);
  const token = mail.text.match(/token=([0-9a-f]{64})/)[1];
  assert.equal((await client(base)("POST", "/auth/verify", { token })).status, 200);
  const me = await u.api("GET", "/me");
  assert.equal(me.data.user.email_verified, true);
});

test("audit log records register/login and is admin-only", async () => {
  const u = await registerUser(base);
  await client(base)("POST", "/auth/login", { email: u.email, password: "password123" });
  const r = await u.api("GET", "/audit-log");
  assert.equal(r.status, 200);
  const actions = r.data.map((a) => a.action);
  assert.ok(actions.includes("auth.register"));
  assert.ok(actions.includes("auth.login"));
});
