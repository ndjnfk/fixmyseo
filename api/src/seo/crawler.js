// Bounded, polite, SSRF-safe crawler. Ported from legacy audit.py::crawl and hardened:
// manual redirects with per-hop validation, DNS pinning, robots.txt, size/time limits, concurrency, progress callback.
import { setTimeout as sleep } from "node:timers/promises";
import { Agent, fetch as undiciFetch } from "undici";
import robotsParser from "robots-parser";
import { config } from "../config.js";
import { assertUrlShape, resolvePublic, SsrfError } from "../lib/ssrf.js";
import { normalizeUrl, originOf, sameSite, SKIP_EXT } from "../lib/url.js";
import { analyzeHtml, emptyRow } from "./analyze.js";

const agents = new Map();

/** One undici Agent per host whose connections are pinned to a validated IP (defeats DNS rebinding). */
async function agentFor(hostname) {
  const key = hostname.toLowerCase();
  if (agents.has(key)) return agents.get(key);
  const addrs = await resolvePublic(key);
  const pinned = addrs[0];
  const agent = new Agent({
    connect: {
      timeout: config.CRAWL_TIMEOUT_MS,
      // net.connect may ask for all addresses (happy eyeballs) or a single one; answer both shapes with the pinned IP
      lookup: (_host, opts, cb) => (opts?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)),
    },
    bodyTimeout: config.CRAWL_TIMEOUT_MS, headersTimeout: config.CRAWL_TIMEOUT_MS, maxRedirections: 0,
  });
  agents.set(key, agent);
  return agent;
}

export async function closeAgents() {
  for (const a of agents.values()) await a.close().catch(() => {});
  agents.clear();
}

async function readBounded(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks = [];
  let total = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { truncated = true; chunks.push(value.subarray(0, value.byteLength - (total - maxBytes))); await reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

/**
 * Fetch with manual redirect handling. Every hop is SSRF-validated. Returns
 * { status, finalUrl, headers, text, hops, elapsed, error, redirectedOut }.
 */
export async function safeFetch(url, { method = "GET", maxHops = 5, maxBytes = config.CRAWL_MAX_BYTES, timeoutMs = config.CRAWL_TIMEOUT_MS, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", mustSameSite = null } = {}) {
  const start = Date.now();
  let cur = url, hops = 0;
  for (;;) {
    const u = assertUrlShape(cur);
    const agent = await agentFor(u.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await undiciFetch(u.href, {
        method, dispatcher: agent, redirect: "manual", signal: ctrl.signal,
        headers: { "user-agent": config.CRAWL_USER_AGENT, accept, "accept-language": "en,hi;q=0.8" },
      });
    } catch (e) {
      clearTimeout(timer);
      return { status: 0, finalUrl: cur, text: "", hops, elapsed: (Date.now() - start) / 1000, error: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.code || e.message) };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => {});
      const next = normalizeUrl(res.headers.get("location"), cur);
      hops++;
      if (!next || hops > maxHops) return { status: res.status, finalUrl: cur, text: "", hops, elapsed: (Date.now() - start) / 1000, error: "too many redirects" };
      if (mustSameSite && !sameSite(next, mustSameSite)) return { status: res.status, finalUrl: next, text: "", hops, elapsed: (Date.now() - start) / 1000, redirectedOut: true };
      cur = next;
      continue;
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let body = { text: "", truncated: false };
    if (method === "GET" && res.status === 200 && (/(html|xml|text\/plain)/.test(ct) || !ct)) {
      const len = Number(res.headers.get("content-length") || 0);
      if (len > maxBytes) { await res.body?.cancel().catch(() => {}); body = { text: "", truncated: true }; }
      else body = await readBounded(res, maxBytes);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    clearTimeout(timer);
    return { status: res.status, finalUrl: cur, headers: res.headers, contentType: ct, text: body.text, truncated: body.truncated, hops, elapsed: (Date.now() - start) / 1000 };
  }
}

async function loadRobots(base) {
  const r = await safeFetch(`${base}/robots.txt`, { accept: "text/plain,*/*" }).catch(() => null);
  const present = r && r.status === 200;
  const txt = present ? r.text : "";
  return { present, text: txt, parser: robotsParser(`${base}/robots.txt`, present ? txt : ""), sitemaps: [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) };
}

async function sitemapUrls(base, robots, limit = 2000) {
  const out = [], seen = new Set();
  const todo = [...robots.sitemaps, `${base}/sitemap.xml`, `${base}/sitemap_index.xml`];
  let found = false;
  while (todo.length && seen.size < 25 && out.length < limit) {
    const sm = todo.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    if (!sameSite(sm, base)) continue;
    const r = await safeFetch(sm, { accept: "application/xml,text/xml,*/*" }).catch(() => null);
    if (!r || r.status !== 200 || !r.text) continue;
    found = true;
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    if (/<sitemapindex/i.test(r.text)) { todo.push(...locs); continue; }
    for (const l of locs) { const n = normalizeUrl(l); if (n && sameSite(n, base)) out.push(n); }
  }
  return { urls: [...new Set(out)].slice(0, limit), found };
}

/**
 * Crawl a site. opts: { maxPages, concurrency, onProgress(done,total), delayMs }
 * Returns { rows, links, sitemap: {urls, found}, robots: {present, text}, blocked: [urls], base }
 */
export async function crawlSite(startUrl, opts = {}) {
  const maxPages = Math.min(opts.maxPages || config.CRAWL_MAX_PAGES_DEFAULT, config.CRAWL_HARD_MAX_PAGES);
  const concurrency = opts.concurrency || config.CRAWL_CONCURRENCY;
  const delayMs = opts.delayMs ?? config.CRAWL_DELAY_MS;
  const start = normalizeUrl(startUrl);
  if (!start) throw new SsrfError("invalid start url");
  assertUrlShape(start);
  await resolvePublic(new URL(start).hostname);
  const base = originOf(start);

  const robots = await loadRobots(base);
  const sitemap = await sitemapUrls(base, robots);
  const seen = new Set([start]);
  const queue = [start];
  for (const u of sitemap.urls) if (!seen.has(u) && !SKIP_EXT.test(u)) { seen.add(u); queue.push(u); }

  const rows = [], links = [], blocked = [];
  let active = 0, idx = 0;
  const ua = config.CRAWL_USER_AGENT.split(" ")[0];

  const visit = async (url) => {
    if (!robots.parser.isAllowed(url, ua) && !robots.parser.isAllowed(url, "*")) {
      blocked.push(url);
      rows.push({ ...emptyRow(url), status: "SKIPPED" });
      return;
    }
    const r = await safeFetch(url, { mustSameSite: base });
    const row = emptyRow(url);
    row.time_s = +r.elapsed.toFixed(2);
    if (r.error) { row.status = `ERR ${r.error}`; rows.push(row); return; }
    if (r.redirectedOut) { row.status = "REDIRECT_OUT"; row.redirected_to = r.finalUrl; rows.push(row); return; }
    row.status = r.status;
    if (r.hops > 0) row.redirected_to = r.finalUrl;
    if (r.status !== 200 || !/html/.test(r.contentType || "")) { rows.push(row); return; }
    const { row: parsed, links: found } = analyzeHtml(url, r.text, { finalUrl: r.finalUrl });
    Object.assign(row, parsed, { url, status: 200, truncated: Boolean(r.truncated) });
    rows.push(row);
    for (const l of found) {
      if (!l.internal) continue;
      links.push({ from_url: url, to_url: l.url, anchor: l.anchor, nofollow: l.nofollow });
      if (!l.asset && !l.nofollow && !seen.has(l.url) && seen.size < maxPages * 3) { seen.add(l.url); queue.push(l.url); }
    }
  };

  await new Promise((resolve) => {
    const pump = () => {
      while (active < concurrency && idx < queue.length && rows.length + active < maxPages) {
        const url = queue[idx++];
        active++;
        visit(url).catch((e) => rows.push({ ...emptyRow(url), status: `ERR ${e.code || e.message}` })).finally(async () => {
          active--;
          opts.onProgress?.(rows.length, Math.min(maxPages, queue.length));
          if (delayMs) await sleep(delayMs);
          pump();
        });
      }
      if (active === 0 && (idx >= queue.length || rows.length >= maxPages)) resolve();
    };
    pump();
  });

  // inlink counts (unique sources)
  const sources = new Map();
  for (const l of links) { if (!sources.has(l.to_url)) sources.set(l.to_url, new Set()); sources.get(l.to_url).add(l.from_url); }
  for (const r of rows) r.inlinks = sources.get(r.url)?.size || 0;
  const internalOut = new Map();
  for (const l of links) internalOut.set(l.from_url, (internalOut.get(l.from_url) || 0) + 1);
  for (const r of rows) r.internal_links_out = internalOut.get(r.url) || 0;

  return { rows, links, sitemap, robots: { present: robots.present, text: robots.text, hasSitemapLine: /sitemap:/i.test(robots.text) }, blocked, base, truncated: idx < queue.length };
}

export function siteFileIssues(crawl) {
  const out = [];
  if (!crawl.sitemap.found) out.push({ type: "missing_sitemap", severity: "high", url: `${crawl.base}/sitemap.xml`, detail: "sitemap.xml not found" });
  if (!crawl.robots.present) out.push({ type: "missing_robots", severity: "med", url: `${crawl.base}/robots.txt`, detail: "robots.txt not found" });
  else if (!crawl.robots.hasSitemapLine) out.push({ type: "robots_no_sitemap", severity: "low", url: `${crawl.base}/robots.txt`, detail: "robots.txt has no Sitemap: line" });
  return out;
}
