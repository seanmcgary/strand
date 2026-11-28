import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Service = { host: string; port: number; addresses?: string[] };

const fake = vi.hoisted(() => ({
  onFind: undefined as ((service: unknown) => void) | undefined,
  mdns: undefined as unknown as import("node:events").EventEmitter,
}));

vi.mock("bonjour-service", () => ({
  Bonjour: class {
    server = { mdns: fake.mdns };
    find(_opts: unknown, onUp: (service: unknown) => void) {
      fake.onFind = onUp;
      return { stop: () => undefined };
    }
    destroy() {}
  },
}));

import { browseWled } from "./mdns";

const service = (over: Partial<Service> = {}): Service => ({
  host: "wled.local",
  port: 80,
  addresses: ["192.168.1.5"],
  ...over,
});

describe("browseWled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.mdns = new EventEmitter();
    fake.onFind = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the services found so far when the socket errors", async () => {
    // Fails if browseWled stops listening for mdns socket errors.
    const pending = browseWled(5000);
    fake.onFind?.(service());
    fake.mdns.emit("error", new Error("EADDRINUSE"));
    await expect(pending).resolves.toEqual([{ host: "wled.local", port: 80, addresses: ["192.168.1.5"] }]);
  });

  it("caps the result at 128 services and drops one with an invalid port", async () => {
    // Fails if browseWled stops capping replies or validating ports.
    const pending = browseWled(1000);
    fake.onFind?.(service({ port: 0 }));
    for (let i = 0; i < 200; i++) {
      fake.onFind?.(service({ host: `wled-${i}.local` }));
    }
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result).toHaveLength(128);
    expect(result.every((s) => s.port === 80)).toBe(true);
  });
});
