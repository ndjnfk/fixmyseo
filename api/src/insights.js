// Recommendations: audit issues + keywords + Search Console + index status ko mila ke
// "kya karna hai" ki ek list. Level: fix (zaroori), caution (risk), improve (ranking badhane ke liye).
const LEVEL = { fix: 0, caution: 1, improve: 2 };
const plural = (n, word) => `${n} ${n === 1 ? word : /(s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`}`;
// login/account pages ka noindex aur kam content normal hai
const PRIVATE = /\/(account|login|signin|sign-in|signup|sign-up|register|admin|dashboard|cart|checkout|api)(\/|$)/i;
const isPrivate = (u) => { try { return PRIVATE.test(new URL(u).pathname); } catch { return false; } };

export function insightRoutes(app, { db, auth, wrap, ownSite }) {
  app.get("/sites/:id/recommendations", auth, wrap(async (req, res) => {
    const site = await ownSite(req, res);
    if (!site) return;
    const [[run]] = await db.query(
      "SELECT id, summary_json FROM crawl_runs WHERE site_id=? AND status='done' ORDER BY id DESC LIMIT 1", [site.id]);
    if (!run) return res.json({ ready: false, items: [] });

    const [issues] = await db.query("SELECT type, severity, url, detail FROM issues WHERE run_id=?", [run.id]);
    const byType = new Map();
    for (const i of issues) {
      if (i.url && isPrivate(i.url)) continue;
      if (!byType.has(i.type)) byType.set(i.type, []);
      byType.get(i.type).push(i);
    }
    const of = (t) => byType.get(t) || [];
    const summary = typeof run.summary_json === "string" ? JSON.parse(run.summary_json) : run.summary_json || {};
    const stats = summary._site || {};

    const [kw] = await db.query("SELECT term, status, priority, demand FROM keywords WHERE site_id=? AND status<>'ignored'", [site.id]);
    const [[gsc]] = await db.query(
      `SELECT COUNT(*) n FROM (
         SELECT query FROM gsc_daily WHERE site_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) GROUP BY query
         HAVING SUM(impressions) >= 10 AND SUM(position*impressions)/SUM(impressions) BETWEEN 4 AND 20) q`, [site.id]);
    const [[idx]] = await db.query(
      "SELECT COUNT(*) total, SUM(verdict IS NOT NULL AND verdict<>'PASS') notIndexed FROM index_status WHERE site_id=?", [site.id]);

    const items = [];
    const add = (level, key, title, detail, how, opts = {}) =>
      items.push({ level, key, title, detail, how, urls: (opts.urls || []).slice(0, 5), tab: opts.tab || "issues", weight: opts.weight || 0 });
    const urlsOf = (list) => [...new Set(list.map((i) => i.url))];

    // ---------- fix: Google page dekh hi nahi pa raha ----------
    if (of("noindex").length)
      add("fix", "noindex", `${plural(of("noindex").length, "page")} hidden from Google`,
        "These pages have a noindex tag, so they can never rank.",
        "Remove the noindex robots meta tag from pages you want in Google.", { urls: urlsOf(of("noindex")), weight: 10 });
    if (of("http_error").length)
      add("fix", "http_error", `${plural(of("http_error").length, "page")} return errors`,
        "Broken pages waste Google's crawl and lose any links pointing to them.",
        "Fix or redirect (301) each broken URL, and remove internal links to it.", { urls: urlsOf(of("http_error")), weight: 9 });
    if (of("missing_sitemap").length)
      add("fix", "missing_sitemap", "No sitemap.xml", "Google finds new pages slower without a sitemap.",
        "Publish /sitemap.xml listing every public page, and add it to robots.txt.", { weight: 8 });
    const noMeta = [...of("missing_title"), ...of("missing_meta_description")];
    if (noMeta.length)
      add("fix", "missing_meta", `${plural(new Set(noMeta.map((i) => i.url)).size, "page")} missing a title or meta description`,
        "Google shows these in search results. Missing ones lower clicks.",
        "Write a unique title (25-60 chars) and description (70-160 chars) with the page's main keyword.", { urls: urlsOf(noMeta), weight: 7 });
    if (Number(idx.notIndexed))
      add("fix", "not_indexed", `${plural(Number(idx.notIndexed), "page")} not indexed by Google`,
        `Google checked ${idx.total} pages and did not index ${idx.notIndexed} of them.`,
        "Open Automation → Google index status to see the reason. Usually: add more unique content and internal links.", { tab: "automation", weight: 7 });

    // ---------- caution: bharosa (YMYL) ----------
    if (of("risky_claims").length)
      add("caution", "risky_claims", "Promises of guaranteed results",
        of("risky_claims")[0].detail + " Google and users distrust guaranteed outcomes, especially on advice sites.",
        "Replace promise words with honest wording (\"may help\", \"many clients feel\"). Never promise a cure or a result.",
        { urls: urlsOf(of("risky_claims")), weight: 9 });
    if (of("ymyl_no_disclaimer").length)
      add("caution", "ymyl_no_disclaimer", "Health or legal topics without a disclaimer",
        of("ymyl_no_disclaimer")[0].detail + " These are \"Your Money or Your Life\" topics, which Google judges strictly.",
        "Add a clear disclaimer (e.g. \"for guidance only, not a substitute for a doctor or lawyer\") on these pages and a /disclaimer page.",
        { urls: urlsOf(of("ymyl_no_disclaimer")), weight: 8 });

    // ---------- improve: pehchaan aur focus ----------
    const homeFocus = of("title_h1_mismatch").find((i) => i.severity === "med");
    if (homeFocus)
      add("improve", "home_focus", "Homepage focus is unclear", homeFocus.detail + " Google should get one clear message about what you are known for.",
        "Pick your main service and use it in both the homepage title and H1.", { urls: [homeFocus.url], weight: 8 });
    const otherFocus = of("title_h1_mismatch").filter((i) => i.severity !== "med");
    if (otherFocus.length)
      add("improve", "title_h1", `${plural(otherFocus.length, "page")} where title and H1 disagree`, otherFocus[0].detail,
        "Make the H1 repeat the main topic of the title.", { urls: urlsOf(otherFocus), weight: 4 });
    if (of("about_missing").length)
      add("improve", "about_missing", "No About page", "Visitors and Google cannot see who is behind the site.",
        "Create an About page with your full name, photo, experience, training and contact details.", { weight: 7 });
    if (of("weak_author_identity").length)
      add("improve", "expert_identity", "Expert identity is weak", of("weak_author_identity")[0].detail +
        " For life-decision topics (astrology, health, money) Google looks for a real, identifiable expert.",
        "Add your full name, a real photo, training/lineage, years of practice, media mentions and social links. Add Person schema.",
        { urls: urlsOf(of("weak_author_identity")), weight: 7 });

    // ---------- improve: keywords se mauke ----------
    const hindi = kw.filter((k) => /hindi|[ऀ-ॿ]/.test(k.term));
    if (stats.pages && !stats.hindi_pages && hindi.length >= 3)
      add("improve", "hindi", "No Hindi content", `Keyword research found ${plural(hindi.length, "Hindi search")}, e.g. ` +
        hindi.sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0)).slice(0, 3).map((k) => `"${k.term}"`).join(", ") +
        ". The site has no Hindi pages. Competition in Hindi is usually lower.",
        "Create Hindi versions of your most important pages (Devanagari text, lang=\"hi\"), starting with the highest-demand topics.",
        { tab: "keywords", weight: 7 });
    if (Number(gsc.n))
      add("improve", "quick_wins", `${plural(Number(gsc.n), "search")} ranking 4-20 on Google`,
        "You are close to the top for these. Small improvements can bring big traffic gains.",
        "Open Keywords → Quick wins. For each, improve its page: put the query in the title and H1, add depth and an FAQ.",
        { tab: "keywords", weight: 9 });
    const gaps = kw.filter((k) => k.status === "gap" && k.priority >= 6).sort((a, b) => b.priority - a.priority);
    if (gaps.length)
      add("improve", "gaps", `${plural(gaps.length, "high-priority topic")} with no page`,
        "e.g. " + gaps.slice(0, 3).map((k) => `"${k.term}"`).join(", ") + ".",
        "Write one in-depth page per topic cluster. Check the top Google results first and make yours more useful.",
        { tab: "keywords", weight: 6 });
    const partial = kw.filter((k) => k.status === "partial" && k.priority >= 6);
    if (partial.length)
      add("improve", "partial", `${plural(partial.length, "keyword")} only partly covered`,
        "e.g. " + partial.slice(0, 3).map((k) => `"${k.term}"`).join(", ") + ".",
        "Add a section, heading or FAQ for each keyword to its target page.", { tab: "keywords", weight: 5 });

    // ---------- improve: content quality ----------
    if (of("thin_content").length)
      add("improve", "thin", `${plural(of("thin_content").length, "page")} with thin content`,
        "Pages under 300 words rarely rank for competitive searches.",
        "Expand them with useful detail, examples and FAQs, or merge them into a stronger page.", { urls: urlsOf(of("thin_content")), weight: 5 });
    if (of("no_structured_data").length)
      add("improve", "schema", `${plural(of("no_structured_data").length, "page")} without structured data`,
        "Schema helps Google understand the page and can add rich results.",
        "Add JSON-LD: Organization/LocalBusiness on the homepage, Service or Product on service pages, Article on blog posts, FAQPage for FAQs.",
        { urls: urlsOf(of("no_structured_data")), weight: 4 });
    if (of("slow_response").length)
      add("improve", "slow", `${plural(of("slow_response").length, "slow page")}`, "These pages took over 2 seconds to respond.",
        "Enable caching/CDN, compress images and remove heavy scripts.", { urls: urlsOf(of("slow_response")), weight: 4 });
    if (of("low_inlinks").length)
      add("improve", "inlinks", `${plural(of("low_inlinks").length, "page")} with almost no internal links`,
        "Pages with few internal links look unimportant to Google.",
        "Link to them from related pages and your navigation, using descriptive anchor text.", { urls: urlsOf(of("low_inlinks")), weight: 3 });
    if (!site.gsc_property)
      add("improve", "gsc", "Search Console not connected", "Without it you cannot see real searches, clicks or positions.",
        "Open the Search Console tab and connect your Google account.", { tab: "search-console", weight: 8 });

    items.sort((a, b) => LEVEL[a.level] - LEVEL[b.level] || b.weight - a.weight);
    res.json({ ready: true, items: items.map(({ weight, ...i }) => i) });
  }));
}
