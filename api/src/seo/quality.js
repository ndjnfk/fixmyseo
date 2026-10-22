// Content / trust checks (E-E-A-T, YMYL). Ported from legacy intel/app/quality.py. Deterministic, no LLM.
import { pathOf, hostOf, isPrivatePath } from "../lib/url.js";

const CLAIM = /\b(guarantee[sd]?|guaranteed results?|100\s?% (?:results?|success|guaranteed|accurate|solution)|permanent (?:solution|cure)|instant results?|cures?|cured|miracle\w*)\b/gi;
const YMYL = /\b(health|disease|illness|medical|medicine|cancer|infertility|pregnan\w*|depression|legal|court|lawsuit|divorce case|financial|debt|loans?|money problems?)\b/gi;
const DISCLAIMER = /disclaimer|not a substitute|for guidance only|entertainment purposes|results may vary|consult (?:a|your) (?:doctor|lawyer|physician|professional)/i;
const EXPERIENCE = /\b\d+\s*\+?\s*(?:years?|yrs)\b|\byears of (?:experience|practice)\b/i;
const TRAINING = /\b(certified|certification|qualified|qualifications?|degree|diploma|trained|training|lineage|guru|studied|learned under|disciple)\b/i;
const MEDIA = /\b(featured (?:in|on)|as seen (?:in|on)|awards?|interviewed|published in|press)\b/i;
const NEGATION = /\b(not|no|never|don'?t|doesn'?t|cannot|can'?t|won'?t|without|nor)\b[^.!?]*$/i;
const SOCIAL = /(instagram|facebook|youtube|linkedin|twitter|x)\.com\//i;
const ABOUT = /^\/(about|about-us|about-me|our-story|team|who-we-are)\/?$/i;
const STOP = new Set(["the", "and", "for", "with", "your", "our", "you", "from", "online", "free", "best", "page", "home", "welcome"]);

function claims(text) {
  const out = new Set();
  for (const m of text.matchAll(CLAIM)) {
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const end = after.match(/[.!?]/);
    if (NEGATION.test(before) || (end && end[0] === "?")) continue;
    out.add(m[0].toLowerCase());
  }
  return [...out].sort().slice(0, 5);
}

/** Visible text with a space between text nodes (cheerio's .text() runs adjacent elements together). */
export function visibleText($, selector = "body") {
  const root = $(selector);
  const parts = [];
  root.find("*").addBack().contents().each((_, n) => {
    if (n.type !== "text") return;
    const p = n.parent;
    if (p && ["script", "style", "noscript", "template", "svg"].includes(p.tagName?.toLowerCase?.() || p.name)) return;
    const t = (n.data || "").replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  });
  return parts.join(" ");
}

/** Signals computed while the DOM is still intact ($ = cheerio root). */
export function pageSignals($) {
  const text = visibleText($);
  const contentImgs = $("img").filter((_, i) => $(i).parents("header, nav, footer").length === 0).length;
  return {
    claims: claims(text),
    ymyl_topics: [...new Set([...text.matchAll(YMYL)].map((m) => m[0].toLowerCase()))].sort().slice(0, 5),
    has_disclaimer: DISCLAIMER.test(text),
    has_experience: EXPERIENCE.test(text),
    has_training: TRAINING.test(text),
    has_media: MEDIA.test(text),
    img_count: contentImgs,
    social_links: $("a[href]").filter((_, a) => SOCIAL.test($(a).attr("href") || "")).length,
  };
}

const tokens = (text, brand) => [...new Set((text || "").toLowerCase().match(/[a-z0-9]+/g) || [])]
  .filter((w) => w.length > 2 && !STOP.has(w) && !brand.includes(w));

function titleTopic(title, brand) {
  return (title || "").split(/\s[|\-–—:]\s/).filter((p) => tokens(p, brand).length).join(" ").trim();
}

export function qualityIssues(rows, base) {
  const host = hostOf(base) || "";
  const brand = host.split(".")[0].toLowerCase();
  const ok = rows.filter((r) => r.status === 200 && !isPrivatePath(r.url));
  const out = [];
  const add = (type, severity, url, detail) => out.push({ type, severity, url, detail: detail.slice(0, 500) });

  // 1) title and H1 disagree
  for (const r of ok) {
    const topic = titleTopic(r.title, brand), h1 = r.h1 || "";
    const t = new Set(tokens(topic, brand)), h = new Set(tokens(h1, brand));
    if (!t.size || !h.size) continue;
    const cover = [...t].filter((w) => h.has(w)).length / t.size;
    const home = pathOf(r.url).replace(/\//g, "") === "";
    if ((home && cover < 0.5) || cover === 0) {
      add("title_h1_mismatch", home ? "med" : "low", r.url,
        `Title says "${topic}" but H1 says "${h1}". Make both describe the same main topic.`);
    }
  }

  // 2) expert / business identity
  const about = ok.find((r) => ABOUT.test(pathOf(r.url)));
  const social = ok.reduce((a, r) => a + (r.signals?.social_links || 0), 0);
  if (ok.length >= 3 && !about) {
    add("about_missing", "med", base, "No About page found. Add one with the real person or team behind the site.");
  } else if (about) {
    const s = about.signals || {};
    const missing = [];
    if ((about.word_count || 0) < 300) missing.push("a detailed bio (300+ words)");
    if (!s.has_experience) missing.push("years of experience");
    if (!s.has_training) missing.push("training, qualifications or lineage");
    if (!s.has_media) missing.push("media mentions or awards");
    if (!(about.schema_types || "").includes("Person")) missing.push("Person schema");
    if (!s.img_count) missing.push("a real photo");
    if (!social) missing.push("links to social profiles");
    if (missing.length >= 3) add("weak_author_identity", "med", about.url, "About page is missing " + missing.join(", ") + ".");
  }

  // 3) guarantee/cure claims and YMYL without disclaimer
  const siteDisclaimer = ok.some((r) => r.signals?.has_disclaimer) || rows.some((r) => r.url.toLowerCase().includes("disclaimer"));
  for (const r of ok) {
    const s = r.signals || {};
    if (s.claims?.length) {
      add("risky_claims", s.ymyl_topics?.length ? "high" : "med", r.url,
        "Uses promise words: " + s.claims.map((c) => `"${c}"`).join(", ") + ".");
    }
    if (s.ymyl_topics?.length && !s.has_disclaimer && !siteDisclaimer) {
      add("ymyl_no_disclaimer", "med", r.url,
        "Talks about " + s.ymyl_topics.map((t) => `"${t}"`).join(", ") + " but the site has no disclaimer.");
    }
  }
  return out;
}

export function siteStats(rows) {
  const ok = rows.filter((r) => r.status === 200);
  return {
    pages: ok.length,
    hindi_pages: ok.filter((r) => (r.signals?.hindi_chars || 0) > 100).length,
    has_disclaimer: ok.some((r) => r.signals?.has_disclaimer),
    social_links: ok.reduce((a, r) => a + (r.signals?.social_links || 0), 0),
  };
}
