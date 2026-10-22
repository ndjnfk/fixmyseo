// PM2 config: pm2 start deploy/ecosystem.config.cjs
// Processes: API, worker (BullMQ), web (Next.js). Ollama runs as its own service (systemd) on the same host.
// All settings come from the project-root .env file.
const fs = require("fs");
const path = require("path");

const root = fs.existsSync(path.join(__dirname, ".env")) ? __dirname : path.resolve(__dirname, "..");
const webDir = ["web", "html"].find((d) => fs.existsSync(path.join(root, d, "package.json"))) || "web";
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const missing = ["APP_URL", "DB_USER", "DB_PASSWORD", "JWT_SECRET", "ENC_KEY", "REDIS_URL"].filter((k) => !env[k]);
if (missing.length) throw new Error(`.env is missing: ${missing.join(", ")}`);
if (env.ENC_KEY.length !== 64) throw new Error("ENC_KEY must be 64 hex chars (openssl rand -hex 32)");
if (env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 chars");
const APP_URL = env.APP_URL.replace(/\/$/, "");
const BASE_PATH = new URL(APP_URL).pathname.replace(/\/$/, "");

const shared = {
  NODE_ENV: "production",
  DB_HOST: env.DB_HOST || "127.0.0.1", DB_PORT: env.DB_PORT || "3306", DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD,
  DB_NAME: env.DB_NAME || "fixmyseo", REDIS_URL: env.REDIS_URL, JWT_SECRET: env.JWT_SECRET, ENC_KEY: env.ENC_KEY,
  WEB_ORIGIN: APP_URL, APP_URL,
  OLLAMA_URL: env.OLLAMA_URL || "http://127.0.0.1:11434", OLLAMA_MODEL: env.OLLAMA_MODEL || "qwen2.5:1.5b", AI_ENABLED: env.AI_ENABLED || "1",
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || "", GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI: `${APP_URL}/api/google/callback`,
  BILLING_PROVIDER: env.BILLING_PROVIDER || "test", BILLING_WEBHOOK_SECRET: env.BILLING_WEBHOOK_SECRET || "",
  LOG_LEVEL: env.LOG_LEVEL || "info",
};

module.exports = {
  apps: [
    { name: "fixmyseo-api", cwd: path.join(root, "api"), script: "src/index.js", env: { ...shared, HOST: "127.0.0.1", PORT: env.API_PORT || "4100" }, max_memory_restart: "400M" },
    { name: "fixmyseo-worker", cwd: path.join(root, "api"), script: "src/worker.js", env: { ...shared, AUTO_MIGRATE: "0" }, max_memory_restart: "800M" },
    {
      name: "fixmyseo-web", cwd: path.join(root, webDir), script: "node_modules/next/dist/bin/next",
      args: `start -H 127.0.0.1 -p ${env.WEB_PORT || "3100"}`, env: { NODE_ENV: "production", NEXT_PUBLIC_BASE_PATH: BASE_PATH },
    },
  ],
};
