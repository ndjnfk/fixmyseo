// Migration runner: applies db/migrations/*.sql in name order, records them in schema_migrations.
// Statements run one by one; "already exists" style errors on ALTER/CREATE are ignored so re-runs are safe
// (MySQL has no ADD COLUMN IF NOT EXISTS).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../../db/migrations");
const IGNORABLE = new Set([1050, 1060, 1061, 1091, 1826, 1022]); // table exists, dup column, dup key, can't drop, dup FK name, dup key

export function splitStatements(sql) {
  const out = [];
  let cur = "", inStr = null;
  const lines = sql.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/^\s*--.*$/, "");
    if (!line.trim() && !cur) continue;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        cur += ch;
        if (ch === inStr && line[i - 1] !== "\\") inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; cur += ch; continue; }
      if (ch === "-" && line[i + 1] === "-") break; // inline comment
      if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cur += "\n";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function migrate({ createDatabase = true, quiet = false } = {}) {
  if (createDatabase) {
    const admin = await mysql.createConnection({
      host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USER, password: config.DB_PASSWORD, multipleStatements: false,
    });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();
  }
  const conn = await mysql.createConnection({
    host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME,
  });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    const [done] = await conn.query("SELECT name FROM schema_migrations");
    const applied = new Set(done.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const ran = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      for (const stmt of splitStatements(sql)) {
        try {
          await conn.query(stmt);
        } catch (e) {
          if (IGNORABLE.has(e.errno)) continue;
          throw new Error(`migration ${f} failed: ${e.message}\n  in: ${stmt.slice(0, 200)}`);
        }
      }
      await conn.query("INSERT IGNORE INTO schema_migrations (name) VALUES (?)", [f]);
      ran.push(f);
      if (!quiet) log.info("migration applied", { name: f });
    }
    return ran;
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  migrate().then((ran) => {
    log.info("migrations up to date", { applied: ran.length });
    process.exit(0);
  }).catch((e) => { log.error("migration failed", { err: e }); process.exit(1); });
}
