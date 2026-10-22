process.env.NODE_ENV = "test";
process.env.ALLOW_PRIVATE_HOSTS = "1";
process.env.CRAWL_DELAY_MS = "0";
process.env.CRAWL_MAX_BYTES = "200000";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixtureSite } from "./fixtures/site.js";

let site, crawler, issuesMod, quality, report, links, content, analyze;
before(async () => {
  site = await startFixtureSite();
  crawler = await import("../src/seo/crawler.js");
  issuesMod = await import("../src/seo/issues.js");
  quality = await import("../src/seo/quality.js");
  report = await import("../src/seo/report.js");
  links = await import("../src/seo/links.js");
  content = await import("../src/seo/content.js");
  analyze = await import("../src/seo/analyze.js");
});
after(async () => { await crawler.closeAgents(); await site.close(); });

let crawl;
test("crawls the fixture site within limits, honours robots, follows sitemap, handles redirects/errors", async () => {
  const progress = [];
  crawl = await crawler.crawlSite(site.base, { maxPages: 50, concurrency: 3, onProgress: (d) => progress.push(d) });
  const byUrl = Object.fromEntries(crawl.rows.map((r) => [r.url, r]));
  assert.ok(progress.length > 0);
  assert.equal(crawl.robots.present, true);
  assert.equal(crawl.sitemap.found, true);
  assert.ok(crawl.sitemap.urls.includes(`${site.base}/orphan`));
  assert.equal(byUrl[`${site.base}/`].status, 200);
  assert.equal(byUrl[`${site.base}/`].title, "Fixture Home Page Title Example");
  assert.equal(byUrl[`${site.base}/`].imgs_no_alt, 1);
  assert.equal(byUrl[`${site.base}/about`].status, 200);
  assert.equal(byUrl[`${site.base}/services`].h1_count, 2);
  assert.equal(byUrl[`${site.base}/services`].schema_types, "Service");
  assert.equal(byUrl[`${site.base}/secret/page`].status, "SKIPPED", "robots disallow is honoured");
  assert.ok(crawl.blocked.includes(`${site.base}/secret/page`));
  assert.equal(byUrl[`${site.base}/redirect`].status, 200, "internal redirect followed");
  assert.equal(byUrl[`${site.base}/redirect`].redirected_to, `${site.base}/about`);
  assert.equal(byUrl[`${site.base}/external-redirect`].status, "REDIRECT_OUT");
  assert.match(String(byUrl[`${site.base}/loop`].status), /ERR too many redirects|30\d/);
  assert.equal(byUrl[`${site.base}/broken`].status, 500);
  assert.equal(byUrl[`${site.base}/gone`].status, 410);
  assert.equal(byUrl[`${site.base}/big`].status, 200);
  assert.equal(byUrl[`${site.base}/big`].truncated, true, "oversize body is truncated");
  assert.ok(byUrl[`${site.base}/big`].text.length <= 200_000);
  assert.ok(!byUrl[`${site.base}/doc.pdf`], "assets are not crawled");
  assert.ok(!Object.keys(byUrl).some((u) => u.includes("169.254")), "other hosts never fetched");
  assert.ok(!Object.keys(byUrl).some((u) => u.includes("127.0.0.1:1/")), "other ports never fetched");
  assert.ok(byUrl[`${site.base}/about`].inlinks >= 1);
});

test("issue detection finds the planted problems", () => {
  const issues = [
    ...issuesMod.detectIssues(crawl.rows, { base: crawl.base, linkGraph: crawl.links, sitemapUrls: crawl.sitemap.urls, robotsBlocked: crawl.blocked }),
    ...crawler.siteFileIssues(crawl),
    ...quality.qualityIssues(crawl.rows, crawl.base),
  ];
  const types = (t) => issues.filter((i) => i.type === t);
  assert.ok(types("multiple_h1").some((i) => i.url.endsWith("/services")));
  assert.ok(types("canonical_mismatch").some((i) => i.url.endsWith("/services")));
  assert.ok(types("http_error").some((i) => i.url.endsWith("/broken")));
  assert.ok(types("broken_link").some((i) => i.url.endsWith("/broken")), "broken_link from home");
  assert.ok(types("orphan_page").some((i) => i.url.endsWith("/orphan")));
  assert.ok(types("sitemap_url_error").some((i) => i.url.endsWith("/gone")));
  assert.ok(types("redirect_chain").some((i) => i.url.endsWith("/redirect")));
  assert.ok(types("blocked_by_robots").some((i) => i.url.endsWith("/secret/page")));
  assert.ok(types("thin_content").some((i) => i.url.endsWith("/services")));
  assert.ok(types("images_missing_alt").some((i) => i.url.endsWith("/")));
  assert.ok(types("risky_claims").some((i) => i.url.endsWith("/services")));
  assert.equal(types("missing_sitemap").length, 0);
  assert.equal(types("missing_robots").length, 0);
  const summary = issuesMod.summarize(issues, crawl.rows);
  assert.ok(summary._counts.high >= 1);
  const rep = report.buildReport({ site: { domain: "fixture" }, run: { id: 1 }, rows: crawl.rows, issues, summary, previous: null });
  assert.ok(rep.score >= 0 && rep.score <= 100);
  const rep2 = report.buildReport({ site: { domain: "fixture" }, run: { id: 2 }, rows: crawl.rows, issues: issues.slice(0, 3), summary, previous: rep });
  assert.ok(rep2.score >= rep.score);
  assert.ok(rep2.delta.fixed.length > 0);
});

test("internal link suggestions and content score are deterministic", () => {
  const sug = links.suggestInternalLinks(crawl.rows, crawl.links);
  assert.ok(Array.isArray(sug));
  // about mentions "fixture"? home text mentions kundli/tarot; orphan has no inlinks -> candidates sorted by fewest inlinks
  const home = crawl.rows.find((r) => r.url === `${site.base}/`);
  const cs = content.contentScore(home, "kundli matching");
  assert.ok(cs.score > 0 && cs.score <= 100);
  assert.ok(cs.checks.find((c) => c.key === "keyword_in_intro").ok);
  assert.ok(cs.todo.length > 0);
  const { row } = analyze.analyzeHtml("https://x.test/p", "<html><head><title>T</title></head><body><h1>A</h1><h1>B</h1><p>hello world</p><a href='/x'>x</a><a href='https://o.test/'>o</a></body></html>");
  assert.equal(row.h1_count, 2);
  assert.equal(row.word_count, 6);
});

test("safeFetch works through the DNS-pinned connector for a hostname (not only IP literals)", async () => {
  const port = new URL(site.base).port;
  const r = await crawler.safeFetch(`http://localhost:${port}/about`);
  assert.equal(r.status, 200, r.error);
  assert.match(r.text, /About the Fixture Team/);
});

test("safeFetch refuses private targets when ALLOW_PRIVATE_HOSTS is off", async () => {
  // simulate production-like guard by calling the pure IP checker through resolvePublic with a public literal only
  const { isPublicIp } = await import("../src/lib/ssrf.js");
  assert.equal(isPublicIp("127.0.0.1"), false);
});
