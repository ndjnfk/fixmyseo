"""Keyword research: seeds -> Google Autocomplete expansion -> scoring (demand, difficulty, priority) + page mapping."""
import math
import re
import time
from typing import List, Literal, Optional

from urllib.parse import urlparse

import requests
from pydantic import BaseModel

from .llm import ask, configured

AUTOCOMPLETE = "https://suggestqueries.google.com/complete/search"


class Seeds(BaseModel):
    seeds: List[str]


class Keyword(BaseModel):
    term: str
    cluster: str
    intent: Literal["informational", "commercial", "transactional", "navigational"]
    target_url: Optional[str]
    priority: int


class KeywordPlan(BaseModel):
    keywords: List[Keyword]


def autocomplete(term: str, lang: str, country: str) -> List[str]:
    try:
        r = requests.get(AUTOCOMPLETE, params={"client": "firefox", "q": term, "hl": lang, "gl": country},
                         timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code != 200:
            return []
        data = r.json()
        return [s for s in data[1] if isinstance(s, str)][:10]
    except (requests.RequestException, ValueError, IndexError):
        return []


def _site_context(domain, pages, notes):
    lines = [f"Website: {domain}"]
    if notes:
        lines.append(f"Owner notes about the business/audience: {notes}")
    lines.append("Pages (url | title | h1):")
    for p in pages[:80]:
        lines.append(f"- {p['url']} | {p.get('title') or ''} | {p.get('h1') or ''}")
    return "\n".join(lines)


def research(domain, language, country, pages, gsc_queries, existing, notes="",
             seeds=None, exclude=None, ignored=None, extra_terms=None):
    ctx = _Ctx(domain, language, country, pages, gsc_queries, notes, seeds or [], exclude or [], ignored or [])
    if not configured():
        return basic_research(ctx, extra_terms or [])
    site = _site_context(domain, pages, notes)
    ai_seeds = ask(
        "You are an SEO strategist. Reply only with the requested JSON.",
        f"{site}\n\nPropose 12 short seed search phrases (2-4 words) that real users in country "
        f"'{country}' would type into Google, in language '{language}', to find what this site offers. "
        "Prefer specific topics over generic ones.",
        Seeds, effort="low", max_tokens=4000,
    ).seeds
    found = ctx.expand(ctx.user_seeds + [s.lower() for s in ai_seeds])

    gsc_lines = [f"- {q} (impr {g['impr']:.0f}, clicks {g['clicks']:.0f}, pos {g['pos']})"
                 for q, g in list(ctx.gsc.items())[:150]]
    plan = ask(
        "You are an SEO strategist building a keyword plan. Be realistic: a small site wins long-tail, "
        "specific queries, not head terms. Reply only with the requested JSON.",
        f"{site}\n\nSearch Console queries already bringing impressions:\n" + ("\n".join(gsc_lines) or "(none yet)")
        + "\n\nGoogle Autocomplete suggestions:\n" + "\n".join(f"- {s}" for s in sorted(found))
        + "\n\nAlready tracked keywords (do not repeat): " + ", ".join(existing[:200])
        + "\n\nReturn up to 60 keywords worth targeting. For each: group related terms under a short cluster "
        "name (one cluster = one page/article), set search intent, set target_url to the existing page above "
        "that should rank for it, or null if no page fits (a content gap that needs a new article). "
        "priority 1-10 (10 = best mix of relevance, realistic difficulty and demand). Only include terms "
        "genuinely relevant to this business.",
        KeywordPlan, effort="medium",
    )
    out = []
    for k in plan.keywords:
        term = k.term.lower().strip()
        if ctx.blocked(term):
            continue
        ctx.probe(term)
        row = ctx.score(term, llm_priority=k.priority)
        row.update(cluster=k.cluster[:255], intent=k.intent)
        if k.target_url:
            row.update(target_url=k.target_url, status="existing")
        out.append(row)
    have = {r["term"] for r in out}
    return out + score_terms(ctx, [t for t in extra_terms or [] if t.lower() not in have])


# ---------- AI key ke bina: GSC + Autocomplete + simple rules ----------
STOP = {"the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "by", "is", "are", "your", "my",
        "at", "from", "how", "what", "why", "best", "online", "free", "ka", "ki", "ke", "se", "me", "mein", "hai"}
TRANSACTIONAL = {"buy", "price", "cost", "order", "book", "booking", "shop", "purchase", "cheap", "discount", "near"}
# har site par hote hain; inse bane seeds bekaar suggestions laate hain
GENERIC = {"about", "contact", "pricing", "price", "prices", "plans", "plan", "services", "service", "reviews",
           "review", "testimonials", "testimonial", "client", "clients", "customer", "shop", "store", "blog", "blogs",
           "login", "home", "faq", "faqs", "privacy", "policy", "terms", "term", "account", "register", "us", "our",
           "page", "welcome"}
COMMERCIAL = {"best", "top", "vs", "review", "reviews", "compare", "alternative"}
QUESTION = {"how", "what", "why", "when", "which", "who", "kya", "kaise", "kyu", "kyon", "kab", "kaun"}
# suggestion mein ye extra shabd aana normal hai; inke alawa 2+ anjaan shabd = kisi aur ka naam/brand
MODIFIERS = {"hindi", "english", "india", "indian", "online", "free", "app", "website", "site", "near", "nearby",
             "today", "tomorrow", "2025", "2026", "2027", "pdf", "meaning", "benefit", "list", "idea", "tip", "guide",
             "beginner", "kid", "women", "men", "top", "cheap", "price", "cost", "vs", "review", "example",
             "software", "tool", "calculator", "chart", "date", "birth", "time", "name", "number", "liye", "course",
             "service", "book", "booking", "telugu", "tamil", "marathi", "bengali", "gujarati", "kannada",
             "malayalam", "punjabi", "urdu", "step", "easy", "simple", "quick", "daily", "weekly", "monthly",
             "yearly", "first", "new", "latest", "download", "kaise", "kya", "karein"}


def _stem(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def _tokens(text):
    return {_stem(w) for w in re.findall(r"[a-z0-9ऀ-ॿ]+", (text or "").lower()) if w not in STOP and len(w) > 1}


def _intent(term, brand):
    w = set(re.findall(r"[a-zऀ-ॿ]+", term.lower()))
    if brand and brand in term.lower().replace(" ", ""):
        return "navigational"
    if w & TRANSACTIONAL:
        return "transactional"
    if w & COMMERCIAL:
        return "commercial"
    return "informational"


def _clean_title(t):
    # "Kundli Online | Vidushiji" -> "Kundli Online"
    return re.split(r"\s[|\-–—:]\s", t or "")[0].strip()


class _Ctx:
    """Ek research run ka data: site vocabulary, GSC numbers, autocomplete signals."""

    def __init__(self, domain, language, country, pages, gsc_queries, notes, seeds, exclude, ignored):
        self.language, self.country = language, country
        self.brand = domain.split(".")[0].lower()
        self.exclude = [e.strip().lower() for e in exclude if e.strip()]
        self.ignored = {t.strip().lower() for t in ignored}
        self.user_seeds = [s.strip().lower() for s in seeds if s.strip()]
        self.page_tok = [(p["url"], _tokens(f"{p.get('title')} {p.get('h1')} {urlparse(p['url']).path.replace('-', ' ')}"))
                         for p in pages]
        self.page_titles = [t for p in pages for t in (_clean_title(p.get("title")), p.get("h1")) if t]
        self.gsc = {}
        for q in sorted(gsc_queries, key=lambda q: -float(q.get("impressions") or 0)):
            pos = q.get("position")
            self.gsc[q["query"].lower()] = {
                "impr": float(q.get("impressions") or 0), "clicks": float(q.get("clicks") or 0),  # MySQL SUM string aata hai
                "pos": float(pos) if pos is not None else None, "page": q.get("top_page") or None}
        vocab = set()
        for _, t in self.page_tok:
            vocab |= t
        for text in [notes, *self.user_seeds, *self.gsc]:
            vocab |= _tokens(text)
        self.vocab = vocab - GENERIC
        self.signals = {}  # term -> {"rank": best autocomplete rank, "bare": plain seed se aaya?, "hits": n}

    # brand ke hisse ("vidushi", "ji") topic nahi hain, warna logon ke naam wale suggestions aate hain
    def topical(self, text):
        return {w for w in _tokens(text) - GENERIC if w not in self.brand}

    def blocked(self, term):
        t = term.lower()
        if t in self.ignored:
            return True
        words = set(re.findall(r"[a-z0-9ऀ-ॿ]+", t))
        return any((e in t) if " " in e else (e in words) for e in self.exclude)

    def junk(self, sug, seed):
        extra = self.topical(sug) - self.topical(seed) - self.vocab - MODIFIERS
        return len(extra) >= 2

    def observe(self, term, rank, bare):
        s = self.signals.setdefault(term, {"rank": 99, "bare": False, "hits": 0})
        s["rank"] = min(s["rank"], rank)
        s["bare"] = s["bare"] or bare
        s["hits"] += 1

    def expand(self, seeds, budget=80):
        """Seed + modifiers ko Autocomplete se phailao. Returns {suggestion: seed}."""
        pats = ["{}", "{} for", "best {}", "how to {}"]
        if self.country == "IN" or self.language == "hi":
            pats.append("{} in hindi")
        found, reqs = {}, 0
        for seed in dict.fromkeys(seeds):
            for i, pat in enumerate(pats):
                if reqs >= budget:
                    return found
                reqs += 1
                for rank, sug in enumerate(autocomplete(pat.format(seed), self.language, self.country)):
                    sug = sug.lower().strip()
                    if (len(sug.split()) < 2 or self.blocked(sug) or not (self.topical(sug) & self.topical(seed))
                            or self.junk(sug, seed)):
                        continue
                    self.observe(sug, rank, i == 0)
                    found.setdefault(sug, seed)
                time.sleep(0.3)  # Google ke saath polite raho
        return found

    def probe(self, term):
        """Akele term ki demand: kya Google khud ise suggest karta hai?"""
        if term in self.signals:
            return
        sugs = [s.lower().strip() for s in autocomplete(term, self.language, self.country)]
        if term in sugs:
            self.observe(term, sugs.index(term), True)
        elif sugs:
            self.observe(term, 6, False)
        time.sleep(0.3)

    def best_page(self, term):
        t = _tokens(term)
        if not t:
            return None, 0
        # /blog, /pricing jaise listing pages tabhi target jab term mein wahi shabd ho
        cands = [(u, pt) for u, pt in self.page_tok
                 if (urlparse(u).path.strip("/").split("/")[-1] or "home") not in GENERIC
                 or urlparse(u).path.strip("/").split("/")[-1] in t]
        # tie par zyada specific page (kam tokens) jeete
        best = max(((len(t & pt) / len(t), len(t & pt) / max(1, len(pt)), u) for u, pt in cands),
                   default=(0, 0, None))
        return best[2], best[0]

    def cluster_for(self, term, seeds):
        t = self.topical(term)
        best = max(((len(t & self.topical(s)), -len(s), s) for s in seeds), default=(0, 0, None))
        return best[2] if best[0] else _clean_title(term)

    def score(self, term, llm_priority=None):
        g = self.gsc.get(term)
        sig = self.signals.get(term)
        demand, src = None, None
        if sig:
            demand = (80 - 6 * sig["rank"]) if sig["bare"] else (55 - 4 * sig["rank"])
            demand = max(5, min(90, demand + min(15, 5 * (sig["hits"] - 1))))
            src = "est"
        if g and g["impr"] > 0:
            real = min(100, round(25 * math.log10(g["impr"] + 1) + (10 if g["clicks"] else 0)))
            demand, src = max(demand or 0, real), "gsc"

        # difficulty: sirf andaza (free data mein competition nahi milta)
        ws = set(re.findall(r"[a-zऀ-ॿ]+", term))
        diff = {1: 85, 2: 65, 3: 45, 4: 35}.get(len(term.split()), 25)
        if ws & (TRANSACTIONAL | COMMERCIAL):
            diff += 10
        if ws & QUESTION:
            diff -= 10
        pos = g["pos"] if g else None
        if pos:
            diff = min(diff, 25) if pos <= 10 else min(diff, 40) if pos <= 20 else diff if pos <= 50 else diff + 5
        diff = max(5, min(95, diff))

        top = self.topical(term)
        rel = len(top & self.vocab) / len(top) if top else 0
        intent = _intent(term, self.brand)
        score = 0.4 * (demand if demand is not None else 15) + 0.35 * (100 - diff) + 0.25 * rel * 100
        # site se anjaan shabd ("philippines", competitor brand) = shayad off-topic
        score -= 12 * len(top - self.vocab - MODIFIERS)
        if pos and 4 <= pos <= 20:
            score += 15  # quick win
        if intent == "navigational":
            score -= 25  # apna brand naam: pehle se rank karta hai
        pri = max(1, min(10, round(score / 10)))
        if llm_priority:
            pri = max(1, min(10, round((pri + llm_priority) / 2)))

        if g and g["page"] and pos and pos <= 30:
            target, cov = g["page"], 1.0
        else:
            target, cov = self.best_page(term)
        status = "existing" if target and cov >= 0.75 else "partial" if target and cov >= 0.5 else "gap"
        return {"term": term[:255], "intent": intent, "target_url": target if status != "gap" else None,
                "priority": pri, "status": status, "demand": demand, "demand_src": src, "difficulty": diff,
                "position": pos}


def score_terms(ctx, terms):
    """Haath se jode gaye keywords: bina expansion ke score karo."""
    seeds = ctx.user_seeds + [t.lower() for t in ctx.page_titles]
    out = []
    for term in dict.fromkeys(t.lower().strip() for t in terms if t.strip()):
        if term in ctx.ignored:
            continue
        ctx.vocab |= ctx.topical(term)  # user ne khud joda = site ke liye relevant
        ctx.probe(term)
        row = ctx.score(term)
        row["cluster"] = ctx.cluster_for(term, seeds)[:255]
        out.append(row)
    return out


def score_only(domain, language, country, pages, gsc_queries, notes, seeds, terms):
    ctx = _Ctx(domain, language, country, pages, gsc_queries, notes, seeds, [], [])
    return score_terms(ctx, terms)


def basic_research(ctx, extra_terms):
    seeds = list(ctx.user_seeds)
    for q in list(ctx.gsc)[:10]:
        if ctx.topical(q):
            seeds.append(q)
    for text in ctx.page_titles:
        text = text.strip().lower()
        if 1 < len(text.split()) <= 5 and ctx.topical(text):
            seeds.append(text)
    seeds = list(dict.fromkeys(seeds))

    terms = ctx.expand(seeds)
    for q in ctx.gsc:
        terms.setdefault(q, None)
    out = []
    for term, seed in terms.items():
        if ctx.blocked(term) or not ctx.topical(term):
            continue
        row = ctx.score(term)
        row["cluster"] = (seed or ctx.cluster_for(term, seeds))[:255]
        out.append(row)
    out.sort(key=lambda k: (-k["priority"], -(k["demand"] or 0)))
    out = out[:200]
    have = {r["term"] for r in out}
    return out + score_terms(ctx, [t for t in extra_terms if t.lower() not in have])
