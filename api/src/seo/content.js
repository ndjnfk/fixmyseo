// On-page content optimisation score for one page against a target keyword. Deterministic checklist; no LLM.
import { tokenize } from "./links.js";

const inText = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());

export function contentScore(page, keyword) {
  const kw = keyword.trim().toLowerCase();
  const kwTokens = tokenize(kw);
  const text = page.text || "";
  const words = page.word_count || (text ? text.split(/\s+/).length : 0);
  const checks = [];
  const add = (key, ok, weight, label, fix) => checks.push({ key, ok: Boolean(ok), weight, label, fix });

  add("title_has_keyword", inText(page.title || "", kw) || partial(page.title, kwTokens), 15, "Keyword in title", "Put the main keyword near the start of the title.");
  add("title_length", page.title && page.title.length >= 25 && page.title.length <= 60, 5, "Title 25-60 chars", "Shorten or lengthen the title.");
  add("meta_has_keyword", inText(page.meta_description || page.meta_desc || "", kw) || partial(page.meta_description || page.meta_desc, kwTokens), 8, "Keyword in meta description", "Mention the keyword naturally in the description.");
  add("h1_has_keyword", inText(page.h1 || "", kw) || partial(page.h1, kwTokens), 12, "Keyword in H1", "Make the H1 state the keyword topic.");
  const h2s = page.h2s || (page.headings || []).filter((h) => h.tag === "h2").map((h) => h.text);
  add("subheading_has_keyword", h2s.some((h) => partial(h, kwTokens)), 6, "Keyword in a subheading", "Add an H2 that covers the keyword.");
  const first = text.slice(0, 600);
  add("keyword_in_intro", partial(first, kwTokens), 8, "Keyword in the first 100 words", "Mention the topic in the opening paragraph.");
  const occurrences = countOccurrences(text, kwTokens);
  const density = words ? occurrences / words : 0;
  add("keyword_density", occurrences >= 2 && density <= 0.03, 6, "Natural keyword use (2+ mentions, <3%)", occurrences < 2 ? "Use the keyword a few more times." : "Reduce keyword repetition.");
  add("word_count", words >= 600, 10, "600+ words", `Currently ${words} words. Add depth: examples, steps, FAQs.`);
  add("has_subheadings", h2s.length >= 2, 6, "At least 2 H2 sections", "Break the content into sections with H2 headings.");
  add("has_images_alt", (page.img_count || 0) > 0 && (page.imgs_no_alt || 0) === 0, 4, "Images with alt text", "Add images with descriptive alt text.");
  add("internal_links_out", (page.internal_links_out ?? 1) >= 2, 5, "Links to related pages", "Link to 2+ related pages on your site.");
  add("inlinks", (page.inlinks || 0) >= 3, 5, "3+ internal links pointing here", "Link to this page from related pages.");
  add("canonical", Boolean(page.canonical), 3, "Canonical set", "Add a canonical tag.");
  add("schema", Boolean(page.schema_types), 4, "Structured data", "Add JSON-LD (Article / FAQPage / Service).");
  add("readability", avgSentenceLength(text) <= 25, 3, "Short sentences (<= 25 words avg)", "Split long sentences.");

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.reduce((a, c) => a + (c.ok ? c.weight : 0), 0);
  return {
    keyword: kw, url: page.url, score: Math.round((100 * got) / total), words, occurrences,
    checks, todo: checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight).map((c) => ({ label: c.label, fix: c.fix, weight: c.weight })),
  };
}

function partial(text, kwTokens) {
  if (!text || !kwTokens.length) return false;
  const t = new Set(tokenize(text));
  const hit = kwTokens.filter((w) => t.has(w)).length;
  return hit / kwTokens.length >= 0.6;
}

function countOccurrences(text, kwTokens) {
  if (!kwTokens.length) return 0;
  const words = tokenize(text);
  let n = 0;
  for (let i = 0; i + kwTokens.length <= words.length; i++) {
    if (kwTokens.every((w, j) => words[i + j] === w)) n++;
  }
  if (n === 0 && kwTokens.length > 1) {
    // loose: all tokens appear within 10-word windows
    for (let i = 0; i < words.length; i++) {
      const win = new Set(words.slice(i, i + 10));
      if (kwTokens.every((w) => win.has(w))) n++;
    }
  }
  return n;
}

function avgSentenceLength(text) {
  const sents = text.split(/[.!?।]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
  if (!sents.length) return 0;
  return sents.reduce((a, s) => a + s.split(/\s+/).length, 0) / sents.length;
}
