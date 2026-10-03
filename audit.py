"""Technical SEO audit: crawls a site and writes report.md + pages.csv.

Usage: python audit.py https://vidushiji.com [--max 200]
"""
import argparse
import csv
import json
import re
import time
from collections import deque
from urllib.parse import urljoin, urldefrag, urlparse

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; SEOAuditBot/0.1)"


def fetch(session, url):
    start = time.time()
    try:
        r = session.get(url, timeout=20, allow_redirects=True)
        return r, time.time() - start
    except requests.RequestException as e:
        return e, time.time() - start


def analyze(url, r, elapsed, host):
    row = {"url": url, "status": "", "final_url": "", "time_s": round(elapsed, 2),
           "title": "", "title_len": 0, "meta_desc": "", "meta_len": 0, "h1_count": 0,
           "h1": "", "canonical": "", "robots_meta": "", "schema_types": "",
           "word_count": 0, "imgs_no_alt": 0, "lang": "", "og_title": ""}
    links = []
    if isinstance(r, Exception):
        row["status"] = f"ERR {type(r).__name__}"
        return row, links
    row["status"] = r.status_code
    row["final_url"] = r.url
    ctype = r.headers.get("content-type", "")
    if r.status_code != 200 or "html" not in ctype:
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
    row["h1"] = h1s[0].get_text(strip=True) if h1s else ""
    c = soup.find("link", rel="canonical")
    row["canonical"] = c.get("href", "") if c else ""
    rm = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    row["robots_meta"] = rm.get("content", "") if rm else ""
    og = soup.find("meta", property="og:title")
    row["og_title"] = og.get("content", "") if og else ""
    row["lang"] = (soup.html.get("lang", "") if soup.html else "")
    types = []
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s.string or "")
        except ValueError:
            continue
        for item in (data if isinstance(data, list) else [data]):
            if isinstance(item, dict):
                types.append(str(item.get("@type", "?")))
    row["schema_types"] = ",".join(types)
    row["imgs_no_alt"] = sum(1 for i in soup.find_all("img") if not (i.get("alt") or "").strip())
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    row["word_count"] = len(soup.get_text(" ", strip=True).split())
    for a in soup.find_all("a", href=True):
        href = urldefrag(urljoin(r.url, a["href"]))[0]
        p = urlparse(href)
        if p.scheme in ("http", "https") and p.netloc == host:
            links.append(href)
    return row, links


def crawl(start, max_pages):
    host = urlparse(start).netloc
    s = requests.Session()
    s.headers["User-Agent"] = UA
    seen, queue, rows, inlinks = {start}, deque([start]), [], {}
    while queue and len(rows) < max_pages:
        url = queue.popleft()
        r, el = fetch(s, url)
        row, links = analyze(url, r, el, host)
        rows.append(row)
        for l in links:
            inlinks[l] = inlinks.get(l, 0) + 1
            if l not in seen and not re.search(r"\.(jpg|jpeg|png|webp|gif|svg|pdf|css|js|ico|xml)$", l, re.I):
                seen.add(l)
                queue.append(l)
    for row in rows:
        row["inlinks"] = inlinks.get(row["url"], 0)
    return rows, s, host


def site_files(s, base):
    out = {}
    for path in ("/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/llms.txt"):
        r, _ = fetch(s, base + path)
        if isinstance(r, Exception):
            out[path] = f"ERR {type(r).__name__}"
        else:
            snippet = r.text[:300].replace("\n", " | ") if r.status_code == 200 else ""
            out[path] = (r.status_code, r.headers.get("content-type", ""), snippet)
    return out


def issues(rows):
    ok = [r for r in rows if r["status"] == 200 and r["title"] != "" or r["status"] == 200]
    found = []

    def add(sev, msg, urls):
        if urls:
            found.append((sev, msg, urls))

    add("HIGH", "Non-200 / errored pages", [f'{r["url"]} -> {r["status"]}' for r in rows if r["status"] != 200])
    add("HIGH", "Missing title", [r["url"] for r in ok if not r["title"]])
    add("HIGH", "Missing meta description", [r["url"] for r in ok if not r["meta_desc"]])
    add("HIGH", "noindex pages", [r["url"] for r in ok if "noindex" in r["robots_meta"].lower()])
    add("MED", "Missing H1", [r["url"] for r in ok if r["h1_count"] == 0])
    add("MED", "Multiple H1", [r["url"] for r in ok if r["h1_count"] > 1])
    add("MED", "Missing canonical", [r["url"] for r in ok if not r["canonical"]])
    add("MED", "Title too long (>60) or short (<25)", [f'{r["url"]} ({r["title_len"]})' for r in ok if r["title"] and not 25 <= r["title_len"] <= 60])
    add("MED", "Meta description outside 70-160 chars", [f'{r["url"]} ({r["meta_len"]})' for r in ok if r["meta_desc"] and not 70 <= r["meta_len"] <= 160])
    titles = {}
    for r in ok:
        titles.setdefault(r["title"], []).append(r["url"])
    add("MED", "Duplicate titles", [f"{t!r}: {u}" for t, u in titles.items() if t and len(u) > 1])
    add("MED", "No structured data (JSON-LD)", [r["url"] for r in ok if not r["schema_types"]])
    add("LOW", "Thin content (<300 words)", [f'{r["url"]} ({r["word_count"]})' for r in ok if r["word_count"] < 300])
    add("LOW", "Images without alt", [f'{r["url"]} ({r["imgs_no_alt"]})' for r in ok if r["imgs_no_alt"]])
    add("LOW", "Orphan-ish pages (<=1 internal inlink)", [r["url"] for r in ok if r["inlinks"] <= 1])
    add("LOW", "Slow response (>2s)", [f'{r["url"]} ({r["time_s"]}s)' for r in ok if r["time_s"] > 2])
    add("LOW", "Missing html lang", [r["url"] for r in ok if not r["lang"]])
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--max", type=int, default=200)
    a = ap.parse_args()
    start = a.url.rstrip("/")
    rows, s, host = crawl(start, a.max)
    files = site_files(s, f"{urlparse(start).scheme}://{host}")

    cols = list(rows[0].keys())
    with open("pages.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    lines = [f"# SEO audit: {host}", f"Pages crawled: {len(rows)}", "", "## Site files"]
    for k, v in files.items():
        lines.append(f"- `{k}`: {v}")
    lines += ["", "## Issues"]
    for sev, msg, urls in issues(rows):
        lines.append(f"\n### [{sev}] {msg} ({len(urls)})")
        lines += [f"- {u}" for u in urls[:25]]
        if len(urls) > 25:
            lines.append(f"- ... +{len(urls) - 25} more (see pages.csv)")
    with open("report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
