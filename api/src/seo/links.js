// Internal linking suggestions (deterministic): for each target page, find source pages whose text mentions the
// target's topic words but do not link to it yet. Scores by token overlap and source authority (inlinks).
import { isPrivatePath, pathOf } from "../lib/url.js";

const STOP = new Set(["the", "and", "for", "with", "your", "our", "you", "from", "online", "free", "best", "page", "home",
  "welcome", "this", "that", "are", "was", "were", "have", "has", "will", "can", "all", "more", "about", "contact",
  "what", "how", "why", "when", "which", "who", "get", "new", "one", "two", "use", "used", "using", "also", "into", "than"]);

export const tokenize = (s) => (s || "").toLowerCase().match(/[a-z0-9ऀ-ॿ]{3,}/g)?.filter((w) => !STOP.has(w)) || [];

function topicOf(page) {
  const fromTitle = tokenize(page.title), fromH1 = tokenize(page.h1), fromPath = tokenize(pathOf(page.url).replace(/[-_/]+/g, " "));
  const counts = new Map();
  for (const w of [...fromTitle, ...fromH1, ...fromPath]) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

/**
 * pages: [{url,title,h1,text?,word_count,inlinks}], links: [{from_url,to_url}]
 * returns [{target_url, source_url, anchor, score, reason}]
 */
export function suggestInternalLinks(pages, links, { max = 100, perTarget = 5 } = {}) {
  const pub = pages.filter((p) => p.status === 200 && !isPrivatePath(p.url) && pathOf(p.url) !== "/");
  const linked = new Set(links.map((l) => `${l.from_url}>${l.to_url}`));
  const out = [];
  const textTokens = new Map(pages.map((p) => [p.url, new Set(tokenize(p.text || `${p.title} ${p.h1} ${(p.h2s || []).join(" ")}`))]));
  for (const target of pub) {
    const topic = topicOf(target);
    if (topic.length < 2) continue;
    const cands = [];
    for (const src of pages) {
      if (src.url === target.url || src.status !== 200 || isPrivatePath(src.url)) continue;
      if (linked.has(`${src.url}>${target.url}`)) continue;
      const tt = textTokens.get(src.url);
      const hits = topic.filter((w) => tt.has(w));
      if (hits.length < 2) continue;
      const overlap = hits.length / topic.length;
      const authority = Math.log2(2 + (src.inlinks || 0));
      const score = Math.round(100 * (0.7 * overlap + 0.3 * Math.min(1, authority / 5)));
      cands.push({
        target_url: target.url, source_url: src.url, anchor: (target.h1 || target.title || "").slice(0, 80),
        score, reason: `mentions "${hits.slice(0, 3).join('", "')}"; ${(src.inlinks || 0)} inlinks`,
        target_inlinks: target.inlinks || 0,
      });
    }
    cands.sort((a, b) => b.score - a.score);
    out.push(...cands.slice(0, perTarget));
  }
  // pages with the fewest inlinks first: they benefit most
  out.sort((a, b) => a.target_inlinks - b.target_inlinks || b.score - a.score);
  return out.slice(0, max);
}
