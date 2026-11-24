import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Capabilities, PinInfo, WifiNetwork, WledConfig, WledInfo } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as devices from "../db/devices";

const fakes: FakeWled[] = [];

async function setup(opts?: Parameters<typeof startFakeWled>[1], now?: () => Date) {
  const t = makeTestApp({ now });
  const f = await startFakeWled(seeds.backyard, opts);
  fakes.push(f);
  const row = t.addFake(f, seeds.backyard);
  return { t, f, row, url: (path: string) => `/api/devices/${row.id}/${path}` };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const sjsFile = (name: string): string => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8");

describe("GET info", () => {
  // Fails if the route stops reading /json/info or stops recording that the device answered.
  it("returns the device info and updates last_seen", async () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const { t, row, url } = await setup(undefined, () => now);
    const res = await t.inject({ method: "GET", url: url("info") });
    expect(res.statusCode).toBe(200);
    expect(res.json<WledInfo>()).toMatchObject({ ver: seeds.backyard.info.ver, mac: seeds.backyard.info.mac });
    expect(devices.get(t.db, row.id)!.lastSeen).toBe(now.toISOString());
  });
});

describe("GET info address recovery", () => {
  // Fails if readInfo writes back the address it started with and undoes the one recovery just saved.
  it("keeps the address that deviceRequest recovered", async () => {
    const t = makeTestApp({ resolveA: async () => "127.0.0.1" });
    const f = await startFakeWled(seeds.backyard);
    fakes.push(f);
    const row = t.addFake(f, seeds.backyard, "backyard.local");
    devices.setLastIp(t.db, row.id, "127.0.0.2", new Date());
    const res = await t.inject({ method: "GET", url: `/api/devices/${row.id}/info` });
    expect(res.statusCode).toBe(200);
    expect(devices.get(t.db, row.id)!.lastIp).toBe("127.0.0.1");
  });
});

describe("GET config", () => {
  // Fails if the reply carries a key outside WledConfig (def.ps, hw.btn, if.mqtt) or drops one of its subtrees.
  it("returns only the subtrees of WledConfig, with def as on and bri", async () => {
    const { t, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("config") });
    expect(res.statusCode).toBe(200);
    const body = res.json<WledConfig>();
    expect(Object.keys(body).sort()).toEqual(["ap", "def", "hw", "id", "if", "light", "nw"]);
    expect(body.def).toEqual({ on: seeds.backyard.cfg.def.on, bri: seeds.backyard.cfg.def.bri });
    expect(Object.keys(body.hw)).toEqual(["led"]);
    expect(Object.keys(body.if)).toEqual(["sync"]);
  });
});

describe("GET capabilities", () => {
  // Fails if the reply is not the parsed Capabilities (or leaks maxGpio).
  it("returns the parsed capabilities", async () => {
    const { t, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("capabilities") });
    const body = res.json<Capabilities>();
    expect(res.statusCode).toBe(200);
    expect(body.limits.maxLeds).toBe(16384);
    expect(body).not.toHaveProperty("maxGpio");
  });

  // Fails if a locked device's 401 is not passed on as pin_required.
  it("returns 401 pin_required for a locked device", async () => {
    const { t, url } = await setup({ pin: "1234" });
    const res = await t.inject({ method: "GET", url: url("capabilities") });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "pin_required" });
  });

  // Fails if an unsupported text is answered with defaults, or with another status.
  it("returns 502 device_error when the firmware is not supported", async () => {
    const { t, url } = await setup({ sjs: sjsFile("sjsUnsupported.txt") });
    const res = await t.inject({ method: "GET", url: url("capabilities") });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "device_error", message: expect.stringContaining("firmware version") });
  });
});

describe("GET pins", () => {
  // Fails if a 17 device's own /json/pins list is not passed on.
  it("returns the device's list on 17", async () => {
    const { t, url } = await setup({ version: "17" });
    const res = await t.inject({ method: "GET", url: url("pins") });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ pins: PinInfo[] }>().pins).toEqual(seeds.backyard.pins);
  });

  // Fails if 0.15 (no /json/pins) is not served from s.js and the config.
  it("builds the list from the capabilities on 0.15", async () => {
    const { t, url } = await setup({ version: "0.15" });
    const res = await t.inject({ method: "GET", url: url("pins") });
    const { pins } = res.json<{ pins: PinInfo[] }>();
    expect(res.statusCode).toBe(200);
    expect(pins.find((p) => p.p === 16)).toMatchObject({ a: true, n: "LEDs" });
    expect(pins.some((p) => p.p === 6)).toBe(false);
  });

  // Fails if the 0.15 path skips the PIN-gated s.js read.
  it("returns 401 pin_required for a locked 0.15 device", async () => {
    const { t, url } = await setup({ version: "0.15", pin: "1234" });
    const res = await t.inject({ method: "GET", url: url("pins") });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "pin_required" });
  });
});

describe("POST networks/scan", () => {
  // Fails if the first empty replies are returned as the result, or the extra fields are not dropped.
  it("repeats until the scan has results", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "POST", url: url("networks/scan") });
    expect(res.json<{ networks: WifiNetwork[] }>().networks).toEqual(seeds.backyard.networks);
    expect(f.requests.filter((r) => r.path === "/json/net")).toHaveLength(3);
  });

  // Fails if the scan asks more or fewer than 10 times, or errors on an empty result.
  it("returns an empty list after 10 requests", async () => {
    const { t, f, url } = await setup({ scanEmptyCalls: 99 });
    const res = await t.inject({ method: "POST", url: url("networks/scan") });
    expect(res.json()).toEqual({ networks: [] });
    expect(f.requests.filter((r) => r.path === "/json/net")).toHaveLength(10);
  });
});

describe("routes", () => {
  // Fails if the old WLED presets endpoint comes back.
  it("has no presets endpoint", async () => {
    const { t, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("presets") });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  const endpoints: [string, string][] = [
    ["GET", "info"],
    ["GET", "config"],
    ["GET", "capabilities"],
    ["GET", "pins"],
    ["POST", "networks/scan"],
  ];

  // Fails if an endpoint reads a device that is not saved.
  it.each(endpoints)("%s %s returns 404 not_found for an unknown device", async (method, path) => {
    const { t } = await setup();
    const res = await t.inject({ method: method as "GET" | "POST", url: `/api/devices/nope/${path}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  // Fails if an endpoint maps a device that does not answer to anything but 504 device_offline.
  it.each(endpoints)("%s %s returns 504 device_offline for an offline device", async (method, path) => {
    const { t, f, url } = await setup();
    f.setMode("timeout");
    const res = await t.inject({ method: method as "GET" | "POST", url: url(path) });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: "device_offline" });
  });
});
