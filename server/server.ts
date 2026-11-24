import fs from "node:fs";
import path from "node:path";
import { pino } from "pino";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDb } from "./db/database";
import { browseWled, resolveA } from "./mdns";

const config = loadConfig(process.env);

try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const app = buildApp({
    config,
    db: openDb(path.join(config.dataDir, "strand.db")),
    mdns: { browseWled, resolveA },
    now: () => new Date(),
    wledPort: 80,
    scanDelayMs: 1000,
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  // The app's logger does not exist yet when the data directory or the
  // database fails, so startup errors use a plain pino logger in the same format.
  pino().error({ err }, "server failed to start");
  process.exit(1);
}
