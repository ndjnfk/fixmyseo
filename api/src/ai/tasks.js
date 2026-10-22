// Task context (from DB) and output persistence (suggestions needing approval). Used by workers/ai.js.
import { z } from "zod";
import { db, json } from "../db.js";
import { normalizeUrl, pathOf } from "../lib/url.js";
import { ISSUE_META } from "../seo/issues.js";
import { AiError } from "./ollama.js";
import { TASKS } from "./prompts.js";

export const INPUT_SCHEMAS = {
  titles: z.object({ url: z.string().url().max(1000), keyword: z.string().max(120).optional() }),
  brief: z.object({ keyword: z.string().trim().min(2).max(120), url: z.string().url().max(1000).optional() }),
  faq: z.object({ url: z.string().url().max(1000) }),
  "cluster-names": z.object({}).default({}),
  explain: z.object({ issue_type: z.string().min(2).max(60) }),
};

async function latestRunId(siteId) {
  const [[r]] = await db.query("SELECT MAX(id) id FROM crawl_runs WHERE site_id=? AND status='done'", [siteId]);
  return r?.id || null;
}

async function pageFor(site, url) {
  const runId = await latestRunId(site.id);
  if (!runId) throw new AiError("run an audit first so the page content is available", "AI_NO_AUDIT");
  const n = normalizeUrl(url) || url;
  const [[p]] = await db.query(
    "SELECT url, title, meta_description, h1, h2s_json, text_excerpt, inlinks FROM pages WHERE run_id=? AND site_id=? AND url IN (?, ?) AND status='200' LIMIT 1",
    [runId, site.id, n, url]);
  if (!p) throw new AiError("page not found in the latest audit (is it crawlable and on this site?)", "AI_PAGE_NOT_FOUND");
  return { ...p, h2s: json(p.h2s_json) || [] };
}

async function queriesFor(site, { page, like } = {}) {
  if (!site.gsc_property) return [];
  const [rows] = await db.query(
    `SELECT query, SUM(impressions) impr, ROUND(SUM(position*impressions)/GREATEST(SUM(impressions),1),1) pos
     FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) ${page ? "AND page=?" : ""} ${like ? "AND query LIKE ?" : ""}
     GROUP BY query ORDER BY impr DESC LIMIT 10`, [site.id, ...(page ? [page] : []), ...(like ? [`%${like}%`] : [])]);
  return rows.map((r) => `${r.query} (impressions ${r.impr}, position ${r.pos})`);
}

/** Build the prompt input for a task. Returns { promptInput, meta } */
export async function prepareTask(task, site, input) {
  const t = TASKS[task];
  if (!t) throw new AiError(`unknown task ${task}`, "AI_BAD_TASK");
  const cfg = json(site.config_json) || {};
  const notes = cfg.content?.notes || "";
  switch (task) {
    case "titles": {
      const p = await pageFor(site, input.url);
      return { promptInput: { domain: site.domain, url: p.url, title: p.title, meta: p.meta_description, h1: p.h1, h2s: p.h2s, text: p.text_excerpt, keyword: input.keyword, queries: await queriesFor(site, { page: p.url }) }, meta: { page_url: p.url, current: { title: p.title, meta: p.meta_description } } };
    }
    case "faq": {
      const p = await pageFor(site, input.url);
      return { promptInput: { domain: site.domain, url: p.url, h1: p.h1, text: p.text_excerpt }, meta: { page_url: p.url } };
    }
    case "brief": {
      const runId = await latestRunId(site.id);
      const [pages] = runId ? await db.query("SELECT url, title FROM pages WHERE run_id=? AND status='200' ORDER BY inlinks DESC LIMIT 20", [runId]) : [[]];
      const [related] = await db.query(
        `SELECT term FROM keywords WHERE site_id=? AND status<>'ignored' AND (cluster=(SELECT cluster FROM keywords WHERE site_id=? AND term=? LIMIT 1) OR term LIKE ?) LIMIT 12`,
        [site.id, site.id, input.keyword.toLowerCase(), `%${input.keyword.toLowerCase().split(" ")[0]}%`]);
      let h1 = "";
      if (input.url) { try { h1 = (await pageFor(site, input.url)).h1; } catch { /* new page */ } }
      return {
        promptInput: { domain: site.domain, notes, keyword: input.keyword, url: input.url, h1, related: related.map((r) => r.term), pages: pages.map((p) => `${p.url} | ${p.title || ""}`), queries: await queriesFor(site, { like: input.keyword.split(" ")[0] }) },
        meta: { page_url: input.url || null, keyword: input.keyword },
      };
    }
    case "cluster-names": {
      const [clusters] = await db.query("SELECT id, terms_json FROM keyword_clusters WHERE site_id=? AND ai_name IS NULL ORDER BY size DESC LIMIT 25", [site.id]);
      if (!clusters.length) throw new AiError("no unnamed clusters; build clusters first (Keywords -> Clusters)", "AI_NOTHING_TO_DO");
      return { promptInput: { domain: site.domain, clusters: clusters.map((c) => ({ id: c.id, terms: (json(c.terms_json) || []).slice(0, 12) })) }, meta: { cluster_ids: clusters.map((c) => c.id) } };
    }
    case "explain": {
      const m = ISSUE_META[input.issue_type];
      if (!m) throw new AiError("unknown issue type", "AI_BAD_INPUT");
      const runId = await latestRunId(site.id);
      const [ex] = runId ? await db.query("SELECT url, detail FROM issues WHERE run_id=? AND type=? LIMIT 5", [runId, input.issue_type]) : [[]];
      const [[cnt]] = runId ? await db.query("SELECT COUNT(*) n FROM issues WHERE run_id=? AND type=?", [runId, input.issue_type]) : [[{ n: 0 }]];
      return { promptInput: { issue_type: input.issue_type, title: m.title, how: m.how, count: cnt.n, examples: ex.map((e) => `${e.url} ${e.detail || ""}`), framework: site.framework }, meta: { issue_type: input.issue_type } };
    }
    default:
      throw new AiError(`unknown task ${task}`, "AI_BAD_TASK");
  }
}

/** Persist validated output: create suggestions (proposed) or update tables. Returns { suggestions: n } */
export async function persistOutput(task, site, aiJob, output, meta, conn = db) {
  const mk = async (type, title, pageUrl, payload) => {
    await conn.query(
      "INSERT INTO suggestions (org_id, site_id, page_url, type, source, title, payload_json, status, ai_job_id, created_by) VALUES (?,?,?,?,'ai',?,?,'proposed',?,?)",
      [site.org_id, site.id, pageUrl, type, title.slice(0, 255), JSON.stringify(payload), aiJob.id, aiJob.created_by]);
  };
  switch (task) {
    case "titles":
      await mk("title_meta", `Title & meta for ${pathOf(meta.page_url) || "/"}`, meta.page_url, { ...output, current: meta.current, keyword: aiJob.input?.keyword || null });
      return { suggestions: 1 };
    case "faq":
      await mk("faq", `FAQ for ${pathOf(meta.page_url) || "/"}`, meta.page_url, output);
      return { suggestions: 1 };
    case "brief":
      await mk("content_brief", `Brief: ${output.title}`, meta.page_url, { ...output, keyword: meta.keyword });
      return { suggestions: 1 };
    case "cluster-names": {
      let n = 0;
      for (const c of output.clusters) {
        if (!meta.cluster_ids.includes(c.id)) continue;
        const [r] = await conn.query("UPDATE keyword_clusters SET ai_name=?, intent=COALESCE(intent, ?) WHERE id=? AND site_id=?", [c.name.slice(0, 255), c.intent.slice(0, 30), c.id, site.id]);
        n += r.affectedRows;
      }
      return { suggestions: 0, clusters_named: n };
    }
    case "explain":
      return { suggestions: 0 };
    default:
      return { suggestions: 0 };
  }
}
