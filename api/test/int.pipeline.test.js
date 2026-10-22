// End-to-end through the API + worker handlers (called in-process): audit a fixture site -> issues, report, links,
// content score -> AI suggestions via a mock Ollama -> approval workflow -> history and audit log.
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.CRAWL_DELAY_MS = "0";
process.env.CRAWL_MAX_BYTES = "200000";
import { client, loadModules, registerUser, resetDb, startApp, stopAll } from "./helpers.js";
import { startFixtureSite } from "./fixtures/site.js";

let base, A, m, site, mock, siteId, crawlHandlers, aiHandlers;
const ctx = { progress: async () => {}, log: { info() {}, warn() {}, error() {} } };

function startMockOllama() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ models: [{ name: "qwen2.5:1.5b" }] })); }
      const j = JSON.parse(body);
      calls.push(j);
      const prompt = j.messages.at(-1).content;
      let out;
      if (/Write 3 title options/.test(prompt)) out = { titles: ["Fixture Home: Kundli Matching and Tarot Reading", "Kundli Matching & Tarot Reading Online | Fixture", "Free Kundli Matching and Tarot by Fixture"], descriptions: ["Get kundli matching and tarot reading guidance from the Fixture team. Learn how it works, what you need and how to book a reading today.", "Fixture offers kundli matching and tarot reading with clear, honest guidance. See what to expect and start with our free tools online.", "Explore kundli matching and tarot reading at Fixture. Simple steps, honest answers and tools you can use right now from home."] };
      else if (/Write 4-6 FAQs/.test(prompt)) out = { faqs: [{ question: "What is kundli matching?", answer: "It compares two birth charts to assess compatibility, as described on the page." }, { question: "Do I need my birth time?", answer: "Yes, the page explains that date, time and place of birth are needed." }] };
      else if (/content brief/.test(prompt)) out = { title: "Kundli Matching Explained", intent: "informational", target_words: 1200, outline: [{ heading: "What is kundli matching", points: ["definition", "history"] }, { heading: "How it works", points: ["36 gunas"] }, { heading: "Common doshas", points: ["manglik"] }, { heading: "FAQs", points: [] }], faqs: [{ question: "How many gunas are needed?", answer: "Traditionally 18 or more is considered acceptable." }], internal_links: [`${site.base}/about`], human_input_needed: ["Real client examples"] };
      else if (/Explain this issue/.test(prompt)) out = { explanation: "A page without a meta description has no summary for Google.", why_it_matters: "Google may write its own snippet, lowering clicks.", steps: ["Open the page template", "Add a meta description tag", "Keep it under 160 characters"] };
      else if (/Keyword clusters/.test(prompt)) out = { clusters: [{ id: 1, name: "Kundli matching", intent: "informational" }] };
      else out = { garbage: true };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ model: "qwen2.5:1.5b", message: { role: "assistant", content: JSON.stringify(out) }, prompt_eval_count: 100, eval_count: 50, done_reason: "stop" }));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) })));
}

before(async () => {
  site = await startFixtureSite();
  mock = await startMockOllama();
  process.env.OLLAMA_URL = mock.url;
  m = await loadModules();
  await resetDb();
  base = await startApp();
  A = await registerUser(base);
  await A.api("POST", "/billing/change-plan", { plan_code: "pro" });
  ({ crawlHandlers } = await import("../src/workers/crawl.js"));
  ({ aiHandlers } = await import("../src/workers/ai.js"));
});
after(async () => { await stopAll(); await mock.close(); await site.close(); const c = await import("../src/seo/crawler.js"); await c.closeAgents(); });

test("audit: enqueue -> worker -> pages, issues, report, history, quota settled", async () => {
  const s = await A.api("POST", "/sites", { url: site.base });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  siteId = s.data.id;
  const a = await A.api("POST", `/sites/${siteId}/audit`, { max_pages: 40 });
  assert.equal(a.status, 202, JSON.stringify(a.data));
  assert.equal((await A.api("POST", `/sites/${siteId}/audit`, {})).status, 409, "one active run per site");
  const job = await m.getJob(a.data.job_id);
  const result = await crawlHandlers.audit(job.payload_json ? { ...job.payload_json, jobId: job.id, orgId: job.org_id, siteId: job.site_id } : job, ctx);
  assert.ok(result.pages >= 8, `pages ${result.pages}`);
  assert.ok(result.issues > 5);
  // re-running the same job is idempotent (no duplicate rows)
  await crawlHandlers.audit({ ...job.payload_json, jobId: job.id, orgId: job.org_id, siteId: job.site_id }, ctx);
  const [[pc]] = await m.db.query("SELECT COUNT(*) n FROM pages WHERE run_id=?", [a.data.run_id]);
  assert.equal(pc.n, result.pages);

  const d = await A.api("GET", `/sites/${siteId}`);
  assert.equal(d.data.runs[0].status, "done");
  assert.ok(d.data.report.score >= 0);
  assert.ok(d.data.summary.length > 0);
  const issues = await A.api("GET", `/sites/${siteId}/issues?severity=high`);
  assert.ok(issues.data.total > 0);
  assert.ok(issues.data.items.every((i) => i.severity === "high"));
  const reps = await A.api("GET", `/sites/${siteId}/reports`);
  assert.equal(reps.data.length, 1);
  const rep = await A.api("GET", `/sites/${siteId}/reports/${reps.data[0].id}`);
  assert.equal(rep.data.report.pages, result.pages);
  assert.equal(rep.data.report.delta, null);
  const usage = await A.api("GET", "/billing");
  assert.equal(usage.data.usage.crawl_pages.used, result.pages);
  assert.equal(usage.data.usage.crawl_pages.reserved, 0);
  const pages = await A.api("GET", `/sites/${siteId}/pages`);
  assert.ok(pages.data.some((p) => p.url === `${site.base}/`));
  const links = await A.api("GET", `/sites/${siteId}/links`);
  assert.equal(links.data.run_id, a.data.run_id);
  const cs = await A.api("GET", `/sites/${siteId}/content?url=${encodeURIComponent(site.base + "/")}&keyword=kundli%20matching`);
  assert.equal(cs.status, 200, JSON.stringify(cs.data));
  assert.ok(cs.data.score > 0);
  const recs = await A.api("GET", `/sites/${siteId}/recommendations`);
  assert.equal(recs.data.ready, true);
  assert.ok(recs.data.items.length > 0);
});

test("second audit produces a report with deltas; failed job releases quota", async () => {
  const a = await A.api("POST", `/sites/${siteId}/audit`, { max_pages: 40 });
  assert.equal(a.status, 202);
  const job = await m.getJob(a.data.job_id);
  await crawlHandlers.audit({ ...job.payload_json, jobId: job.id, orgId: job.org_id, siteId: job.site_id }, ctx);
  const reps = await A.api("GET", `/sites/${siteId}/reports`);
  assert.equal(reps.data.length, 2);
  const rep = await A.api("GET", `/sites/${siteId}/reports/${reps.data[0].id}`);
  assert.ok(rep.data.report.delta);
  assert.equal(rep.data.report.delta.previous_run_id, reps.data[1].run_id);

  const before = (await A.api("GET", "/billing")).data.usage.crawl_pages;
  const f = await A.api("POST", `/sites/${siteId}/audit`, { max_pages: 10 });
  const fj = await m.getJob(f.data.job_id);
  await crawlHandlers["audit:failed"]({ ...fj.payload_json, jobId: fj.id, orgId: fj.org_id, siteId: fj.site_id }, new Error("boom"));
  const run = await A.api("GET", `/runs/${f.data.run_id}`);
  assert.equal(run.data.status, "failed");
  const after = (await A.api("GET", "/billing")).data.usage.crawl_pages;
  assert.equal(after.reserved, before.reserved);
  assert.equal(after.used, before.used);
});

test("AI tasks via mock Ollama create suggestions that require approval", async () => {
  const t = await A.api("POST", `/sites/${siteId}/ai/titles`, { url: `${site.base}/`, keyword: "kundli matching" });
  assert.equal(t.status, 202, JSON.stringify(t.data));
  const job = await m.getJob(t.data.job_id);
  const out = await aiHandlers.task({ ...job.payload_json, jobId: job.id, orgId: job.org_id, siteId: job.site_id }, ctx);
  assert.equal(out.suggestions, 1);
  assert.equal(out.model, "qwen2.5:1.5b");

  const f = await A.api("POST", `/sites/${siteId}/ai/faq`, { url: `${site.base}/about` });
  const fj = await m.getJob(f.data.job_id);
  await aiHandlers.task({ ...fj.payload_json, jobId: fj.id, orgId: fj.org_id, siteId: fj.site_id }, ctx);
  const b = await A.api("POST", `/sites/${siteId}/ai/brief`, { keyword: "kundli matching" });
  const bj = await m.getJob(b.data.job_id);
  await aiHandlers.task({ ...bj.payload_json, jobId: bj.id, orgId: bj.org_id, siteId: bj.site_id }, ctx);
  const e = await A.api("POST", `/sites/${siteId}/ai/explain`, { issue_type: "missing_meta_description" });
  const ej = await m.getJob(e.data.job_id);
  const eo = await aiHandlers.task({ ...ej.payload_json, jobId: ej.id, orgId: ej.org_id, siteId: ej.site_id }, ctx);
  assert.equal(eo.suggestions, 0);

  const jobs = await A.api("GET", `/sites/${siteId}/ai/jobs`);
  assert.equal(jobs.data.filter((j) => j.status === "done").length, 4);
  assert.ok(jobs.data.every((j) => j.status !== "done" || (j.prompt_version && j.duration_ms != null)));
  const explain = jobs.data.find((j) => j.task === "explain");
  assert.ok(explain.output.steps.length >= 3);

  const sug = await A.api("GET", `/sites/${siteId}/suggestions?status=proposed`);
  assert.equal(sug.data.length, 3);
  const tm = sug.data.find((s) => s.type === "title_meta");
  assert.equal(tm.payload.titles.length, 3);
  assert.equal(tm.payload.current.title, "Fixture Home Page Title Example");
  assert.equal((await A.api("POST", `/suggestions/${tm.id}/apply`)).status, 409, "cannot apply before approval");
  assert.equal((await A.api("POST", `/suggestions/${tm.id}/approve`, { note: "looks good" })).status, 200);
  assert.equal((await A.api("POST", `/suggestions/${tm.id}/approve`)).status, 409);
  assert.equal((await A.api("POST", `/suggestions/${tm.id}/apply`)).status, 200);
  const faq = sug.data.find((s) => s.type === "faq");
  assert.equal((await A.api("POST", `/suggestions/${faq.id}/reject`)).status, 200);
  const usage = await A.api("GET", "/billing");
  assert.equal(usage.data.usage.ai_ops.used, 4);
  // another tenant cannot touch the suggestion
  const B = await registerUser(base);
  assert.equal((await B.api("POST", `/suggestions/${tm.id}/approve`)).status, 404);
  const log = await A.api("GET", "/audit-log?limit=200");
  const actions = new Set(log.data.map((l) => l.action));
  for (const a of ["audit.start", "audit.done", "ai.task.start", "ai.task.done", "suggestion.approve", "suggestion.apply", "suggestion.reject", "billing.change_plan"]) assert.ok(actions.has(a), a);
});

test("invalid model output fails the job and releases the AI quota", async () => {
  const before = (await A.api("GET", "/billing")).data.usage.ai_ops;
  const c = await A.api("POST", `/sites/${siteId}/ai/cluster-names`, {});
  assert.equal(c.status, 202);
  const cj = await m.getJob(c.data.job_id);
  // no clusters exist -> AI_NOTHING_TO_DO -> handler throws -> failure hook releases
  await assert.rejects(aiHandlers.task({ ...cj.payload_json, jobId: cj.id, orgId: cj.org_id, siteId: cj.site_id }, ctx));
  await aiHandlers["task:failed"]({ ...cj.payload_json, jobId: cj.id, orgId: cj.org_id, siteId: cj.site_id }, new Error("x"));
  const after = (await A.api("GET", "/billing")).data.usage.ai_ops;
  assert.equal(after.used, before.used);
  assert.equal(after.reserved, before.reserved);
  const jobs = await A.api("GET", `/sites/${siteId}/ai/jobs`);
  assert.equal(jobs.data[0].status, "failed");
});

test("keywords: manual add, clusters, research job enqueued; AI disabled mode returns 503", async () => {
  process.env.AUTOCOMPLETE_ENABLED = "0";
  const add = await A.api("POST", `/sites/${siteId}/keywords`, { terms: "kundli matching, kundli matching online, tarot reading, tarot reading online, free kundli" });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal(add.data.added, 5);
  const list = await A.api("GET", `/sites/${siteId}/keywords`);
  assert.equal(list.data.length, 5);
  assert.ok(list.data.every((k) => k.source === "manual" && k.priority >= 1));
  const cl = await A.api("POST", `/sites/${siteId}/keywords/cluster`);
  assert.equal(cl.status, 200);
  assert.ok(cl.data.clusters >= 2 && cl.data.clusters <= 4, `clusters ${cl.data.clusters}`);
  const got = await A.api("GET", `/sites/${siteId}/keywords/clusters`);
  assert.equal(got.data.length, cl.data.clusters);
  const r = await A.api("POST", `/sites/${siteId}/keywords/research`);
  assert.equal(r.status, 202);
  const r2 = await A.api("POST", `/sites/${siteId}/keywords/research`);
  assert.equal(r2.data.duplicate, true, "same key while queued -> duplicate");

  const { aiHealth } = await import("../src/ai/ollama.js");
  await mock.close();
  const h = await aiHealth(true);
  assert.equal(h.ok, false);
  const t = await A.api("POST", `/sites/${siteId}/ai/titles`, { url: `${site.base}/` });
  assert.equal(t.status, 503);
  assert.equal(t.data.error, "ai_disabled");
  mock.close = async () => {};
});
