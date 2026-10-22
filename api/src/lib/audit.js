// Audit log: who did what, in which org. Never throws (logging must not break the request).
import { db } from "../db.js";
import { log } from "./logger.js";

export async function audit(req, action, { entity = null, entityId = null, meta = null } = {}) {
  return write({
    orgId: req.org?.id ?? null, userId: req.user?.id ?? null, action, entity, entityId, meta,
    ip: (req.ip || "").slice(0, 64),
  });
}

export async function auditSystem(orgId, action, { entity = null, entityId = null, meta = null } = {}) {
  return write({ orgId, userId: null, action, entity, entityId, meta, ip: "system" });
}

async function write({ orgId, userId, action, entity, entityId, meta, ip }) {
  try {
    await db.query(
      "INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, meta_json, ip) VALUES (?,?,?,?,?,?,?)",
      [orgId, userId, action.slice(0, 60), entity, entityId == null ? null : String(entityId).slice(0, 64),
        meta == null ? null : JSON.stringify(meta), ip]);
  } catch (e) {
    log.warn("audit write failed", { err: e.message, action });
  }
}
