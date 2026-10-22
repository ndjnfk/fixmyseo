// Ollama client: JSON-schema constrained chat with timeouts, bounded output and one retry on invalid JSON.
import { config } from "../config.js";

export class AiError extends Error {
  constructor(msg, code = "AI_ERROR") { super(msg); this.name = "AiError"; this.code = code; }
}

let healthCache = { at: 0, value: null };

export async function aiHealth(force = false) {
  if (!config.AI_ENABLED) return { ok: false, reason: "disabled by AI_ENABLED=0" };
  if (!force && Date.now() - healthCache.at < 15_000 && healthCache.value) return healthCache.value;
  let value;
  try {
    const r = await fetch(`${config.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    const names = (j.models || []).map((m) => m.name);
    const want = config.OLLAMA_MODEL;
    const have = names.some((n) => n === want || n === `${want}:latest` || (!want.includes(":") && n.split(":")[0] === want));
    value = have
      ? { ok: true, model: want, models: names }
      : { ok: false, reason: `model ${want} is not pulled (run: ollama pull ${want})`, models: names };
  } catch (e) {
    value = { ok: false, reason: `ollama unreachable at ${config.OLLAMA_URL} (${e.name === "TimeoutError" ? "timeout" : e.message})` };
  }
  healthCache = { at: Date.now(), value };
  return value;
}

export function extractJson(text) {
  if (typeof text !== "string") throw new AiError("empty model output", "AI_BAD_JSON");
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = Math.min(...["{", "["].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))));
  if (first === Infinity) throw new AiError("no JSON in model output", "AI_BAD_JSON");
  const open = t[first], close = open === "{" ? "}" : "]";
  const last = t.lastIndexOf(close);
  if (last <= first) throw new AiError("unterminated JSON in model output", "AI_BAD_JSON");
  t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch (e) { throw new AiError(`invalid JSON from model: ${e.message}`, "AI_BAD_JSON"); }
}

/**
 * Ask the model for a JSON object matching `schema` (JSON schema). Returns { data, raw, model, durationMs, promptTokens, outputTokens }.
 */
export async function chatJson({ system, prompt, schema, maxTokens = 1024, temperature = 0.2, timeoutMs = config.AI_TIMEOUT_MS, model = config.OLLAMA_MODEL, retries = 1 }) {
  if (!config.AI_ENABLED) throw new AiError("AI is disabled", "AI_DISABLED");
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
    if (attempt > 0) messages.push({ role: "user", content: "Your previous reply was not valid JSON. Reply with ONLY the JSON object, no prose, no code fences." });
    let r;
    try {
      r = await fetch(`${config.OLLAMA_URL}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model, stream: false, format: schema || "json", messages,
          options: { temperature, num_predict: maxTokens, num_ctx: 8192 },
        }),
      });
    } catch (e) {
      throw new AiError(e.name === "TimeoutError" ? `model timed out after ${timeoutMs} ms` : `ollama unreachable: ${e.message}`, e.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_UNREACHABLE");
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new AiError(`ollama error ${r.status}: ${txt.slice(0, 200)}`, r.status === 404 ? "AI_MODEL_MISSING" : "AI_ERROR");
    }
    const j = await r.json();
    const content = j.message?.content ?? "";
    try {
      const data = extractJson(content);
      return {
        data, raw: content, model: j.model || model, durationMs: Date.now() - started,
        promptTokens: j.prompt_eval_count ?? null, outputTokens: j.eval_count ?? null, doneReason: j.done_reason || null, attempt,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
