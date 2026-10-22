// Shared test harness: test database, app on a random port, tiny HTTP client, fixture users.
process.env.NODE_ENV ??= "test";
process.env.DB_NAME = process.env.TEST_DB_NAME || "seo_test";
process.env.ALLOW_PRIVATE_HOSTS ??= "1";
process.env.LOG_LEVEL ??= "warn";
process.env.AI_ENABLED ??= "1";

import crypto from "node:crypto";

export const uniq = (p = "u") => `${p}${crypto.randomBytes(4).toString("hex")}`;

let _app = null, _server = null, _base = null, mods = null;

export async function loadModules() {
  if (mods) return mods;
  const { migrate } = await import("../src/db/migrate.js");
  await migrate({ quiet: true });
  const dbm = await import("../src/db.js");
  const app = await import("../src/app.js");
  const queue = await import("../src/lib/queue.js");
  const quota = await import("../src/lib/quota.js");
  const mailer = await import("../src/lib/mailer.js");
  mods = { ...dbm, ...app, ...queue, ...quota, ...mailer };
  return mods;
}

/** Empty every tenant table (plans + schema_migrations stay). */
export async function resetDb() {
  const { db } = await loadModules();
  const [rows] = await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  await db.query("SET FOREIGN_KEY_CHECKS=0");
  for (const { t } of rows) {
    if (["plans", "schema_migrations"].includes(t)) continue;
    await db.query(`TRUNCATE TABLE \`${t}\``);
  }
  await db.query("SET FOREIGN_KEY_CHECKS=1");
  await mods.flushQueues().catch(() => {});
}

export async function startApp() {
  const { createApp } = await loadModules();
  if (_server) return _base;
  _app = createApp();
  await new Promise((ok) => { _server = _app.listen(0, "127.0.0.1", ok); });
  _base = `http://127.0.0.1:${_server.address().port}`;
  return _base;
}

export async function stopAll() {
  if (_server) await new Promise((ok) => _server.close(ok));
  _server = null;
  if (mods) {
    await mods.closeQueues().catch(() => {});
    await mods.closeDb().catch(() => {});
  }
  mods = null;
}

export function client(base, token, headers = {}) {
  return async (method, path, body, extra = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Buffer) ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, ...(extra.headers || {}),
      },
      body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

export async function registerUser(base, overrides = {}) {
  const email = overrides.email || `${uniq()}@test.local`;
  const api = client(base);
  const r = await api("POST", "/auth/register", { email, password: "password123", orgName: overrides.orgName || "Org " + email, ...overrides });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  const me = await client(base, r.data.token)("GET", "/me");
  return { email, token: r.data.token, api: client(base, r.data.token), org: me.data.org, user: me.data.user };
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
