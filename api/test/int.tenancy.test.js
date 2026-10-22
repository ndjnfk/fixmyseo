// Cross-tenant isolation and role enforcement. User B must never see or touch user A's data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { client, loadModules, registerUser, resetDb, startApp, stopAll } from "./helpers.js";

let base, A, B, siteA;
before(async () => {
  await loadModules(); await resetDb(); base = await startApp();
  A = await registerUser(base);
  B = await registerUser(base);
  const r = await A.api("POST", "/sites", { url: "example.com" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  siteA = r.data.id;
});
after(stopAll);

test("B cannot read, patch, delete or audit A's site (404, no existence leak)", async () => {
  assert.equal((await B.api("GET", `/sites/${siteA}`)).status, 404);
  assert.equal((await B.api("GET", `/sites/${siteA}/pages`)).status, 404);
  assert.equal((await B.api("PATCH", `/sites/${siteA}`, { status: "paused" })).status, 404);
  assert.equal((await B.api("DELETE", `/sites/${siteA}`)).status, 404);
  assert.equal((await B.api("POST", `/sites/${siteA}/audit`, {})).status, 404);
  assert.equal((await B.api("GET", `/sites/${siteA}/reports`)).status, 404);
  assert.equal((await B.api("GET", `/sites/${siteA}/suggestions`)).status, 404);
  assert.equal((await B.api("POST", `/sites/${siteA}/ai/titles`, { url: "https://example.com/" })).status, 404);
  const list = await B.api("GET", "/sites");
  assert.equal(list.data.length, 0);
});

test("X-Org-Id cannot be used to switch into a foreign org", async () => {
  const r = await client(base, B.token, { "x-org-id": String(A.org.id) })("GET", "/sites");
  assert.equal(r.status, 403);
});

test("members: viewer is read-only, editor can run audits, admin manages members, owner is immutable", async () => {
  const { db } = await loadModules();
  const viewer = await registerUser(base);
  const editor = await registerUser(base);
  // A (owner) adds them to A's org
  assert.equal((await A.api("POST", "/org/members", { email: viewer.email, role: "viewer" })).status, 201);
  assert.equal((await A.api("POST", "/org/members", { email: editor.email, role: "editor" })).status, 201);
  const asViewer = client(base, viewer.token, { "x-org-id": String(A.org.id) });
  const asEditor = client(base, editor.token, { "x-org-id": String(A.org.id) });

  assert.equal((await asViewer("GET", `/sites/${siteA}`)).status, 200);
  assert.equal((await asViewer("POST", `/sites/${siteA}/audit`, {})).status, 403);
  assert.equal((await asViewer("POST", "/sites", { url: "other.example" })).status, 403);
  assert.equal((await asViewer("GET", "/org/members")).status, 403);

  assert.equal((await asEditor("POST", "/sites", { url: "other.example" })).status, 403);
  assert.equal((await asEditor("GET", "/org/members")).status, 403);
  // editor may start an audit: free plan allows 1 site / 100 pages; queue add is attempted -> 202 or 503 if redis is down
  const audit = await asEditor("POST", `/sites/${siteA}/audit`, { max_pages: 5 });
  assert.ok([202, 503].includes(audit.status), JSON.stringify(audit.data));

  assert.equal((await A.api("PATCH", `/org/members/${A.user.id}`, { role: "viewer" })).status, 400);
  assert.equal((await A.api("DELETE", `/org/members/${A.user.id}`)).status, 400);
  assert.equal((await A.api("PATCH", `/org/members/${viewer.user.id}`, { role: "admin" })).status, 200);
  assert.equal((await A.api("DELETE", `/org/members/${editor.user.id}`)).status, 200);
  assert.equal((await asEditor("GET", "/sites")).status, 403, "removed member loses access");
  const [[m]] = await db.query("SELECT role FROM org_members WHERE org_id=? AND user_id=?", [A.org.id, viewer.user.id]);
  assert.equal(m.role, "admin");
});

test("free plan: second site is refused with 402", async () => {
  const r = await A.api("POST", "/sites", { url: "http://1.1.1.1" });
  assert.equal(r.status, 402);
  assert.equal(r.data.metric, "sites");
});

test("private / internal hosts are refused when adding a site", async () => {
  const C = await registerUser(base);
  // helpers set ALLOW_PRIVATE_HOSTS=1 for the crawler fixture, so shape checks still apply:
  assert.equal((await C.api("POST", "/sites", { url: "ftp://example.com" })).status, 400);
  assert.equal((await C.api("POST", "/sites", { url: "http://user:pw@example.com" })).status, 400);
});
