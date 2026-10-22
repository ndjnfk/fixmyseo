// Register / login / me / password reset / email verification.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config.js";
import { db, one, tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { sendMail } from "../lib/mailer.js";
import { auth, sign, wrap } from "../middleware/auth.js";
import { authLimiter } from "../middleware/ratelimit.js";
import { planFor } from "../lib/quota.js";

const BCRYPT_ROUNDS = 12;
const email = z.string().trim().toLowerCase().email().max(255);
const password = z.string().min(8).max(200);
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

async function issueToken(userId, type, ttlMs) {
  const raw = crypto.randomBytes(32).toString("hex");
  await db.query("UPDATE user_tokens SET used_at=NOW() WHERE user_id=? AND type=? AND used_at IS NULL", [userId, type]);
  await db.query("INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES (?,?,?,FROM_UNIXTIME(?))",
    [userId, type, sha(raw), Math.floor((Date.now() + ttlMs) / 1000)]);
  return raw;
}

async function consumeToken(raw, type) {
  const row = await one("SELECT * FROM user_tokens WHERE token_hash=? AND type=? AND used_at IS NULL AND expires_at > NOW()", [sha(raw), type]);
  if (!row) return null;
  await db.query("UPDATE user_tokens SET used_at=NOW() WHERE id=?", [row.id]);
  return row;
}

export function authRoutes(app) {
  app.post("/auth/register", authLimiter, wrap(async (req, res) => {
    const b = z.object({ email, password, orgName: z.string().trim().min(1).max(200) }).parse(req.body);
    if (await one("SELECT id FROM users WHERE email=?", [b.email])) return res.status(409).json({ error: "email already registered" });
    const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
    const ids = await tx(async (conn) => {
      const [o] = await conn.query("INSERT INTO orgs (name, plan) VALUES (?, 'free')", [b.orgName]);
      const [u] = await conn.query("INSERT INTO users (org_id, email, password_hash, role) VALUES (?,?,?,'owner')", [o.insertId, b.email, hash]);
      await conn.query("INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,'owner')", [o.insertId, u.insertId]);
      await conn.query("INSERT INTO subscriptions (org_id, plan_id, status, provider) SELECT ?, id, 'active', 'test' FROM plans WHERE code='free'", [o.insertId]);
      return { org: o.insertId, user: u.insertId };
    });
    req.org = { id: ids.org }; req.user = { id: ids.user };
    await audit(req, "auth.register", { entity: "user", entityId: ids.user });
    res.status(201).json({ token: sign(ids.user) });
  }));

  app.post("/auth/login", authLimiter, wrap(async (req, res) => {
    const b = z.object({ email, password: z.string().max(200) }).parse(req.body);
    const u = await one("SELECT * FROM users WHERE email=?", [b.email]);
    const ok = u && u.status === "active" && (await bcrypt.compare(b.password, u.password_hash));
    if (!ok) {
      await bcrypt.compare(b.password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid").catch(() => {});
      return res.status(401).json({ error: "invalid credentials" });
    }
    await db.query("UPDATE users SET last_login_at=NOW() WHERE id=?", [u.id]);
    req.org = { id: u.org_id }; req.user = { id: u.id };
    await audit(req, "auth.login", { entity: "user", entityId: u.id });
    res.json({ token: sign(u.id) });
  }));

  app.get("/me", auth, wrap(async (req, res) => {
    const [orgs] = await db.query(
      "SELECT o.id, o.name, m.role FROM org_members m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=? ORDER BY o.id", [req.user.id]);
    const plan = await planFor(req.org.id);
    res.json({
      user: { id: req.user.id, email: req.user.email, email_verified: req.user.verified },
      org: { ...req.org, plan: plan.code, plan_name: plan.name, limits: plan.limits, subscription_status: plan.status },
      orgs, ai_enabled: config.AI_ENABLED,
    });
  }));

  // Always 200: do not reveal whether the email exists.
  app.post("/auth/forgot", authLimiter, wrap(async (req, res) => {
    const b = z.object({ email }).parse(req.body);
    const u = await one("SELECT id, email FROM users WHERE email=? AND status='active'", [b.email]);
    if (u) {
      const raw = await issueToken(u.id, "reset", 60 * 60 * 1000);
      await sendMail({
        to: u.email, subject: "Reset your FixMySEO password",
        text: `Open this link within 1 hour to set a new password:\n${config.APP_URL}/reset?token=${raw}\n\nIf you did not ask for this, ignore this email.`,
      });
    }
    res.json({ ok: true });
  }));

  app.post("/auth/reset", authLimiter, wrap(async (req, res) => {
    const b = z.object({ token: z.string().length(64), password }).parse(req.body);
    const t = await consumeToken(b.token, "reset");
    if (!t) return res.status(400).json({ error: "invalid or expired token" });
    await db.query("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(b.password, BCRYPT_ROUNDS), t.user_id]);
    req.user = { id: t.user_id };
    await audit(req, "auth.password_reset", { entity: "user", entityId: t.user_id });
    res.json({ ok: true });
  }));

  app.post("/auth/verify/request", auth, wrap(async (req, res) => {
    if (req.user.verified) return res.json({ ok: true, already: true });
    const raw = await issueToken(req.user.id, "verify", 24 * 60 * 60 * 1000);
    await sendMail({
      to: req.user.email, subject: "Verify your FixMySEO email",
      text: `Confirm your email within 24 hours:\n${config.APP_URL}/verify?token=${raw}`,
    });
    res.json({ ok: true });
  }));

  app.post("/auth/verify", authLimiter, wrap(async (req, res) => {
    const b = z.object({ token: z.string().length(64) }).parse(req.body);
    const t = await consumeToken(b.token, "verify");
    if (!t) return res.status(400).json({ error: "invalid or expired token" });
    await db.query("UPDATE users SET email_verified_at=NOW() WHERE id=?", [t.user_id]);
    res.json({ ok: true });
  }));
}
