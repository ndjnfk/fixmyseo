// Crawl worker: audit a site, store pages/links/issues, build the report, settle quota.
import { db, one, tx } from "../db.js";
import { auditSystem } from "../lib/audit.js";
import { release, settle } from "../lib/quota.js";
import { crawlSite, siteFileIssues } from "../seo/crawler.js";
import { detectIssues, summarize } from "../seo/issues.js";
import { qualityIssues, siteStats } from "../seo/quality.js";
import { saveAuditReport } from "../seo/report.js";

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export const crawlHandlers = {
  async audit(data, ctx) {
    const { orgId, siteId, runId, maxPages, reserved, period } = data;
    const site = await one("SELECT * FROM sites WHERE id=?", [siteId]);
    if (!site || site.org_id !== orgId) throw new Error("tenant mismatch: site does not belong to job org");
    const run = await one("SELECT * FROM crawl_runs WHERE id=? AND site_id=?", [runId, siteId]);
    if (!run) throw new Error("run not found");
    if (run.status === "done") return { skipped: "already done" };
    await db.query("UPDATE crawl_runs SET status='running', started_at=NOW(), error=NULL WHERE id=?", [runId]);

    const crawl = await crawlSite(site.url, {
      maxPages, onProgress: (done, total) => ctx.progress(5 + 85 * (done / Math.max(total, 1))),
    });
    const { rows, links } = crawl;
    const issues = [
      ...detectIssues(rows, { base: crawl.base, linkGraph: links, sitemapUrls: crawl.sitemap.urls, robotsBlocked: crawl.blocked }),
      ...siteFileIssues(crawl),
      ...qualityIssues(rows, crawl.base),
    ];
    const summary = summarize(issues, rows);
    summary._site = siteStats(rows);
    summary._crawl = { sitemap_found: crawl.sitemap.found, sitemap_urls: crawl.sitemap.urls.length, robots: crawl.robots.present, blocked: crawl.blocked.length, truncated: crawl.truncated };
    await ctx.progress(92);

    let report;
    await tx(async (conn) => {
      // idempotent on retry: wipe anything a previous attempt stored for this run
      await conn.query("DELETE FROM pages WHERE run_id=?", [runId]);
      await conn.query("DELETE FROM issues WHERE run_id=?", [runId]);
      await conn.query("DELETE FROM page_links WHERE run_id=?", [runId]);
      await conn.query("DELETE FROM reports WHERE run_id=?", [runId]);
      for (const part of chunk(rows, 200)) {
        await conn.query(
          `INSERT INTO pages (org_id,site_id,run_id,url,status,title,meta_description,h1,h1_count,canonical,robots_meta,lang,schema_types,word_count,
             response_time_s,inlinks,imgs_no_alt,content_hash,signals_json,text_excerpt,h2s_json,internal_links_out,redirected_to) VALUES ?`,
          [part.map((p) => [site.org_id, site.id, runId, p.url.slice(0, 1000), String(p.status).slice(0, 20), (p.title || "").slice(0, 500), p.meta_desc || null,
            (p.h1 || "").slice(0, 500), p.h1_count ?? null, (p.canonical || "").slice(0, 1000) || null, (p.robots_meta || "").slice(0, 100) || null,
            (p.lang || "").slice(0, 20) || null, (p.schema_types || "").slice(0, 500) || null, p.word_count ?? null, p.time_s ?? null, p.inlinks ?? 0,
            p.imgs_no_alt ?? null, p.content_hash || null, JSON.stringify(p.signals || {}), p.text ? p.text.slice(0, 20000) : null,
            JSON.stringify(p.h2s || []), p.internal_links_out ?? null, p.redirected_to ? p.redirected_to.slice(0, 1000) : null])]);
      }
      for (const part of chunk(links.slice(0, 50000), 500)) {
        await conn.query("INSERT INTO page_links (org_id,site_id,run_id,from_url,to_url,anchor,nofollow) VALUES ?",
          [part.map((l) => [site.org_id, site.id, runId, l.from_url.slice(0, 1000), l.to_url.slice(0, 1000), (l.anchor || "").slice(0, 255) || null, l.nofollow ? 1 : 0])]);
      }
      for (const part of chunk(issues, 500)) {
        await conn.query("INSERT INTO issues (org_id,site_id,run_id,type,severity,url,detail) VALUES ?",
          [part.map((i) => [site.org_id, site.id, runId, i.type, i.severity, (i.url || "").slice(0, 1000) || null, (i.detail || "").slice(0, 500) || null])]);
      }
      report = await saveAuditReport(conn, { site, run: { id: runId }, rows, issues, summary });
      await conn.query("UPDATE crawl_runs SET status='done', progress=100, pages_crawled=?, summary_json=?, finished_at=NOW() WHERE id=?",
        [rows.length, JSON.stringify(summary), runId]);
    });
    await settle(site.org_id, "crawl_pages", reserved, rows.length, period);
    await auditSystem(site.org_id, "audit.done", { entity: "crawl_run", entityId: runId, meta: { pages: rows.length, issues: issues.length, score: report.score } });
    return { pages: rows.length, issues: issues.length, score: report.score, report_id: report.id };
  },

  async "audit:failed"(data, err) {
    const { orgId, runId, reserved, period } = data;
    await db.query("UPDATE crawl_runs SET status='failed', error=?, finished_at=NOW() WHERE id=? AND status<>'done'", [String(err.message).slice(0, 1000), runId]);
    await release(orgId, "crawl_pages", reserved, period);
    await auditSystem(orgId, "audit.failed", { entity: "crawl_run", entityId: runId, meta: { error: err.message.slice(0, 300) } });
  },
};
