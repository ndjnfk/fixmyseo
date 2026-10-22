// Express app factory. index.js listens; tests import createApp() and listen on a random port.
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { config, isProd } from "./config.js";
import { db } from "./db.js";
import { log } from "./lib/logger.js";
import { redis } from "./lib/queue.js";
import { aiHealth } from "./ai/ollama.js";
import { apiLimiter } from "./middleware/ratelimit.js";
import { authRoutes } from "./routes/auth.js";
import { orgRoutes } from "./routes/orgs.js";
import { siteRoutes } from "./routes/sites.js";
import { crawlRoutes } from "./routes/crawl.js";
import { keywordRoutes } from "./routes/keywords.js";
import { aiRoutes } from "./routes/ai.js";
import { billingRoutes, webhookHandler } from "./routes/billing.js";
import { auditRoutes } from "./routes/audit.js";
import { googleRoutes } from "./routes/google.js";
import { automationRoutes } from "./routes/automation.js";
import { insightRoutes } from "./routes/insights.js";
import { SsrfError } from "./lib/ssrf.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", isProd ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.WEB_ORIGIN, exposedHeaders: ["RateLimit", "RateLimit-Policy"] }));

  // webhooks need the raw body for signature verification: mount before the JSON parser
  app.post("/billing/webhook/:provider", express.raw({ type: "*/*", limit: "1mb" }), webhookHandler);

  app.use(express.json({ limit: "1mb" }));
  app.use(apiLimiter);
  app.use((req, _res, next) => { log.debug("request", { method: req.method, path: req.path }); next(); });

  app.get("/health", (_req, res) => res.json({ ok: true, version: "2.0.0" }));
  app.get("/health/ready", async (_req, res) => {
    const out = { ok: true, db: false, redis: false, ai: false, model: config.OLLAMA_MODEL };
    try { await db.query("SELECT 1"); out.db = true; } catch { out.ok = false; }
    try { out.redis = (await redis().ping()) === "PONG"; } catch { /* reported below */ }
    if (!out.redis) out.ok = false;
    try { const h = await aiHealth(); out.ai = h.ok; out.ai_reason = h.reason; } catch { out.ai = false; }
    res.status(out.ok ? 200 : 503).json(out);
  });

  authRoutes(app);
  orgRoutes(app);
  auditRoutes(app);
  billingRoutes(app);
  siteRoutes(app);
  crawlRoutes(app);
  keywordRoutes(app);
  aiRoutes(app);
  const google = googleRoutes(app);
  automationRoutes(app, { google });
  insightRoutes(app);

  app.use((_req, res) => res.status(404).json({ error: "not found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid input", details: err.issues });
    if (err instanceof SsrfError) return res.status(400).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "payload too large" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid json" });
    log.error("unhandled error", { err, path: req.path });
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
