// Environment validation. Fails fast with a readable message instead of a 500 at the first request.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// .env (api/.env, then project-root .env) for local dev; Docker/PM2 pass real env vars.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(here, "../.env"), path.resolve(here, "../../.env")]) {
  if (fs.existsSync(p)) {
    try { process.loadEnvFile(p); } catch { /* ignore malformed */ }
  }
}

const bool = z.string().default("0").transform((v) => ["1", "true", "yes"].includes(v.toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("seo"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  JWT_SECRET: z.string().min(8).default("change-me"),
  JWT_TTL: z.string().default("7d"),
  ENC_KEY: z.string().regex(/^([0-9a-f]{64})?$/i, "ENC_KEY must be 64 hex chars").default(""),
  INTERNAL_KEY: z.string().default(""),

  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  APP_URL: z.string().default("http://localhost:3000"),

  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:1.5b"),
  AI_ENABLED: z.string().default("1").transform((v) => !["0", "false", "no"].includes(v.toLowerCase())),
  AI_TIMEOUT_MS: z.coerce.number().int().default(180_000),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().default(6000),

  CRAWL_MAX_PAGES_DEFAULT: z.coerce.number().int().default(200),
  CRAWL_HARD_MAX_PAGES: z.coerce.number().int().default(2000),
  CRAWL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  CRAWL_MAX_BYTES: z.coerce.number().int().default(2_000_000),
  CRAWL_DELAY_MS: z.coerce.number().int().default(150),
  CRAWL_USER_AGENT: z.string().default("Mozilla/5.0 (compatible; FixMySEOBot/2.0; +https://fixmyseo.local/bot)"),
  ALLOW_PRIVATE_HOSTS: bool,
  AUTOCOMPLETE_ENABLED: z.string().default("1").transform((v) => !["0", "false", "no"].includes(v.toLowerCase())),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/google/callback"),

  BILLING_PROVIDER: z.string().default("test"),
  BILLING_WEBHOOK_SECRET: z.string().default(""),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(20),
  WORKER_CONCURRENCY_CRAWL: z.coerce.number().int().default(2),
  WORKER_CONCURRENCY_AI: z.coerce.number().int().default(1),
  SCHEDULER_ENABLED: z.string().default("1").transform((v) => !["0", "false", "no"].includes(v.toLowerCase())),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment: ${msg}`);
}
export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";

if (isProd) {
  const problems = [];
  if (config.JWT_SECRET.length < 32 || config.JWT_SECRET === "change-me") problems.push("JWT_SECRET must be >= 32 random chars");
  if (config.ALLOW_PRIVATE_HOSTS) problems.push("ALLOW_PRIVATE_HOSTS is not allowed in production");
  if (!config.ENC_KEY) problems.push("ENC_KEY (64 hex) is required in production");
  if (!/^https:\/\//.test(config.WEB_ORIGIN)) problems.push("WEB_ORIGIN must be https in production");
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join("; ")}`);
}
