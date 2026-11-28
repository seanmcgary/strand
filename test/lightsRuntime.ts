import { onTestFinished, vi } from "vitest";
import type { ServerDeps } from "../server/app";
import type { DeviceRow } from "../server/db/devices";
import { createLightsRuntime, type LightsRuntime, type RuntimeLog } from "../server/lights/runtime";
import { startFakeWled, type FakeWled } from "./fakeWled";
import { seeds, type Seed } from "./fixtures/seeds";
import { makeTestApp } from "./testApp";

export type LightsSetup = { f: FakeWled; row: DeviceRow; rt: LightsRuntime; deps: ServerDeps; warn: ReturnType<typeof vi.fn> };

/** A fake device saved in a test app, and a lights runtime of its own with these timings and a log stub. */
export async function startLights(
  opts: { startupDelayMs?: number; flashMs?: number; seed?: Seed; warn?: () => void } = {},
): Promise<LightsSetup> {
  const seed = opts.seed ?? seeds.backyard;
  const t = makeTestApp();
  const f = await startFakeWled(seed);
  onTestFinished(() => f.close());
  const row = t.addFake(f, seed);
  const warn = vi.fn(opts.warn);
  const timing = { startupDelayMs: opts.startupDelayMs ?? 60_000, flashMs: opts.flashMs ?? 60_000 };
  const rt = createLightsRuntime({ ...t.deps, ...timing }, { warn } as unknown as RuntimeLog);
  onTestFinished(() => rt.close());
  return { f, row, rt, warn, deps: { ...t.deps, ...timing, lights: rt } };
}

/** The `psave: 250` requests the fake got. */
export const psaves = (f: FakeWled) =>
  f.requests.filter((r) => r.method === "POST" && r.path === "/json/state" && (r.body as { psave?: unknown } | undefined)?.psave === 250);

/** The backyard seed on an ESP8266 (10 240-byte JSON buffer) with more LEDs and segments. */
export const bigSeed = (maxseg: number): Seed => ({
  ...seeds.backyard,
  info: { ...seeds.backyard.info, arch: "esp8266", leds: { ...seeds.backyard.info.leds, count: 1200, maxseg } },
});
