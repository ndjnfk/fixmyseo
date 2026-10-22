// Scheduler: a repeatable "tick" decides which per-site jobs are due (plan-aware) and enqueues them.
// "site_job" runs the lighter jobs (alerts, keywords) in this queue; audits go to "crawl", GSC to "gsc".
import { db, one } from "../db.js";
import { DAILY, WEEKLY, getConfig, runSiteJob, startAudit } from "../lib/automation.js";
import { log } from "../lib/logger.js";
import { enqueue } from "../lib/queue.js";
import { planFor } from "../lib/quota.js";

const H = 3600 * 1000;

async function lastLog(siteId, job) {
  return one("SELECT created_at t, status FROM job_log WHERE site_id=? AND job=? ORDER BY id DESC LIMIT 1", [siteId, job]);
}

function due(last, everyMs) {
  if (!last) return true;
  const every = last.status === "error" ? 6 * H : everyMs;
  return Date.now() - new Date(last.t).getTime() >= every;
}

export async function tick() {
  const [sites] = await db.query("SELECT * FROM sites WHERE status='active'");
  let queued = 0;
  for (const site of sites) {
    try {
      const plan = await planFor(site.org_id);
      const cfg = getConfig(site);
      // scheduled audits are a plan feature: none | weekly | daily
      const sched = plan.limits.scheduled_audits || "none";
      if (sched !== "none") {
        const last = await one("SELECT started_at t FROM crawl_runs WHERE site_id=? ORDER BY id DESC LIMIT 1", [site.id]);
        const every = (sched === "daily" ? 24 : 7 * 24) * H - 30 * 60 * 1000;
        if (!last || Date.now() - new Date(last.t).getTime() >= every) {
          const r = await startAudit({ site });
          if (r.ok) queued++;
          else log.info("scheduled audit skipped", { site: site.id, reason: r.body.error });
        }
      }
      for (const job of DAILY) {
        if (!due(await lastLog(site.id, job), 24 * H - 30 * 60 * 1000)) continue;
        if (job === "gsc" || job === "indexing") {
          if (!site.gsc_property) continue;
          await enqueue({ orgId: site.org_id, siteId: site.id, queue: "gsc", type: job === "gsc" ? "sync" : "indexing", key: `${job}:${site.id}:${new Date().toISOString().slice(0, 10)}`, payload: {} });
        } else {
          await enqueue({ orgId: site.org_id, siteId: site.id, queue: "scheduler", type: "site_job", key: `${job}:${site.id}:${new Date().toISOString().slice(0, 10)}`, payload: { job } });
        }
        queued++;
      }
      for (const job of WEEKLY) {
        if (job === "audit") continue; // handled above by plan
        if (cfg.autonomy[job] === "off") continue;
        if (!due(await lastLog(site.id, job), 7 * 24 * H - 30 * 60 * 1000)) continue;
        await enqueue({ orgId: site.org_id, siteId: site.id, queue: "scheduler", type: "site_job", key: `${job}:${site.id}:${new Date().toISOString().slice(0, 10)}`, payload: { job } });
        queued++;
      }
    } catch (e) {
      log.error("tick site failed", { site: site.id, err: e });
    }
  }
  return { sites: sites.length, queued };
}

export const schedulerHandlers = {
  tick: () => tick(),
  async site_job(data) {
    const site = await one("SELECT id, org_id FROM sites WHERE id=?", [data.siteId]);
    if (!site || site.org_id !== data.orgId) throw new Error("tenant mismatch");
    return runSiteJob(data.siteId, data.job);
  },
};
