import mysql from "mysql2/promise";
import { config } from "./config.js";

export const db = mysql.createPool({
  host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USER, password: config.DB_PASSWORD,
  database: config.DB_NAME, connectionLimit: 10, charset: "utf8mb4", supportBigNumbers: true,
  timezone: "Z",
});

// Run fn inside a transaction; the connection is passed to fn.
export async function tx(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export const one = async (sql, params, conn = db) => (await conn.query(sql, params))[0][0] || null;
export const all = async (sql, params, conn = db) => (await conn.query(sql, params))[0];
export const json = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);
export const closeDb = () => db.end();
