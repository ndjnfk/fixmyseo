// AI worker: one Ollama call per job, schema-validated, metered, output lands in `suggestions` as proposed.
import { db, json, one } from "../db.js";
import { auditSystem } from "../lib/audit.js";
import { release, settle } from "../lib/quota.js";
import { AiError, chatJson } from "../ai/ollama.js";
import { SYSTEM, TASKS } from "../ai/prompts.js";
import { persistOutput, prepareTask } from "../ai/tasks.js";

export const aiHandlers = {
  async task(data, ctx) {
    const { orgId, siteId, aiJobId, task, period } = data;
    const site = await one("SELECT * FROM sites WHERE id=?", [siteId]);
    if (!site || site.org_id !== orgId) throw new Error("tenant mismatch");
    const aiJob = await one("SELECT * FROM ai_jobs WHERE id=? AND site_id=?", [aiJobId, siteId]);
    if (!aiJob) throw new Error("ai job not found");
    if (aiJob.status === "done") return { skipped: "already done" };
    aiJob.input = json(aiJob.input_json) || {};
    await db.query("UPDATE ai_jobs SET status='running', error=NULL WHERE id=?", [aiJobId]);
    const t = TASKS[task];
    if (!t) throw new AiError(`unknown task ${task}`, "AI_BAD_TASK");

    const { promptInput, meta } = await prepareTask(task, site, aiJob.input);
    await ctx.progress(20);
    const prompt = t.build(promptInput);
    const res = await chatJson({ system: SYSTEM, prompt, schema: t.schema, maxTokens: t.maxTokens });
    await ctx.progress(80);
    const parsed = t.validate.safeParse(res.data);
    if (!parsed.success) {
      const msg = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AiError(`model output failed validation: ${msg}`, "AI_INVALID_OUTPUT");
    }
    const output = t.post(parsed.data);
    const persisted = await persistOutput(task, site, aiJob, output, meta);
    await db.query(
      "UPDATE ai_jobs SET status='done', model=?, prompt_version=?, output_json=?, prompt_tokens=?, output_tokens=?, duration_ms=?, finished_at=NOW() WHERE id=?",
      [res.model, t.version, JSON.stringify({ ...output, _meta: meta, ...persisted }), res.promptTokens, res.outputTokens, res.durationMs, aiJobId]);
    await settle(orgId, "ai_ops", 1, 1, period);
    await auditSystem(orgId, "ai.task.done", { entity: "ai_job", entityId: aiJobId, meta: { task, model: res.model, duration_ms: res.durationMs, ...persisted } });
    return { ai_job_id: aiJobId, task, model: res.model, duration_ms: res.durationMs, ...persisted };
  },

  async "task:failed"(data, err) {
    const { orgId, aiJobId, period } = data;
    await db.query("UPDATE ai_jobs SET status='failed', error=?, finished_at=NOW() WHERE id=? AND status<>'done'", [String(err.message).slice(0, 1000), aiJobId]);
    await release(orgId, "ai_ops", 1, period);
  },
};
