import { z } from "zod";
import { db, json } from "../db.js";
import { auth, requireRole, wrap } from "../middleware/auth.js";

export function auditRoutes(app) {
  app.get("/audit-log", auth, requireRole("admin"), wrap(async (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().optional() }).parse(req.query);
    const [rows] = await db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.meta_json, a.ip, a.created_at, u.email
       FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.org_id=? ${q.before ? "AND a.id < ?" : ""} ORDER BY a.id DESC LIMIT ?`,
      q.before ? [req.org.id, q.before, q.limit] : [req.org.id, q.limit]);
    res.json(rows.map((r) => ({ ...r, meta: json(r.meta_json), meta_json: undefined })));
  }));
}
