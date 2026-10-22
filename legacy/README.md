# Legacy (retired on 2026-10-19)

`intel/` was the Python FastAPI service (crawler, quality checks, keyword research via the paid Anthropic API) and
`audit.py` the original prototype. Both were ported to Node in `api/src/seo/*` and `api/src/ai/*` so the platform has
one language, BullMQ job retries, and no paid LLM. Kept for reference only; nothing imports this folder.
