import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDb } from "./db/database";

const config = loadConfig(process.env);
fs.mkdirSync(config.dataDir, { recursive: true });
const app = buildApp({
  config,
  db: openDb(path.join(config.dataDir, "strand.db")),
  mdns: { browseWled: async () => [], resolveA: async () => null },
  now: () => new Date(),
  wledPort: 80,
  scanDelayMs: 1000,
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "server failed to start");
  process.exit(1);
}
