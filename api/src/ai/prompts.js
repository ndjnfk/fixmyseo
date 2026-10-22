// Versioned prompts. Each task: system, build(input) -> user prompt, JSON schema for the model, zod validator for us.
// Inputs are clipped (AI_MAX_INPUT_CHARS) so a huge page can never blow the context window.
// The model is never asked for traffic, volume, ranking or backlink numbers.
import { z } from "zod";
import { config } from "../config.js";

export const clip = (s, n = config.AI_MAX_INPUT_CHARS) => (s == null ? "" : String(s).replace(/\s+/g, " ").slice(0, n));
const list = (arr, n = 20) => (arr || []).slice(0, n).map((x) => `- ${clip(x, 200)}`).join("\n") || "(none)";

const SYSTEM = "You are a careful SEO editor. You write for humans first, in the page's language (English or Hindi). " +
  "Never invent facts, statistics, prices, reviews, search volumes or rankings. Never promise results. Reply ONLY with JSON that matches the requested shape.";

const strArr = (max, maxLen) => z.array(z.string().trim().min(1).max(maxLen)).min(1).max(max);

export const TASKS = {
  titles: {
    version: "titles.v1", maxTokens: 600,
    schema: { type: "object", properties: { titles: { type: "array", items: { type: "string" } }, descriptions: { type: "array", items: { type: "string" } } }, required: ["titles", "descriptions"] },
    validate: z.object({ titles: strArr(5, 120), descriptions: strArr(5, 260) }),
    build: (i) => `Website: ${i.domain}\nPage URL: ${i.url}\nCurrent title: ${clip(i.title, 200) || "(missing)"}\nCurrent meta description: ${clip(i.meta, 300) || "(missing)"}\nH1: ${clip(i.h1, 200) || "(missing)"}\nSubheadings:\n${list(i.h2s, 10)}\n` +
      (i.keyword ? `Target keyword: ${clip(i.keyword, 100)}\n` : "") +
      (i.queries?.length ? `Real searches that already show this page (from Search Console):\n${list(i.queries, 8)}\n` : "") +
      `Page text (excerpt):\n${clip(i.text, 1500)}\n\nWrite 3 title options (each 35-60 characters, main topic first, brand optional at the end) and 3 meta description options (each 90-155 characters, specific, inviting a click, no clickbait). Keys: titles, descriptions.`,
    post: (o) => ({ titles: o.titles.slice(0, 3).map((t) => t.slice(0, 70)), descriptions: o.descriptions.slice(0, 3).map((d) => d.slice(0, 165)) }),
  },
  brief: {
    version: "brief.v1", maxTokens: 1400,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" }, intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
        target_words: { type: "integer" },
        outline: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, points: { type: "array", items: { type: "string" } } }, required: ["heading", "points"] } },
        faqs: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
        internal_links: { type: "array", items: { type: "string" } },
        human_input_needed: { type: "array", items: { type: "string" } },
      },
      required: ["title", "intent", "outline", "faqs", "internal_links", "target_words", "human_input_needed"],
    },
    validate: z.object({
      title: z.string().min(5).max(150), intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
      target_words: z.number().int().min(300).max(5000),
      outline: z.array(z.object({ heading: z.string().min(2).max(150), points: z.array(z.string().max(300)).max(8) })).min(3).max(12),
      faqs: z.array(z.object({ question: z.string().min(5).max(200), answer: z.string().min(5).max(600) })).max(8),
      internal_links: z.array(z.string().max(500)).max(10), human_input_needed: z.array(z.string().max(300)).max(8),
    }),
    build: (i) => `Website: ${i.domain}\nAbout the business: ${clip(i.notes, 600) || "(no notes)"}\nTarget keyword: ${clip(i.keyword, 120)}\n` +
      (i.url ? `Existing page to improve: ${i.url}\nIts current H1: ${clip(i.h1, 200)}\n` : "This will be a NEW page.\n") +
      `Related keywords in the same cluster:\n${list(i.related, 12)}\nExisting pages on the site (url | title) that could be linked to:\n${list(i.pages, 20)}\n` +
      (i.queries?.length ? `Real related searches from Search Console:\n${list(i.queries, 10)}\n` : "") +
      `Produce a content brief: a working title, search intent, target_words (realistic), an outline of 4-8 H2 sections each with 2-5 bullet points, 3-6 FAQs with short honest answers, internal_links (choose only from the existing pages above, max 5 URLs) and human_input_needed: things only the site owner can supply (real experience, examples, prices, credentials). Keys: title, intent, target_words, outline, faqs, internal_links, human_input_needed.`,
    post: (o) => o,
  },
  faq: {
    version: "faq.v1", maxTokens: 900,
    schema: { type: "object", properties: { faqs: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } } }, required: ["faqs"] },
    validate: z.object({ faqs: z.array(z.object({ question: z.string().min(5).max(200), answer: z.string().min(10).max(600) })).min(1).max(8) }),
    build: (i) => `Website: ${i.domain}\nPage: ${i.url}\nH1: ${clip(i.h1, 200)}\nPage text (excerpt):\n${clip(i.text, 2500)}\n\nWrite 4-6 FAQs a real visitor of this page would ask, with concise, honest answers based only on the page text. Do not invent prices, guarantees or credentials. Key: faqs.`,
    post: (o) => ({ faqs: o.faqs.slice(0, 6) }),
  },
  "cluster-names": {
    version: "cluster-names.v1", maxTokens: 800,
    schema: { type: "object", properties: { clusters: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, intent: { type: "string" } }, required: ["id", "name", "intent"] } } }, required: ["clusters"] },
    validate: z.object({ clusters: z.array(z.object({ id: z.number().int(), name: z.string().min(2).max(80), intent: z.string().max(30) })).min(1) }),
    build: (i) => `Website: ${i.domain}\nKeyword clusters (id: terms):\n${i.clusters.map((c) => `${c.id}: ${clip(c.terms.join(", "), 300)}`).join("\n")}\n\nFor each cluster give a short human topic name (2-5 words, the page/article it should become) and the dominant search intent (informational, commercial, transactional or navigational). Key: clusters (id, name, intent).`,
    post: (o) => o,
  },
  explain: {
    version: "explain.v1", maxTokens: 700,
    schema: { type: "object", properties: { explanation: { type: "string" }, why_it_matters: { type: "string" }, steps: { type: "array", items: { type: "string" } } }, required: ["explanation", "why_it_matters", "steps"] },
    validate: z.object({ explanation: z.string().min(10).max(800), why_it_matters: z.string().min(10).max(600), steps: z.array(z.string().min(3).max(300)).min(1).max(8) }),
    build: (i) => `Audit issue type: ${i.issue_type}\nOur definition: ${clip(i.title, 200)}\nStandard fix: ${clip(i.how, 300)}\nThis site has ${i.count} occurrences, for example:\n${list(i.examples, 5)}\nSite platform: ${i.framework || "unknown"}\n\nExplain this issue to a non-technical website owner in plain language, why it matters for Google, and 3-6 concrete steps to fix it on their platform. Do not promise ranking results. Keys: explanation, why_it_matters, steps.`,
    post: (o) => o,
  },
};

export const TASK_NAMES = Object.keys(TASKS);
export { SYSTEM };
