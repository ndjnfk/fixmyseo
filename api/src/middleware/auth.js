// JWT auth + tenant resolution + role checks. The client never chooses an org it is not a member of.
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db, one } from "../db.js";

export const ROLES = ["viewer", "editor", "admin", "owner"];
const rank = (r) => ROLES.indexOf(r);

export const sign = (userId) => jwt.sign({ uid: userId }, config.JWT_SECRET, { expiresIn: config.JWT_TTL });

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  let payload;
  try {
    payload = jwt.verify(h.replace(/^Bearer /, ""), config.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "unauthorized", reason: e.message });
  }
  const user = await one("SELECT id, org_id, email, status, email_verified_at FROM users WHERE id=?", [payload.uid]);
  if (!user || user.status !== "active") return res.status(401).json({ error: "unauthorized", reason: "account unavailable" });

  const wanted = req.headers["x-org-id"] ? Number(req.headers["x-org-id"]) : user.org_id;
  if (!Number.isInteger(wanted) || wanted <= 0) return res.status(400).json({ error: "invalid org" });
  const m = await one(
    `SELECT m.role, o.id, o.name FROM org_members m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=? AND m.org_id=?`,
    [user.id, wanted]);
  if (!m) return res.status(403).json({ error: "forbidden", reason: "not a member of this organization" });

  req.user = { id: user.id, email: user.email, verified: Boolean(user.email_verified_at) };
  req.org = { id: m.id, name: m.name, role: m.role };
  next();
}

export const requireRole = (min) => (req, res, next) => {
  if (!req.org) return res.status(401).json({ error: "unauthorized" });
  if (rank(req.org.role) < rank(min)) return res.status(403).json({ error: "forbidden", reason: `requires ${min} role` });
  next();
};

/** Load a site owned by the active org, or send 404. Returns null when the response was already sent. */
export async function ownSite(req, res, id = req.params.id) {
  const site = await one("SELECT * FROM sites WHERE id=? AND org_id=?", [id, req.org.id]);
  if (!site) { res.status(404).json({ error: "not found" }); return null; }
  return site;
}

export { db };
