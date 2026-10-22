process.env.NODE_ENV = "test";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, AiError } from "../src/ai/ollama.js";
import { TASKS, clip } from "../src/ai/prompts.js";
import { clusterKeywords, Ctx } from "../src/seo/keywords.js";

test("extractJson tolerates fences and prose", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here it is: {"a":[1,2]} hope that helps'), { a: [1, 2] });
  assert.throws(() => extractJson("no json here"), AiError);
  assert.throws(() => extractJson('{"a":'), AiError);
});

test("prompts clip inputs and validators reject bad shapes", () => {
  const big = "x".repeat(50_000);
  assert.ok(clip(big).length <= 6000);
  const p = TASKS.titles.build({ domain: "d", url: "u", title: big, meta: big, h1: big, h2s: [big], text: big });
  assert.ok(p.length < 12_000);
  assert.equal(TASKS.titles.validate.safeParse({ titles: [], descriptions: ["x"] }).success, false);
  assert.equal(TASKS.titles.validate.safeParse({ titles: ["A good enough title"], descriptions: ["A good enough description"] }).success, true);
  assert.equal(TASKS.brief.validate.safeParse({ title: "t", intent: "nope" }).success, false);
  assert.equal(TASKS.explain.validate.safeParse({ explanation: "x", why_it_matters: "y", steps: [] }).success, false);
  for (const t of Object.values(TASKS)) { assert.ok(t.version); assert.ok(t.schema.type === "object"); }
  // the prompts never ask for metrics the model cannot know
  for (const t of Object.values(TASKS)) assert.doesNotMatch(t.build({ domain: "d", clusters: [{ id: 1, terms: ["a"] }], h2s: [], examples: [], related: [], pages: [] }), /search volume|backlinks|monthly searches/i);
});

test("deterministic keyword clustering groups by token overlap and maps to pages", () => {
  const kws = [
    { term: "kundli matching", priority: 9 }, { term: "kundli matching online", priority: 8 }, { term: "free kundli matching", priority: 7 },
    { term: "tarot reading", priority: 8 }, { term: "tarot reading online", priority: 6 },
    { term: "vastu tips for home", priority: 5 },
  ];
  const pages = [{ url: "https://x.test/matching", title: "Kundli Matching Online", h1: "Kundli Matching" }, { url: "https://x.test/tarot", title: "Tarot Reading", h1: "Tarot" }];
  const c = clusterKeywords(kws, pages);
  assert.equal(c.length, 3);
  const kund = c.find((x) => x.terms.includes("kundli matching"));
  assert.equal(kund.size, 3);
  assert.equal(kund.target_url, "https://x.test/matching");
  const tarot = c.find((x) => x.terms.includes("tarot reading"));
  assert.equal(tarot.target_url, "https://x.test/tarot");
  assert.equal(c.find((x) => x.terms.includes("vastu tips for home")).target_url, null);
});

test("keyword scoring: GSC demand is real, autocomplete is estimated, brand is navigational", () => {
  const ctx = new Ctx({
    domain: "vidushiji.com", pages: [{ url: "https://vidushiji.com/kundli", title: "Free Kundli", h1: "Kundli" }],
    gscQueries: [{ query: "free kundli", impressions: 900, clicks: 40, position: 6.2, top_page: "https://vidushiji.com/kundli" }],
    seeds: ["kundli"],
  });
  const real = ctx.score("free kundli");
  assert.equal(real.demand_src, "gsc");
  assert.ok(real.demand >= 70);
  assert.equal(real.status, "existing");
  assert.equal(real.target_url, "https://vidushiji.com/kundli");
  assert.ok(real.priority >= 6, `priority ${real.priority}`);
  ctx.observe("kundli milan online", 0, true);
  const est = ctx.score("kundli milan online");
  assert.equal(est.demand_src, "est");
  const brand = ctx.score("vidushiji login");
  assert.equal(brand.intent, "navigational");
  assert.ok(brand.priority < real.priority);
  assert.equal(ctx.score("how to read kundli").intent, "informational");
  assert.equal(ctx.score("buy kundli report").intent, "transactional");
});
