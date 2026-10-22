"""Technical SEO crawler + issue detection. Pure functions; no DB access."""
import ipaddress
import json
import re
import socket
import time
from collections import deque
from urllib.parse import urljoin, urldefrag, urlparse

import requests
from bs4 import BeautifulSoup

from . import quality

UA = "Mozilla/5.0 (compatible; SEOAuditBot/0.1)"
SKIP_EXT = re.compile(r"\.(jpg|jpeg|png|webp|gif|svg|pdf|css|js|ico|xml|zip|mp4)$", re.I)


def is_public_host(host: str) -> bool:
    """SSRF guard: sirf public IPs crawl hon."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def _fetch(session, url):
    start = time.time()
    try:
        return session.get(url, timeout=20, allow_redirects=True), time.time() - start
    except requests.RequestException as e:
        return e, time.time() - start


def _analyze(url, r, elapsed, host):
    row = {"url": url, "status": "", "time_s": round(elapsed, 2), "title": "", "title_len": 0,
           "meta_desc": "", "meta_len": 0, "h1_count": 0, "h1": "", "canonical": "",
           "robots_meta": "", "schema_types": "", "word_count": 0, "imgs_no_alt": 0, "lang": ""}
    links = []
    if isinstance(r, Exception):
        row["status"] = f"ERR {type(r).__name__}"
        return row, links
    row["status"] = r.status_code
    if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
        return row, links
    # redirect ke baad host badal gaya to us page ko analyze nahi karte
    if urlparse(r.url).netloc.replace("www.", "") != host.replace("www.", ""):
        row["status"] = "EXTERNAL_REDIRECT"
        return row, links
    soup = BeautifulSoup(r.text, "html.parser")
    t = soup.find("title")
    row["title"] = t.get_text(strip=True) if t else ""
    row["title_len"] = len(row["title"])
    m = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    row["meta_desc"] = (m.get("content") or "").strip() if m else ""
    row["meta_len"] = len(row["meta_desc"])
    h1s = soup.find_all("h1")
    row["h1_count"] = len(h1s)
    row["h1"] = h1s[0].get_text(strip=True)[:500] if h1s else ""
    c = soup.find("link", rel="canonical")
    row["canonical"] = c.get("href", "") if c else ""
    rm = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    row["robots_meta"] = rm.get("content", "") if rm else ""
    row["lang"] = soup.html.get("lang", "") if soup.html else ""
    types = []
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s.string or "")
        except ValueError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("@graph"), list):
                items = items + item["@graph"]
        for item in items:
            if isinstance(item, dict) and "@type" in item:
                t = item["@type"]
                types.extend(t if isinstance(t, list) else [str(t)])
    row["schema_types"] = ",".join(types)[:500]
    row["imgs_no_alt"] = sum(1 for i in soup.find_all("img") if not (i.get("alt") or "").strip())
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    row["word_count"] = len(text.split())
    row.update(quality.page_signals(soup, text))
    for a in soup.find_all("a", href=True):
        href = urldefrag(urljoin(r.url, a["href"]))[0]
        p = urlparse(href)
        if p.scheme in ("http", "https") and p.netloc.replace("www.", "") == host.replace("www.", ""):
            links.append(href)
    return row, links


def normalize(url: str) -> str:
    """Trailing slash aur '/' vs root duplicate hatao."""
    p = urlparse(url)
    path = p.path.rstrip("/") or ""
    return p._replace(path=path, fragment="").geturl()


def sitemap_urls(session, base, host, limit=1000):
    """sitemap.xml (aur ek level ke sitemap index) se same-host URLs. JS se bane links bhi mil jaate hain."""
    out, todo, seen = [], [base + "/sitemap.xml"], set()
    while todo and len(seen) < 20 and len(out) < limit:
        sm = todo.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        r, _ = _fetch(session, sm)
        if isinstance(r, Exception) or r.status_code != 200:
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)
        if "<sitemapindex" in r.text:
            todo.extend(locs)
            continue
        out.extend(l for l in locs if urlparse(l).netloc.replace("www.", "") == host.replace("www.", ""))
    return out[:limit]


def crawl(start_url: str, max_pages: int = 200):
    host = urlparse(start_url).netloc
    if not is_public_host(host.split(":")[0]):
        raise ValueError("host is not a public address")
    s = requests.Session()
    s.headers["User-Agent"] = UA
    start = normalize(start_url)
    seen, queue, rows, inlinks = {start}, deque([start]), [], {}
    base = f"{urlparse(start_url).scheme}://{host}"
    for u in sitemap_urls(s, base, host):
        u = normalize(u)
        if u not in seen and not SKIP_EXT.search(u):
            seen.add(u)
            queue.append(u)
    while queue and len(rows) < max_pages:
        url = queue.popleft()
        r, el = _fetch(s, url)
        row, links = _analyze(url, r, el, host)
        rows.append(row)
        for l in links:
            l = normalize(l)
            inlinks[l] = inlinks.get(l, 0) + 1
            if l not in seen and not SKIP_EXT.search(l):
                seen.add(l)
                queue.append(l)
    for row in rows:
        row["inlinks"] = inlinks.get(row["url"], 0)
    return rows, s


def site_file_issues(session, base):
    out = []
    r, _ = _fetch(session, base + "/sitemap.xml")
    if isinstance(r, Exception) or r.status_code != 200:
        out.append({"type": "missing_sitemap", "severity": "high", "url": base + "/sitemap.xml",
                    "detail": "sitemap.xml not found"})
    r, _ = _fetch(session, base + "/robots.txt")
    if isinstance(r, Exception) or r.status_code != 200:
        out.append({"type": "missing_robots", "severity": "med", "url": base + "/robots.txt",
                    "detail": "robots.txt not found"})
    elif "sitemap:" not in r.text.lower():
        out.append({"type": "robots_no_sitemap", "severity": "low", "url": base + "/robots.txt",
                    "detail": "robots.txt has no Sitemap: line"})
    return out


def detect_issues(rows):
    ok = [r for r in rows if r["status"] == 200]
    out = []

    def add(type_, sev, rs, detail=lambda r: ""):
        for r in rs:
            out.append({"type": type_, "severity": sev, "url": r["url"], "detail": str(detail(r))[:500]})

    add("http_error", "high", [r for r in rows if r["status"] != 200], lambda r: r["status"])
    add("missing_title", "high", [r for r in ok if not r["title"]])
    add("missing_meta_description", "high", [r for r in ok if not r["meta_desc"]])
    add("noindex", "high", [r for r in ok if "noindex" in r["robots_meta"].lower()])
    add("missing_h1", "med", [r for r in ok if r["h1_count"] == 0])
    add("multiple_h1", "med", [r for r in ok if r["h1_count"] > 1], lambda r: r["h1_count"])
    add("missing_canonical", "med", [r for r in ok if not r["canonical"]])
    add("title_length", "med", [r for r in ok if r["title"] and not 25 <= r["title_len"] <= 60],
        lambda r: f'{r["title_len"]} chars')
    add("meta_length", "med", [r for r in ok if r["meta_desc"] and not 70 <= r["meta_len"] <= 160],
        lambda r: f'{r["meta_len"]} chars')
    titles = {}
    for r in ok:
        if r["title"]:
            titles.setdefault(r["title"], []).append(r)
    add("duplicate_title", "med", [r for g in titles.values() if len(g) > 1 for r in g], lambda r: r["title"])
    descs = {}
    for r in ok:
        if r["meta_desc"]:
            descs.setdefault(r["meta_desc"], []).append(r)
    add("duplicate_meta_description", "med", [r for g in descs.values() if len(g) > 1 for r in g])
    add("no_structured_data", "med", [r for r in ok if not r["schema_types"]])
    add("thin_content", "low", [r for r in ok if r["word_count"] < 300], lambda r: f'{r["word_count"]} words')
    add("images_missing_alt", "low", [r for r in ok if r["imgs_no_alt"]], lambda r: f'{r["imgs_no_alt"]} images')
    add("low_inlinks", "low", [r for r in ok if r["inlinks"] <= 1], lambda r: f'{r["inlinks"]} inlinks')
    add("slow_response", "low", [r for r in ok if r["time_s"] > 2], lambda r: f'{r["time_s"]}s')
    add("missing_lang", "low", [r for r in ok if not r["lang"]])
    return out


def run_audit(url: str, max_pages: int = 200):
    rows, session = crawl(url, max_pages)
    base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    issues = detect_issues(rows) + site_file_issues(session, base) + quality.quality_issues(rows, base)
    summary = {}
    for i in issues:
        summary[i["type"]] = summary.get(i["type"], 0) + 1
    summary["_site"] = quality.site_stats(rows)
    return rows, issues, summary
