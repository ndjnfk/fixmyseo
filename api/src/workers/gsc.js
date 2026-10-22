// Search Console worker: sync + indexing, with quota-aware backoff (429/5xx are retried by BullMQ).
import { one } from "../db.js";
import { runSiteJob } from "../lib/automation.js";
import { GscError } from "../lib/google.js";
import { UnrecoverableError } from "bullmq";

async function guard(data) {
  const site = await one("SELECT * FROM sites WHERE id=?", [data.siteId]);
  if (!site || site.org_id !== data.orgId) throw new UnrecoverableError("tenant mismatch");
  return site;
}

const wrapGsc = (job) => async (data) => {
  await guard(data);
  try {
    return await runSiteJob(data.siteId, job);
  } catch (e) {
    // permanent auth/permission errors should not burn retries
    if (e instanceof GscError && !e.retryable) throw new UnrecoverableError(e.message);
    throw e;
  }
};

export const gscHandlers = {
  sync: wrapGsc("gsc"),
  indexing: wrapGsc("indexing"),
};
