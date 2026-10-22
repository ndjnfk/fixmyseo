"""Content/trust checks (E-E-A-T, YMYL): title/H1 focus, expert ki pehchaan, risky daave, Hindi content."""
import re
from urllib.parse import urlparse

CLAIM = re.compile(r"\b(guarantee[sd]?|guaranteed results?|100\s?% (?:results?|success|guaranteed|accurate|solution)|"
                   r"permanent (?:solution|cure)|instant results?|cures?|cured|miracle\w*)\b", re.I)
YMYL = re.compile(r"\b(health|disease|illness|medical|medicine|cancer|infertility|pregnan\w*|depression|"
                  r"legal|court|lawsuit|divorce case|financial|debt|loans?|money problems?)\b", re.I)
DISCLAIMER = re.compile(r"disclaimer|not a substitute|for guidance only|entertainment purposes|results may vary|"
                        r"consult (?:a|your) (?:doctor|lawyer|physician|professional)", re.I)
EXPERIENCE = re.compile(r"\b\d+\s*\+?\s*(?:years?|yrs)\b|\byears of (?:experience|practice)\b", re.I)
TRAINING = re.compile(r"\b(certified|certification|qualified|qualifications?|degree|diploma|trained|training|"
                      r"lineage|guru|studied|learned under|disciple)\b", re.I)
MEDIA = re.compile(r"\b(featured (?:in|on)|as seen (?:in|on)|awards?|interviewed|published in|press)\b", re.I)
NEGATION = re.compile(r"\b(not|no|never|don'?t|doesn'?t|cannot|can'?t|won'?t|without|nor)\b[^.!?]*$", re.I)
SOCIAL = re.compile(r"(instagram|facebook|youtube|linkedin|twitter|x)\.com/", re.I)
ABOUT = re.compile(r"^/(about|about-us|about-me|our-story|team|who-we-are)/?$", re.I)
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
PRIVATE = re.compile(r"/(account|login|signin|sign-in|signup|sign-up|register|admin|dashboard|cart|checkout)(/|$)", re.I)
STOP = {"the", "and", "for", "with", "your", "our", "you", "from", "online", "free", "best", "page", "home", "welcome"}


def _claims(text):
    """Promise words, par "not a guarantee" / "can a ritual guarantee...?" jaise inkaar ya sawaal nahi."""
    out = set()
    for m in CLAIM.finditer(text):
        before = text[max(0, m.start() - 60):m.start()]
        end = re.search(r"[.!?]", text[m.end():m.end() + 80])
        if NEGATION.search(before) or (end and end.group(0) == "?"):
            continue
        out.add(m.group(0).lower())
    return sorted(out)[:5]


def page_signals(soup, text):
    """Ek page ke signals; _analyze() har page par chalata hai."""
    # header/nav/footer ke logo aur icons photo nahi hain
    content_imgs = [i for i in soup.find_all("img") if not i.find_parent(["header", "nav", "footer"])]
    return {
        "claims": _claims(text),
        "ymyl_topics": sorted({m.group(0).lower() for m in YMYL.finditer(text)})[:5],
        "has_disclaimer": bool(DISCLAIMER.search(text)),
        "has_experience": bool(EXPERIENCE.search(text)),
        "has_training": bool(TRAINING.search(text)),
        "has_media": bool(MEDIA.search(text)),
        "hindi_chars": len(DEVANAGARI.findall(text)),
        "img_count": len(content_imgs),
        "social_links": sum(1 for a in soup.find_all("a", href=True) if SOCIAL.search(a["href"])),
    }


def _tokens(text, brand):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower())
            if len(w) > 2 and w not in STOP and w not in brand}


def _title_topic(title, brand):
    # "Vidushi Ji – Vedic Astrology, Kundli & Tarot" -> brand wala hissa hatao, baaki topic
    parts = [p for p in re.split(r"\s[|\-–—:]\s", title or "") if _tokens(p, brand)]
    return " ".join(parts).strip()


def quality_issues(rows, base):
    host = urlparse(base).netloc.replace("www.", "")
    brand = host.split(".")[0].lower()
    ok = [r for r in rows if r["status"] == 200 and not PRIVATE.search(urlparse(r["url"]).path)]
    out = []

    def add(type_, sev, url, detail):
        out.append({"type": type_, "severity": sev, "url": url, "detail": detail[:500]})

    # 1) title aur H1 alag cheez bol rahe hain
    for r in ok:
        topic, h1 = _title_topic(r["title"], brand), r.get("h1") or ""
        t, h = _tokens(topic, brand), _tokens(h1, brand)
        if not t or not h:
            continue
        cover = len(t & h) / len(t)
        home = urlparse(r["url"]).path.strip("/") == ""
        if (home and cover < 0.5) or cover == 0:
            add("title_h1_mismatch", "med" if home else "low", r["url"],
                f'Title says "{topic}" but H1 says "{h1}". Make both describe the same main topic.')

    # 2) expert / business ki pehchaan
    about = next((r for r in ok if ABOUT.match(urlparse(r["url"]).path)), None)
    social = sum(r.get("social_links", 0) for r in ok)
    if not about:
        add("about_missing", "med", base, "No About page found. Add one with the real person or team behind the site.")
    else:
        missing = []
        if (about.get("word_count") or 0) < 300:
            missing.append("a detailed bio (300+ words)")
        if not about.get("has_experience"):
            missing.append("years of experience")
        if not about.get("has_training"):
            missing.append("training, qualifications or lineage")
        if not about.get("has_media"):
            missing.append("media mentions or awards")
        if "Person" not in (about.get("schema_types") or ""):
            missing.append("Person schema")
        if not about.get("img_count"):
            missing.append("a real photo")
        if not social:
            missing.append("links to social profiles")
        if len(missing) >= 3:
            add("weak_author_identity", "med", about["url"], "About page is missing " + ", ".join(missing) + ".")

    # 3) guarantee/cure jaise daave, aur health/legal topics bina disclaimer
    site_disclaimer = any(r.get("has_disclaimer") for r in ok) or any("disclaimer" in r["url"].lower() for r in rows)
    for r in ok:
        if r.get("claims"):
            add("risky_claims", "high" if r.get("ymyl_topics") else "med", r["url"],
                "Uses promise words: " + ", ".join(f'"{c}"' for c in r["claims"]) + ".")
        if r.get("ymyl_topics") and not r.get("has_disclaimer") and not site_disclaimer:
            add("ymyl_no_disclaimer", "med", r["url"],
                "Talks about " + ", ".join(f'"{t}"' for t in r["ymyl_topics"]) + " but the site has no disclaimer.")
    return out


def site_stats(rows):
    ok = [r for r in rows if r["status"] == 200]
    return {
        "pages": len(ok),
        "hindi_pages": sum(1 for r in ok if r.get("hindi_chars", 0) > 100),
        "has_disclaimer": any(r.get("has_disclaimer") for r in ok),
        "social_links": sum(r.get("social_links", 0) for r in ok),
    }
