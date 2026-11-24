import { DatabaseSync } from "node:sqlite";
import { buildApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig(process.env);
const app = buildApp({
  config,
  db: new DatabaseSync(":memory:"),
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
