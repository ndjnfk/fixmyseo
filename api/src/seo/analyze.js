// Per-page analysis of fetched HTML (pure function). Ported from legacy intel/app/audit.py::_analyze + quality.page_signals.
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { normalizeUrl, sameSite, SKIP_EXT } from "../lib/url.js";
import { pageSignals, visibleText } from "./quality.js";

export function emptyRow(url) {
  return {
    url, status: "", time_s: 0, title: "", title_len: 0, meta_desc: "", meta_len: 0, h1_count: 0, h1: "", h2s: [],
    canonical: "", robots_meta: "", schema_types: "", word_count: 0, imgs_no_alt: 0, img_count: 0, lang: "",
    text: "", headings: [], content_hash: null, signals: {},
  };
}

/** Parse one HTML document. Returns { row, links: [{url, anchor, nofollow}] }. */
export function analyzeHtml(url, html, { finalUrl = url } = {}) {
  const row = emptyRow(url);
  const links = [];
  const $ = cheerio.load(html);
  row.title = ($("head > title").first().text() || $("title").first().text() || "").trim().replace(/\s+/g, " ");
  row.title_len = row.title.length;
  const md = $('meta[name="description" i]').attr("content") || "";
  row.meta_desc = md.trim().replace(/\s+/g, " ");
  row.meta_len = row.meta_desc.length;
  const h1s = $("h1");
  row.h1_count = h1s.length;
  row.h1 = (h1s.first().text() || "").trim().replace(/\s+/g, " ").slice(0, 500);
  row.h2s = $("h2").map((_, e) => $(e).text().trim().replace(/\s+/g, " ").slice(0, 200)).get().filter(Boolean).slice(0, 50);
  row.headings = $("h1,h2,h3").map((_, e) => ({ tag: e.tagName.toLowerCase(), text: $(e).text().trim().replace(/\s+/g, " ").slice(0, 200) })).get().slice(0, 100);
  const canon = $('link[rel="canonical" i]').attr("href");
  row.canonical = canon ? (normalizeUrl(canon.trim(), finalUrl) || canon.trim()) : "";
  row.robots_meta = ($('meta[name="robots" i]').attr("content") || "").trim().toLowerCase();
  row.lang = ($("html").attr("lang") || "").trim();

  const types = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    let data;
    try { data = JSON.parse($(s).text() || ""); } catch { return; }
    let items = Array.isArray(data) ? data : [data];
    for (const it of [...items]) if (it && Array.isArray(it["@graph"])) items = items.concat(it["@graph"]);
    for (const it of items) {
      if (it && typeof it === "object" && it["@type"]) {
        const t = it["@type"];
        types.push(...(Array.isArray(t) ? t.map(String) : [String(t)]));
      }
    }
  });
  row.schema_types = [...new Set(types)].join(",").slice(0, 500);

  const imgs = $("img");
  row.img_count = imgs.length;
  row.imgs_no_alt = imgs.filter((_, i) => !($(i).attr("alt") || "").trim()).length;

  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") || "").trim();
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) return;
    const abs = normalizeUrl(href, finalUrl);
    if (!abs) return;
    const rel = ($(a).attr("rel") || "").toLowerCase();
    links.push({
      url: abs, anchor: $(a).text().trim().replace(/\s+/g, " ").slice(0, 255),
      nofollow: /\bnofollow\b/.test(rel), internal: sameSite(abs, finalUrl), asset: SKIP_EXT.test(abs),
    });
  });

  // visible text: drop script/style/noscript/template
  const sig = pageSignals($);
  const text = visibleText($);
  row.text = text;
  row.word_count = text ? text.split(/\s+/).length : 0;
  row.content_hash = crypto.createHash("md5").update(text.toLowerCase().slice(0, 20000)).digest("hex");
  row.signals = { ...sig, ...textSignals(text) };
  return { row, links };
}

function textSignals(text) {
  return {
    hindi_chars: (text.match(/[ऀ-ॿ]/g) || []).length,
  };
}
