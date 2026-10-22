// Structured JSON logs (one line per event). No secrets are ever passed in fields by convention.
import { config } from "../config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.LOG_LEVEL] ?? 20;
const REDACT = /(password|secret|token|authorization|refresh_token)/i;

function clean(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (REDACT.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { message: v.message, code: v.code, stack: config.NODE_ENV !== "production" ? v.stack : undefined };
    else out[k] = v;
  }
  return out;
}

function emit(level, msg, fields) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...clean(fields) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (msg, f) => emit("debug", msg, f),
  info: (msg, f) => emit("info", msg, f),
  warn: (msg, f) => emit("warn", msg, f),
  error: (msg, f) => emit("error", msg, f),
  child: (base) => ({
    debug: (m, f) => emit("debug", m, { ...base, ...f }),
    info: (m, f) => emit("info", m, { ...base, ...f }),
    warn: (m, f) => emit("warn", m, { ...base, ...f }),
    error: (m, f) => emit("error", m, { ...base, ...f }),
  }),
};
