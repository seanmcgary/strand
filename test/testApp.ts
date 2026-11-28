import type { DatabaseSync } from "node:sqlite";
import { onTestFinished } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp, type AppDeps } from "../server/app";
import { loadConfig } from "../server/config";
import { openDb } from "../server/db/database";
import * as devices from "../server/db/devices";
import type { DeviceRow } from "../server/db/devices";
import type { FakeWled } from "./fakeWled";
import type { Seed } from "./fixtures/seeds";

export type TestApp = {
  app: FastifyInstance;
  deps: AppDeps;
  db: DatabaseSync;
  /** Saves the fake as a device: its seed's MAC and name, at 127.0.0.1 on its port. */
  addFake(f: FakeWled, seed: Seed, host?: string): DeviceRow;
  /** `app.inject` with the headers the request guard wants. */
  inject(opts: InjectOptions): Promise<LightMyRequestResponse>;
};

/** Builds the app on an in-memory database, with mDNS doubles and short time limits. */
export function makeTestApp(
  opts: {
    browse?: AppDeps["mdns"]["browseWled"];
    resolveA?: AppDeps["mdns"]["resolveA"];
    now?: () => Date;
    wledPort?: number;
    allowedHosts?: string[] | "*";
    /** Both default to 60 s, so no other test sees a timer fire. */
    flashMs?: number;
    startupDelayMs?: number;
  } = {},
): TestApp {
  const db = openDb(":memory:");
  const deps: AppDeps = {
    config: {
      ...loadConfig({}),
      deviceTimeoutMs: 300,
      discoveryWindowMs: 50,
      allowedHosts: opts.allowedHosts ?? [],
    },
    db,
    mdns: {
      browseWled: opts.browse ?? (async () => []),
      resolveA: opts.resolveA ?? (async () => null),
    },
    now: opts.now ?? (() => new Date()),
    wledPort: opts.wledPort ?? 80,
    scanDelayMs: 1,
    logger: false,
    flashMs: opts.flashMs ?? 60_000,
    startupDelayMs: opts.startupDelayMs ?? 60_000,
  };
  const app = buildApp(deps);
  onTestFinished(async () => {
    await app.close();
    db.close();
  });

  return {
    app,
    deps,
    db,
    addFake(f, seed, host = "127.0.0.1") {
      return devices.insert(
        db,
        { mac: seed.info.mac, name: seed.info.name, host, port: f.port, lastIp: "127.0.0.1" },
        deps.now(),
      );
    },
    inject(injectOpts) {
      const hasBody = injectOpts.payload !== undefined || injectOpts.body !== undefined;
      return app.inject({
        ...injectOpts,
        headers: {
          host: "localhost",
          "x-strand-request": "1",
          ...(hasBody ? { "content-type": "application/json" } : {}),
          ...injectOpts.headers,
        },
      });
    },
  };
}
