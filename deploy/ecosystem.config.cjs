// PM2 config: pm2 start ecosystem.config.cjs
// Saari settings project root ki .env file se aati hain.
const fs = require("fs");
const path = require("path");

// file deploy/ ke andar ho ya seedha project root mein, dono chalega
const root = fs.existsSync(path.join(__dirname, ".env")) ? __dirname : path.resolve(__dirname, "..");
// Next.js app ka folder "web" ho ya "html"
const webDir = ["web", "html"].find((d) => fs.existsSync(path.join(root, d, "package.json"))) || "web";
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
// khaali secret ke saath chalne se login 500 deta hai; start se pehle hi saaf bata do
const missing = ["APP_URL", "DB_USER", "DB_PASSWORD", "JWT_SECRET", "INTERNAL_KEY"].filter((k) => !env[k]);
if (missing.length) throw new Error(`.env mein ye values khaali hain: ${missing.join(", ")}`);
if ((env.ENC_KEY || "").length !== 64) throw new Error(".env mein ENC_KEY 64 characters ka hona chahiye (openssl rand -hex 32)");
const APP_URL = env.APP_URL.replace(/\/$/, "");
// APP_URL=https://example.com/fixmyseo  ->  web "/fixmyseo" ke neeche chalta hai
const BASE_PATH = new URL(APP_URL).pathname.replace(/\/$/, "");

const shared = { INTERNAL_KEY: env.INTERNAL_KEY };

module.exports = {
  apps: [
    {
      name: "fixmyseo-api",
      cwd: path.join(root, "api"),
      script: "src/index.js",
      env: {
        ...shared,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: env.API_PORT || "4100",
        DB_HOST: env.DB_HOST || "127.0.0.1",
        DB_PORT: env.DB_PORT || "3306",
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD,
        DB_NAME: env.DB_NAME || "seo",
        JWT_SECRET: env.JWT_SECRET,
        ENC_KEY: env.ENC_KEY,
        INTEL_URL: `http://127.0.0.1:${env.INTEL_PORT || "8100"}`,
        WEB_ORIGIN: APP_URL,
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || "",
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || "",
        GOOGLE_REDIRECT_URI: `${APP_URL}/api/google/callback`,
      },
    },
    {
      name: "fixmyseo-intel",
      cwd: path.join(root, "intel"),
      script: ".venv/bin/uvicorn",
      args: `app.main:app --host 127.0.0.1 --port ${env.INTEL_PORT || "8100"}`,
      interpreter: "none",
      env: {
        ...shared,
        API_URL: `http://127.0.0.1:${env.API_PORT || "4100"}`,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "",
        LLM_MODEL: env.LLM_MODEL || "claude-opus-5-5",
      },
    },
    {
      name: "fixmyseo-web",
      cwd: path.join(root, webDir),
      script: "node_modules/next/dist/bin/next",
      args: `start -H 127.0.0.1 -p ${env.WEB_PORT || "3100"}`,
      env: { NODE_ENV: "production", NEXT_PUBLIC_BASE_PATH: BASE_PATH },
    },
  ],
};
