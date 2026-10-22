// Keyword research (free data only): seeds -> Google Autocomplete expansion -> scoring (demand estimate, difficulty
// estimate, priority) -> page mapping, plus deterministic clustering. Ported from legacy keywords.py (basic mode).
// Demand is REAL only when it comes from Search Console impressions; otherwise it is an estimate and labelled so.
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config.js";
import { pathOf } from "../lib/url.js";

const AUTOCOMPLETE = "https://suggestqueries.google.com/complete/search";
const STOP = new Set(["the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "by", "is", "are", "your", "my",
  "at", "from", "how", "what", "why", "best", "online", "free", "ka", "ki", "ke", "se", "me", "mein", "hai"]);
const TRANSACTIONAL = new Set(["buy", "price", "cost", "order", "book", "booking", "shop", "purchase", "cheap", "discount", "near"]);
const GENERIC = new Set(["about", "contact", "pricing", "price", "prices", "plans", "plan", "services", "service", "reviews",
  "review", "testimonials", "testimonial", "client", "clients", "customer", "shop", "store", "blog", "blogs", "login", "home",
  "faq", "faqs", "privacy", "policy", "terms", "term", "account", "register", "us", "our", "page", "welcome"]);
const COMMERCIAL = new Set(["best", "top", "vs", "review", "reviews", "compare", "alternative"]);
const QUESTION = new Set(["how", "what", "why", "when", "which", "who", "kya", "kaise", "kyu", "kyon", "kab", "kaun"]);
const MODIFIERS = new Set(["hindi", "english", "india", "indian", "online", "free", "app", "website", "site", "near", "nearby",
  "today", "tomorrow", "2025", "2026", "2027", "pdf", "meaning", "benefit", "list", "idea", "tip", "guide", "beginner", "kid",
  "women", "men", "top", "cheap", "price", "cost", "vs", "review", "example", "software", "tool", "calculator", "chart", "date",
  "birth", "time", "name", "number", "liye", "course", "service", "book", "booking", "telugu", "tamil", "marathi", "bengali",
  "gujarati", "kannada", "malayalam", "punjabi", "urdu", "step", "easy", "simple", "quick", "daily", "weekly", "monthly",
  "yearly", "first", "new", "latest", "download", "kaise", "kya", "karein"]);

const stem = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const tokens = (text) => new Set(((text || "").toLowerCase().match(/[a-z0-9ऀ-ॿ]+/g) || []).filter((w) => !STOP.has(w) && w.length > 1).map(stem));
const words = (t) => new Set((t || "").toLowerCase().match(/[a-zऀ-ॿ]+/g) || []);
const inter = (a, b) => [...a].filter((x) => b.has(x));
const cleanTitle = (t) => (t || "").split(/\s[|\-–—:]\s/)[0].trim();

export async function autocomplete(term, lang = "en", country = "IN") {
  if (!config.AUTOCOMPLETE_ENABLED) return [];
  try {
    const u = new URL(AUTOCOMPLETE);
    u.search = new URLSearchParams({ client: "firefox", q: term, hl: lang, gl: country }).toString();
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data[1] || []).filter((s) => typeof s === "string").slice(0, 10);
  } catch { return []; }
}

function intentOf(term, brand) {
  const w = words(term);
  if (brand && term.toLowerCase().replace(/ /g, "").includes(brand)) return "navigational";
  if (inter(w, TRANSACTIONAL).length) return "transactional";
  if (inter(w, COMMERCIAL).length) return "commercial";
  return "informational";
}

export class Ctx {
  constructor({ domain, language = "en", country = "IN", pages = [], gscQueries = [], notes = "", seeds = [], exclude = [], ignored = [] }) {
    this.language = language; this.country = country;
    this.brand = domain.split(".")[0].toLowerCase();
    this.exclude = exclude.map((e) => e.trim().toLowerCase()).filter(Boolean);
    this.ignored = new Set(ignored.map((t) => t.trim().toLowerCase()));
    this.userSeeds = seeds.map((s) => s.trim().toLowerCase()).filter(Boolean);
    this.pageTok = pages.map((p) => [p.url, tokens(`${p.title || ""} ${p.h1 || ""} ${pathOf(p.url).replace(/-/g, " ")}`)]);
    this.pageTitles = pages.flatMap((p) => [cleanTitle(p.title), p.h1]).filter(Boolean);
    this.gsc = {};
    for (const q of [...gscQueries].sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0))) {
      this.gsc[q.query.toLowerCase()] = { impr: Number(q.impressions || 0), clicks: Number(q.clicks || 0), pos: q.position != null ? Number(q.position) : null, page: q.top_page || null };
    }
    const vocab = new Set();
    for (const [, t] of this.pageTok) for (const w of t) vocab.add(w);
    for (const text of [notes, ...this.userSeeds, ...Object.keys(this.gsc)]) for (const w of tokens(text)) vocab.add(w);
    for (const g of GENERIC) vocab.delete(g);
    this.vocab = vocab;
    this.signals = {};
    this.requests = 0;
  }

  topical(text) { return new Set([...tokens(text)].filter((w) => !GENERIC.has(w) && !this.brand.includes(w))); }

  blocked(term) {
    const t = term.toLowerCase();
    if (this.ignored.has(t)) return true;
    const w = new Set(t.match(/[a-z0-9ऀ-ॿ]+/g) || []);
    return this.exclude.some((e) => (e.includes(" ") ? t.includes(e) : w.has(e)));
  }

  junk(sug, seed) {
    const extra = [...this.topical(sug)].filter((w) => !this.topical(seed).has(w) && !this.vocab.has(w) && !MODIFIERS.has(w));
    return extra.length >= 2;
  }

  observe(term, rank, bare) {
    const s = this.signals[term] ??= { rank: 99, bare: false, hits: 0 };
    s.rank = Math.min(s.rank, rank); s.bare = s.bare || bare; s.hits++;
  }

  async expand(seeds, budget = 80) {
    const pats = ["{}", "{} for", "best {}", "how to {}"];
    if (this.country === "IN" || this.language === "hi") pats.push("{} in hindi");
    const found = {};
    for (const seed of [...new Set(seeds)]) {
      for (let i = 0; i < pats.length; i++) {
        if (this.requests >= budget) return found;
        this.requests++;
        const sugs = await autocomplete(pats[i].replace("{}", seed), this.language, this.country);
        sugs.forEach((raw, rank) => {
          const sug = raw.toLowerCase().trim();
          if (sug.split(" ").length < 2 || this.blocked(sug) || !inter(this.topical(sug), this.topical(seed)).length || this.junk(sug, seed)) return;
          this.observe(sug, rank, i === 0);
          found[sug] ??= seed;
        });
        await sleep(300);
      }
    }
    return found;
  }

  async probe(term) {
    if (this.signals[term]) return;
    const sugs = (await autocomplete(term, this.language, this.country)).map((s) => s.toLowerCase().trim());
    if (sugs.includes(term)) this.observe(term, sugs.indexOf(term), true);
    else if (sugs.length) this.observe(term, 6, false);
    await sleep(300);
  }

  bestPage(term) {
    const t = tokens(term);
    if (!t.size) return [null, 0];
    const cands = this.pageTok.filter(([u]) => { const last = pathOf(u).replace(/^\/|\/$/g, "").split("/").pop() || "home"; return !GENERIC.has(last) || t.has(last); });
    let best = [0, 0, null];
    for (const [u, pt] of cands) {
      const hit = inter(t, pt).length;
      const c = [hit / t.size, hit / Math.max(1, pt.size), u];
      if (c[0] > best[0] || (c[0] === best[0] && c[1] > best[1])) best = c;
    }
    return [best[2], best[0]];
  }

  clusterFor(term, seeds) {
    const t = this.topical(term);
    let best = [0, 0, null];
    for (const s of seeds) { const n = inter(t, this.topical(s)).length; if (n > best[0] || (n === best[0] && -s.length > best[1])) best = [n, -s.length, s]; }
    return best[0] ? best[2] : cleanTitle(term);
  }

  score(term) {
    const g = this.gsc[term], sig = this.signals[term];
    let demand = null, src = null;
    if (sig) {
      demand = sig.bare ? 80 - 6 * sig.rank : 55 - 4 * sig.rank;
      demand = Math.max(5, Math.min(90, demand + Math.min(15, 5 * (sig.hits - 1))));
      src = "est";
    }
    if (g && g.impr > 0) {
      const real = Math.min(100, Math.round(25 * Math.log10(g.impr + 1) + (g.clicks ? 10 : 0)));
      demand = Math.max(demand || 0, real); src = "gsc";
    }
    const ws = words(term);
    let diff = { 1: 85, 2: 65, 3: 45, 4: 35 }[term.split(" ").length] ?? 25;
    if (inter(ws, TRANSACTIONAL).length || inter(ws, COMMERCIAL).length) diff += 10;
    if (inter(ws, QUESTION).length) diff -= 10;
    const pos = g?.pos ?? null;
    if (pos) diff = pos <= 10 ? Math.min(diff, 25) : pos <= 20 ? Math.min(diff, 40) : pos <= 50 ? diff : diff + 5;
    diff = Math.max(5, Math.min(95, diff));
    const top = this.topical(term);
    const rel = top.size ? inter(top, this.vocab).length / top.size : 0;
    const intent = intentOf(term, this.brand);
    let score = 0.4 * (demand ?? 15) + 0.35 * (100 - diff) + 0.25 * rel * 100;
    score -= 12 * [...top].filter((w) => !this.vocab.has(w) && !MODIFIERS.has(w)).length;
    if (pos && pos >= 4 && pos <= 20) score += 15;
    if (intent === "navigational") score -= 25;
    const pri = Math.max(1, Math.min(10, Math.round(score / 10)));
    let target, cov;
    if (g?.page && pos && pos <= 30) { target = g.page; cov = 1; } else [target, cov] = this.bestPage(term);
    const status = target && cov >= 0.75 ? "existing" : target && cov >= 0.5 ? "partial" : "gap";
    return { term: term.slice(0, 255), intent, target_url: status !== "gap" ? target : null, priority: pri, status, demand, demand_src: src, difficulty: diff, position: pos };
  }
}

export async function scoreTerms(ctx, terms) {
  const seeds = [...ctx.userSeeds, ...ctx.pageTitles.map((t) => t.toLowerCase())];
  const out = [];
  for (const term of new Set(terms.map((t) => t.toLowerCase().trim()).filter(Boolean))) {
    if (ctx.ignored.has(term)) continue;
    for (const w of ctx.topical(term)) ctx.vocab.add(w);
    await ctx.probe(term);
    const row = ctx.score(term);
    row.cluster = ctx.clusterFor(term, seeds).slice(0, 255);
    out.push(row);
  }
  return out;
}

export async function basicResearch(ctx, extraTerms = []) {
  const seeds = [...ctx.userSeeds];
  for (const q of Object.keys(ctx.gsc).slice(0, 10)) if (ctx.topical(q).size) seeds.push(q);
  for (let text of ctx.pageTitles) {
    text = text.trim().toLowerCase();
    const n = text.split(" ").length;
    if (n > 1 && n <= 5 && ctx.topical(text).size) seeds.push(text);
  }
  const uniq = [...new Set(seeds)];
  const terms = await ctx.expand(uniq);
  for (const q of Object.keys(ctx.gsc)) terms[q] ??= null;
  let out = [];
  for (const [term, seed] of Object.entries(terms)) {
    if (ctx.blocked(term) || !ctx.topical(term).size) continue;
    const row = ctx.score(term);
    row.cluster = (seed || ctx.clusterFor(term, uniq)).slice(0, 255);
    out.push(row);
  }
  out.sort((a, b) => b.priority - a.priority || (b.demand || 0) - (a.demand || 0));
  out = out.slice(0, 200);
  const have = new Set(out.map((r) => r.term));
  return out.concat(await scoreTerms(ctx, extraTerms.filter((t) => !have.has(t.toLowerCase()))));
}

/**
 * Deterministic clustering by token overlap (greedy, Jaccard >= 0.5 to the cluster's token set).
 * keywords: [{term, intent?, target_url?, priority?, demand?}] ; pages: [{url,title,h1}]
 */
export function clusterKeywords(keywords, pages = [], { minJaccard = 0.4 } = {}) {
  const items = keywords.map((k) => ({ ...k, tok: new Set([...tokens(k.term)].filter((w) => !GENERIC.has(w) && !MODIFIERS.has(w))) }))
    .filter((k) => k.tok.size).sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.demand || 0) - (a.demand || 0));
  const clusters = [];
  for (const k of items) {
    let best = null, bestJ = 0;
    for (const c of clusters) {
      const i = inter(k.tok, c.tok).length;
      const j = i / (k.tok.size + c.tok.size - i);
      const core = inter(k.tok, c.core).length / c.core.size;
      const s = Math.max(j, core);
      if (s > bestJ) { bestJ = s; best = c; }
    }
    if (best && bestJ >= minJaccard) {
      best.terms.push(k); for (const w of k.tok) best.tok.add(w);
    } else {
      clusters.push({ terms: [k], tok: new Set(k.tok), core: new Set(k.tok) });
    }
  }
  const pageTok = pages.map((p) => [p.url, tokens(`${p.title || ""} ${p.h1 || ""} ${pathOf(p.url).replace(/-/g, " ")}`)]);
  return clusters.map((c) => {
    const freq = new Map();
    for (const t of c.terms) for (const w of t.tok) freq.set(w, (freq.get(w) || 0) + 1);
    const name = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w).join(" ");
    const intents = new Map();
    for (const t of c.terms) intents.set(t.intent || "informational", (intents.get(t.intent || "informational") || 0) + 1);
    const intent = [...intents.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let target = c.terms.find((t) => t.target_url)?.target_url || null;
    if (!target && pageTok.length) {
      let best = [0, null];
      for (const [u, pt] of pageTok) { const h = inter(c.core, pt).length / c.core.size; if (h > best[0]) best = [h, u]; }
      if (best[0] >= 0.5) target = best[1];
    }
    return { name: name || c.terms[0].term, intent, target_url: target, size: c.terms.length, terms: c.terms.map((t) => t.term), top_priority: Math.max(...c.terms.map((t) => t.priority || 0)) };
  }).sort((a, b) => b.size - a.size || b.top_priority - a.top_priority);
}
