import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import keywords, llm
from .audit import run_audit

INTERNAL_KEY = os.environ.get("INTERNAL_KEY", "internal-change-me")
API_URL = os.environ.get("API_URL", "http://localhost:4000")

app = FastAPI(title="SEO Intelligence")


class AuditRequest(BaseModel):
    run_id: int
    site_id: int
    url: str
    max_pages: int = 200


def _post(path, payload):
    return requests.post(f"{API_URL}{path}", json=payload,
                         headers={"x-internal-key": INTERNAL_KEY}, timeout=60)


def _do_audit(req: AuditRequest):
    try:
        _post("/internal/audit-started", {"run_id": req.run_id})
        pages, issues, summary = run_audit(req.url, min(req.max_pages, 500))
        _post("/internal/audit-result", {"run_id": req.run_id, "pages": pages,
                                         "issues": issues, "summary": summary})
    except Exception as e:  # noqa: BLE001 - failure ko API tak pahunchana zaroori hai
        _post("/internal/audit-result", {"run_id": req.run_id, "error": str(e)[:500]})


@app.post("/audit")
def audit(req: AuditRequest, bg: BackgroundTasks, x_internal_key: str = Header(default="")):
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(403, "forbidden")
    bg.add_task(_do_audit, req)
    return {"accepted": True, "run_id": req.run_id}


def _check(key):
    if key != INTERNAL_KEY:
        raise HTTPException(403, "forbidden")


# LLM kaam lambe hote hain: background job + polling (API /jobs/{id} poll karta hai)
_pool = ThreadPoolExecutor(max_workers=3)
_jobs = {}
_lock = threading.Lock()


def _submit(fn):
    job_id = uuid.uuid4().hex
    with _lock:
        cutoff = time.time() - 6 * 3600
        for k in [k for k, v in _jobs.items() if v["at"] < cutoff]:
            del _jobs[k]
        _jobs[job_id] = {"status": "running", "at": time.time()}

    def run():
        try:
            out = {"status": "done", "result": fn()}
        except llm.LLMError as e:
            out = {"status": "error", "error": str(e)}
        except Exception as e:  # noqa: BLE001 - error API tak pahunchana zaroori hai
            out = {"status": "error", "error": f"{type(e).__name__}: {e}"[:500]}
        with _lock:
            _jobs[job_id].update(out)

    _pool.submit(run)
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str, x_internal_key: str = Header(default="")):
    _check(x_internal_key)
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


class KeywordRequest(BaseModel):
    domain: str
    language: str = "en"
    country: str = "IN"
    notes: str = ""
    pages: list = []
    gsc_queries: list = []
    existing: list = []
    seeds: list = []
    exclude: list = []
    ignored: list = []
    extra_terms: list = []


@app.post("/keywords")
def keyword_research(req: KeywordRequest, x_internal_key: str = Header(default="")):
    _check(x_internal_key)
    return _submit(lambda: {"mode": "ai" if llm.configured() else "basic", "keywords": keywords.research(
        req.domain, req.language, req.country, req.pages, req.gsc_queries, req.existing, req.notes,
        seeds=req.seeds, exclude=req.exclude, ignored=req.ignored, extra_terms=req.extra_terms)})


# haath se jode keywords: turant score (sirf 1 autocomplete call per term)
@app.post("/keywords/score")
def keyword_score(req: KeywordRequest, x_internal_key: str = Header(default="")):
    _check(x_internal_key)
    return {"keywords": keywords.score_only(req.domain, req.language, req.country, req.pages, req.gsc_queries,
                                            req.notes, req.seeds, req.extra_terms[:20])}


@app.get("/health")
def health():
    return {"ok": True, "llm": llm.configured(), "model": llm.MODEL}
