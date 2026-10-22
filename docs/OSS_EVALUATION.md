# Open-source evaluation and licences

Policy: only permissive licences (MIT / Apache-2.0 / BSD / ISC) are linked into this codebase. Copyleft projects may
be *run* alongside but their code is not copied. Nothing proprietary is copied, and we do not claim any proprietary
keyword-volume or backlink database. Licences below are as published at the time of writing; re-verify before release.

## Reused libraries (npm)
| Package | Licence | Used for |
|---|---|---|
| express, cors, helmet, express-rate-limit | MIT | HTTP layer |
| zod | MIT | validation |
| mysql2 | MIT | MySQL driver |
| bullmq, ioredis | MIT | queues |
| cheerio | MIT | HTML parsing |
| robots-parser | MIT | robots.txt |
| bcryptjs, jsonwebtoken | MIT | auth |
| next, react | MIT | dashboard |

## Local LLM
| Component | Licence | Decision |
|---|---|---|
| Ollama server | MIT | used |
| qwen2.5 (1.5b / 3b / 7b) | Apache-2.0 | **default model** (permissive, multilingual incl. Hindi) |
| llama3.2 / llama3.1 | Llama Community License (usage restrictions, attribution) | optional, not default |
| gemma2 | Gemma Terms of Use (restrictions) | not used |

## SEO projects reviewed (not copied)
| Project | Licence | Notes |
|---|---|---|
| Google Lighthouse | Apache-2.0 | Could be run as an optional performance check (CLI). Not embedded in v2 (Chrome dependency). |
| SEOnaut (Go crawler) | MIT | Good reference for issue taxonomy; we wrote our own checks in JS. |
| Screaming Frog SEO Spider | proprietary | Not used, nothing copied. |
| Serposcope / SERP scrapers | MIT / various | Rejected: Google SERP scraping violates ToS; we use Search Console only. |
| Matomo | GPL-3.0 | Not linked (copyleft). |
| Semrush / Ahrefs data | proprietary | Not used; the LLM must not invent volumes or backlinks. |

## Data sources we use
* Google Search Console API (official, free, user-consented OAuth) for clicks / impressions / position (**observed**).
* Google URL Inspection API (official, quota-limited) for index status.
* Google Autocomplete suggestions, rate-limited and marked **estimated**; opt-out via settings.
* The customer's own site (crawled with robots.txt respect).
