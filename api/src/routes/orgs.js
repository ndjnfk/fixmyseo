// Organization membership. The owner is immutable here; roles are viewer/editor/admin.
import { z } from "zod";
import { db, one } from "../db.js";
import { audit } from "../lib/audit.js";
import { auth, requireRole, wrap } from "../middleware/auth.js";

const assignable = z.enum(["viewer", "editor", "admin"]);

export function orgRoutes(app) {
  app.get("/orgs", auth, wrap(async (req, res) => {
    const [rows] = await db.query(
      "SELECT o.id, o.name, m.role, (o.id=?) active FROM org_members m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=? ORDER BY o.id",
      [req.org.id, req.user.id]);
    res.json(rows.map((r) => ({ ...r, active: Boolean(r.active) })));
  }));

  app.patch("/org", auth, requireRole("admin"), wrap(async (req, res) => {
    const b = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    await db.query("UPDATE orgs SET name=? WHERE id=?", [b.name, req.org.id]);
    await audit(req, "org.rename", { entity: "org", entityId: req.org.id, meta: { name: b.name } });
    res.json({ ok: true });
  }));

  app.get("/org/members", auth, requireRole("admin"), wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT u.id, u.email, m.role, m.created_at, u.last_login_at FROM org_members m JOIN users u ON u.id=m.user_id
       WHERE m.org_id=? ORDER BY FIELD(m.role,'owner','admin','editor','viewer'), u.email`, [req.org.id]);
    res.json(rows);
  }));

  app.post("/org/members", auth, requireRole("admin"), wrap(async (req, res) => {
    const b = z.object({ email: z.string().trim().toLowerCase().email(), role: assignable }).parse(req.body);
    const u = await one("SELECT id FROM users WHERE email=? AND status='active'", [b.email]);
    if (!u) return res.status(404).json({ error: "no account with that email; ask them to register first" });
    const [r] = await db.query("INSERT IGNORE INTO org_members (org_id, user_id, role) VALUES (?,?,?)", [req.org.id, u.id, b.role]);
    if (!r.affectedRows) return res.status(409).json({ error: "already a member" });
    await audit(req, "org.member_add", { entity: "user", entityId: u.id, meta: { role: b.role } });
    res.status(201).json({ ok: true, user_id: u.id });
  }));

  app.patch("/org/members/:userId", auth, requireRole("admin"), wrap(async (req, res) => {
    const b = z.object({ role: assignable }).parse(req.body);
    const m = await one("SELECT role FROM org_members WHERE org_id=? AND user_id=?", [req.org.id, req.params.userId]);
    if (!m) return res.status(404).json({ error: "not a member" });
    if (m.role === "owner") return res.status(400).json({ error: "the owner role cannot be changed" });
    await db.query("UPDATE org_members SET role=? WHERE org_id=? AND user_id=?", [b.role, req.org.id, req.params.userId]);
    await audit(req, "org.member_role", { entity: "user", entityId: req.params.userId, meta: { role: b.role } });
    res.json({ ok: true });
  }));

  app.delete("/org/members/:userId", auth, requireRole("admin"), wrap(async (req, res) => {
    const m = await one("SELECT role FROM org_members WHERE org_id=? AND user_id=?", [req.org.id, req.params.userId]);
    if (!m) return res.status(404).json({ error: "not a member" });
    if (m.role === "owner") return res.status(400).json({ error: "the owner cannot be removed" });
    await db.query("DELETE FROM org_members WHERE org_id=? AND user_id=?", [req.org.id, req.params.userId]);
    await audit(req, "org.member_remove", { entity: "user", entityId: req.params.userId });
    res.json({ ok: true });
  }));
}
