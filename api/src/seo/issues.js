// Deterministic technical SEO issue detection over crawled rows. Ported + extended from legacy audit.py::detect_issues.
import { hostOf, isPrivatePath, normalizeUrl } from "../lib/url.js";

export const ISSUE_META = {
  http_error: { severity: "high", title: "Page returns an error", how: "Fix or 301-redirect each broken URL and remove internal links to it." },
  broken_link: { severity: "high", title: "Internal link points to a broken page", how: "Update or remove links that point to 4xx/5xx pages." },
  redirect_chain: { severity: "med", title: "Internal link goes through redirects", how: "Link directly to the final URL to save crawl budget." },
  missing_title: { severity: "high", title: "Missing title", how: "Add a unique <title> (25-60 chars) containing the page's main keyword." },
  missing_meta_description: { severity: "high", title: "Missing meta description", how: "Write a unique description (70-160 chars) that invites the click." },
  noindex: { severity: "high", title: "Page is noindex", how: "Remove the noindex robots meta if the page should rank." },
  blocked_by_robots: { severity: "med", title: "Blocked by robots.txt", how: "Allow the path in robots.txt if it should be crawled." },
  missing_h1: { severity: "med", title: "Missing H1", how: "Add one H1 that states the main topic." },
  multiple_h1: { severity: "med", title: "Multiple H1 tags", how: "Keep exactly one H1 per page." },
  missing_canonical: { severity: "med", title: "Missing canonical", how: "Add <link rel=canonical> pointing to the preferred URL." },
  canonical_mismatch: { severity: "med", title: "Canonical points elsewhere", how: "Check that the canonical target is the intended URL (parameter / duplicate pages)." },
  canonical_external: { severity: "high", title: "Canonical points to another site", how: "Unless intentional syndication, point the canonical to this site." },
  title_length: { severity: "med", title: "Title length", how: "Keep titles between 25 and 60 characters." },
  meta_length: { severity: "med", title: "Meta description length", how: "Keep descriptions between 70 and 160 characters." },
  duplicate_title: { severity: "med", title: "Duplicate titles", how: "Give each page a unique title." },
  duplicate_meta_description: { severity: "med", title: "Duplicate meta descriptions", how: "Give each page a unique description." },
  duplicate_content: { severity: "med", title: "Duplicate content", how: "Merge or canonicalise pages with identical body text." },
  no_structured_data: { severity: "low", title: "No structured data", how: "Add JSON-LD (Organization, Service/Product, Article, FAQPage)." },
  thin_content: { severity: "low", title: "Thin content", how: "Expand with useful detail, examples and FAQs, or merge into a stronger page." },
  images_missing_alt: { severity: "low", title: "Images without alt text", how: "Add descriptive alt text to every content image." },
  low_inlinks: { severity: "low", title: "Few internal links", how: "Link to this page from related pages and navigation." },
  orphan_page: { severity: "med", title: "Orphan page (only in sitemap)", how: "Link to the page from at least one other page." },
  slow_response: { severity: "low", title: "Slow response", how: "Enable caching/CDN, compress images, remove heavy scripts." },
  missing_lang: { severity: "low", title: "Missing html lang", how: "Set <html lang=\"en\"> (or the page language)." },
  mixed_content_http: { severity: "med", title: "HTTP page on HTTPS site", how: "Redirect every http:// URL to https://." },
  missing_sitemap: { severity: "high", title: "No sitemap.xml", how: "Publish /sitemap.xml and reference it in robots.txt." },
  missing_robots: { severity: "med", title: "No robots.txt", how: "Add a robots.txt with a Sitemap: line." },
  robots_no_sitemap: { severity: "low", title: "robots.txt has no Sitemap line", how: "Add `Sitemap: https://.../sitemap.xml` to robots.txt." },
  sitemap_url_error: { severity: "med", title: "Sitemap lists a broken URL", how: "Remove non-200 URLs from the sitemap." },
  title_h1_mismatch: { severity: "low", title: "Title and H1 disagree", how: "Make the H1 repeat the main topic of the title." },
  about_missing: { severity: "med", title: "No About page", how: "Create an About page with the real person/team, experience and contact details." },
  weak_author_identity: { severity: "med", title: "Expert identity is weak", how: "Add a full name, real photo, training, years of practice, media mentions and Person schema." },
  risky_claims: { severity: "med", title: "Promises of guaranteed results", how: "Replace promise words with honest wording; never promise a cure or a result." },
  ymyl_no_disclaimer: { severity: "med", title: "Health/legal topic without disclaimer", how: "Add a clear disclaimer on these pages and a /disclaimer page." },
};

export function detectIssues(rows, { base, linkGraph = [], sitemapUrls = [], robotsBlocked = [] } = {}) {
  const out = [];
  const add = (type, sev, list, detail = () => "") => {
    for (const r of list) out.push({ type, severity: sev, url: r.url, detail: String(detail(r) ?? "").slice(0, 500) });
  };
  const ok = rows.filter((r) => r.status === 200);
  const pub = ok.filter((r) => !isPrivatePath(r.url));
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  const https = base?.startsWith("https://");

  add("http_error", "high", rows.filter((r) => r.status !== 200 && r.status !== "REDIRECT_OUT" && r.status !== "SKIPPED"), (r) => r.status);
  add("missing_title", "high", pub.filter((r) => !r.title));
  add("missing_meta_description", "high", pub.filter((r) => !r.meta_desc));
  add("noindex", "high", pub.filter((r) => /noindex/.test(r.robots_meta || "")));
  add("blocked_by_robots", "med", robotsBlocked.map((url) => ({ url })), () => "disallowed by robots.txt");
  add("missing_h1", "med", pub.filter((r) => r.h1_count === 0));
  add("multiple_h1", "med", pub.filter((r) => r.h1_count > 1), (r) => `${r.h1_count} H1 tags`);
  add("missing_canonical", "med", pub.filter((r) => !r.canonical));
  add("canonical_external", "high", pub.filter((r) => r.canonical && hostOf(r.canonical) && hostOf(r.canonical) !== hostOf(r.url)), (r) => r.canonical);
  add("canonical_mismatch", "med", pub.filter((r) => r.canonical && hostOf(r.canonical) === hostOf(r.url) && normalizeUrl(r.canonical) !== normalizeUrl(r.url)), (r) => `canonical: ${r.canonical}`);
  add("title_length", "med", pub.filter((r) => r.title && !(r.title_len >= 25 && r.title_len <= 60)), (r) => `${r.title_len} chars`);
  add("meta_length", "med", pub.filter((r) => r.meta_desc && !(r.meta_len >= 70 && r.meta_len <= 160)), (r) => `${r.meta_len} chars`);

  const group = (key) => {
    const g = new Map();
    for (const r of pub) { const k = r[key]; if (k) { if (!g.has(k)) g.set(k, []); g.get(k).push(r); } }
    return [...g.values()].filter((l) => l.length > 1).flat();
  };
  add("duplicate_title", "med", group("title"), (r) => r.title);
  add("duplicate_meta_description", "med", group("meta_desc"));
  add("duplicate_content", "med", group("content_hash").filter((r) => r.word_count >= 50), (r) => `${r.word_count} words identical to another page`);

  add("no_structured_data", "low", pub.filter((r) => !r.schema_types));
  add("thin_content", "low", pub.filter((r) => r.word_count < 300), (r) => `${r.word_count} words`);
  add("images_missing_alt", "low", pub.filter((r) => r.imgs_no_alt > 0), (r) => `${r.imgs_no_alt} images`);
  add("slow_response", "low", pub.filter((r) => r.time_s > 2), (r) => `${r.time_s}s`);
  add("missing_lang", "low", pub.filter((r) => !r.lang));
  if (https) add("mixed_content_http", "med", pub.filter((r) => r.url.startsWith("http://")));

  // link graph derived checks
  const inlinks = new Map();
  for (const l of linkGraph) {
    if (l.from_url === l.to_url) continue;
    inlinks.set(l.to_url, (inlinks.get(l.to_url) || 0) + 1);
  }
  add("low_inlinks", "low", pub.filter((r) => (inlinks.get(r.url) || 0) <= 1 && !isHome(r.url)), (r) => `${inlinks.get(r.url) || 0} inlinks`);
  const inSitemap = new Set(sitemapUrls);
  add("orphan_page", "med", pub.filter((r) => inSitemap.has(r.url) && !inlinks.get(r.url) && !isHome(r.url)));

  const broken = new Map();
  for (const l of linkGraph) {
    const t = byUrl.get(l.to_url);
    if (t && typeof t.status === "number" && t.status >= 400) {
      if (!broken.has(l.to_url)) broken.set(l.to_url, []);
      broken.get(l.to_url).push(l.from_url);
    }
  }
  for (const [to, froms] of broken) {
    out.push({ type: "broken_link", severity: "high", url: to, detail: `${byUrl.get(to).status} linked from ${[...new Set(froms)].slice(0, 3).join(", ")}` });
  }
  const chains = new Map();
  for (const l of linkGraph) {
    const t = byUrl.get(l.to_url);
    if (t && t.redirected_to && t.redirected_to !== l.to_url) chains.set(l.to_url, t.redirected_to);
  }
  for (const [from, to] of chains) out.push({ type: "redirect_chain", severity: "med", url: from, detail: `redirects to ${to}` });

  for (const u of sitemapUrls) {
    const r = byUrl.get(u);
    if (r && typeof r.status === "number" && r.status !== 200) out.push({ type: "sitemap_url_error", severity: "med", url: u, detail: `sitemap URL returned ${r.status}` });
  }
  return out;
}

const isHome = (u) => { try { return new URL(u).pathname === "/"; } catch { return false; } };

export function summarize(issues, rows) {
  const summary = {};
  for (const i of issues) summary[i.type] = (summary[i.type] || 0) + 1;
  summary._counts = { high: 0, med: 0, low: 0 };
  for (const i of issues) summary._counts[i.severity]++;
  summary._pages = rows.length;
  return summary;
}
