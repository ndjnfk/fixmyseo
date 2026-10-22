import { config } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./lib/logger.js";
import { migrate } from "./db/migrate.js";
import { closeDb } from "./db.js";
import { closeQueues } from "./lib/queue.js";

const app = createApp();
if (process.env.AUTO_MIGRATE !== "0") {
  try { await migrate({ quiet: true }); } catch (e) { log.error("migration failed at startup", { err: e }); process.exit(1); }
}
const server = app.listen(config.PORT, config.HOST, () =>
  log.info("api listening", { host: config.HOST, port: config.PORT, env: config.NODE_ENV }));

async function shutdown(sig) {
  log.info("shutting down", { sig });
  server.close();
  await closeQueues();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
