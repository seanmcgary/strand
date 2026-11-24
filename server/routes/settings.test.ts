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

describe("PATCH config", () => {
  const writes = (f: FakeWled) => f.requests.filter((r) => r.method === "POST");
  const sig = (f: FakeWled) => f.requests.map((r) => `${r.method} ${r.path}`);

  // Fails if the write sends only the changed leaf, or more than one POST, or a key the body did not touch.
  it("sends one POST with the full merged hw and returns the re-read config", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { hw: { led: { maxpwr: 850 } } } });
    expect(res.statusCode).toBe(200);
    expect(res.json<WledConfig>().hw.led.maxpwr).toBe(850);
    expect(writes(f)).toHaveLength(1);
    const body = writes(f)[0]!.body as { hw: { led: { maxpwr: number }; btn?: unknown } };
    expect(Object.keys(body)).toEqual(["hw"]);
    expect(body.hw.led.maxpwr).toBe(850);
    expect(body.hw.btn).toEqual((seeds.backyard.cfg.hw as unknown as { btn: unknown }).btn);
  });

  // Fails if the write rebuilds def from the body only and drops the boot preset the device has.
  it("keeps the device's def.ps when only def.bri changes", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { def: { bri: 200 } } });
    expect(res.statusCode).toBe(200);
    expect((writes(f)[0]!.body as { def: object }).def).toEqual({ ...seeds.backyard.cfg.def, bri: 200 });
  });

  // Fails if a Wi-Fi change does not reread the config and then reboot, in that order, or leaves pending_reboot set.
  it("reboots after a new SSID and clears pending_reboot", async () => {
    const { t, f, row, url } = await setup();
    const ins = [...seeds.backyard.cfg.nw.ins, { ssid: "Other", pskl: 0, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }];
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins } } });
    expect(res.statusCode).toBe(200);
    expect(sig(f)).toEqual(["GET /json/cfg", "POST /json/cfg", "GET /json/cfg", "POST /json/state"]);
    expect(f.requests[3]!.body).toEqual({ rb: true });
    expect(devices.get(t.db, row.id)!.pendingReboot).toEqual([]);
  });

  // Fails if a failed reboot fails the write, or does not leave "Wi-Fi" pending.
  it("returns the config and keeps Wi-Fi pending when the reboot fails", async () => {
    const { t, f, url } = await setup();
    f.failNext("timeout", { method: "POST", path: "/json/state" });
    const ins = [...seeds.backyard.cfg.nw.ins, { ssid: "Other", pskl: 0, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }];
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins } } });
    expect(res.statusCode).toBe(200);
    const pending = await t.inject({ method: "GET", url: url("pending-reboot") });
    expect(pending.json<string[]>()).toContain("Wi-Fi");
  });

  // Fails if a write that does not touch hw or light resets the firmware's reset-on-missing keys (cfg.cpp:183,189,531-532).
  it("carries rgbwm, fps and gamma from the device, and no hw.led.ins, on a hostname-only write", async () => {
    const { t, f, url } = await setup();
    (f.cfg.hw as { led: Record<string, unknown> }).led.rgbwm = 3;
    (f.cfg.hw as { led: Record<string, unknown> }).led.fps = 60;
    f.cfg.light = { ...(f.cfg.light as object), gc: { bri: 2.2, col: 1.5, val: 2.8 } };
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { id: { mdns: "porch" } } });
    expect(res.statusCode).toBe(200);
    expect(writes(f)[0]!.body).toEqual({
      id: { name: seeds.backyard.cfg.id.name, mdns: "porch" },
      hw: { led: { rgbwm: 3, fps: 60 } },
      light: { gc: { bri: 2.2, col: 1.5, val: 2.8 } },
    });
    const after = f.cfg as { hw: { led: { ins: unknown[] } } };
    expect(after.hw.led.ins).toHaveLength(seeds.backyard.cfg.hw.led.ins.length);
  });

  // Fails if a hw write sends hw.led.ins (which re-initialises the buses) when the request did not change it.
  it("leaves hw.led.ins out of a hw write that does not change it", async () => {
    const { t, f, url } = await setup();
    await t.inject({ method: "PATCH", url: url("config"), payload: { hw: { led: { maxpwr: 850 } } } });
    expect((writes(f)[0]!.body as { hw: { led: object } }).hw.led).not.toHaveProperty("ins");
  });

  // Fails if a request value for fps loses to the device's value.
  it("lets the request override a carried key", async () => {
    const { t, f, url } = await setup();
    (f.cfg.hw as { led: Record<string, unknown> }).led.fps = 60;
    await t.inject({ method: "PATCH", url: url("config"), payload: { hw: { led: { fps: 30 } } } });
    expect((writes(f)[0]!.body as { hw: { led: { fps: number } } }).hw.led.fps).toBe(30);
  });

  // Fails if a failed reboot returns something other than the re-read config.
  it("returns the re-read config when the reboot fails", async () => {
    const { t, f, url } = await setup();
    f.failNext("timeout", { method: "POST", path: "/json/state" });
    const ins = [...seeds.backyard.cfg.nw.ins, { ssid: "Other", pskl: 0, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }];
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins } } });
    expect(res.json<WledConfig>().nw.ins.map((e) => e.ssid)).toContain("Other");
  });

  // Fails if a hostname change does not set pending_since.
  it("sets pending_since when a hostname change is held", async () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const { t, row, url } = await setup(undefined, () => now);
    await t.inject({ method: "PATCH", url: url("config"), payload: { id: { mdns: "porch" } } });
    expect(devices.get(t.db, row.id)!.pendingSince).toBe(now.toISOString());
  });

  // Fails if a hostname change reboots at once, or the pending list is not cleared once the device restarts.
  it("holds a hostname change as pending until the device restarts", async () => {
    let now = new Date("2026-11-24T12:00:00Z");
    const { t, f, row, url } = await setup(undefined, () => now);
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { id: { mdns: "porch" } } });
    expect(res.statusCode).toBe(200);
    expect(f.requests.some((r) => r.path === "/json/state")).toBe(false);
    expect((await t.inject({ method: "GET", url: url("pending-reboot") })).json()).toEqual(["hostname"]);

    now = new Date(now.getTime() + 10_000);
    f.restart();
    expect((await t.inject({ method: "GET", url: url("pending-reboot") })).json()).toEqual([]);
    expect(devices.get(t.db, row.id)!.pendingReboot).toEqual([]);
  });

  // Fails if a locked device lets the write go on to the reboot, or changes pending_reboot.
  it("returns pin_required and sends no reboot when the device is locked", async () => {
    const { t, f, row, url } = await setup({ pin: "1234" });
    const ins = [...seeds.backyard.cfg.nw.ins, { ssid: "Other", pskl: 0, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }];
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins } } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "pin_required" });
    expect(f.requests.some((r) => r.path === "/json/state")).toBe(false);
    expect(devices.get(t.db, row.id)!.pendingReboot).toEqual([]);
  });

  // Fails if an offline device returns anything but 504 or the write still sends a request.
  it("returns 504 when the device does not answer", async () => {
    const { t, f, url } = await setup();
    f.setMode("timeout");
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { hw: { led: { maxpwr: 850 } } } });
    expect(res.statusCode).toBe(504);
    expect(writes(f)).toHaveLength(0);
  });

  // Fails if a failed re-read is swallowed and the reboot still goes out.
  it("returns device_offline and sends no reboot when the re-read times out", async () => {
    const { t, f, url } = await setup();
    f.failNext("timeout", { method: "GET", path: "/json/cfg", skip: 1 });
    const ins = [...seeds.backyard.cfg.nw.ins, { ssid: "Other", pskl: 0, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }];
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins } } });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: "device_offline" });
    expect(f.requests.some((r) => r.path === "/json/state")).toBe(false);
  });

  // Fails if the route sends a shrunk network list instead of refusing it.
  it("returns 422 unsupported_change for a shorter nw.ins and sends no POST", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { nw: { ins: [] } } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "unsupported_change" });
    expect(writes(f)).toHaveLength(0);
  });

  // Fails if the body check accepts a key outside CONFIG_KEYS, a non-object, or any def key but on and bri.
  it.each([
    ["an unlisted top-level key", { ota: { lock: false } }],
    ["an array", []],
    ["a non-object subtree", { hw: 5 }],
    ["def.ps alone", { def: { ps: 250 } }],
    ["def.ps beside on", { def: { on: true, ps: 1 } }],
    ["an empty object", {}],
    ["a non-array nw.ins", { nw: { ins: 5 } }],
    ["a non-object nw.ins entry", { nw: { ins: [5] } }],
    ["a non-boolean def.on", { def: { on: "yes" } }],
    ["a fractional def.bri", { def: { bri: 1.5 } }],
    ["a def.bri above 255", { def: { bri: 256 } }],
    ["a negative def.bri", { def: { bri: -1 } }],
  ])("returns 400 invalid_request for %s and sends no POST", async (_name, payload) => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("config"), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
    expect(f.requests).toHaveLength(0);
  });
});

describe("GET pending-reboot", () => {
  // Fails if an empty pending list still asks the device.
  it("returns [] with no device request when nothing is pending", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("pending-reboot") });
    expect(res.json()).toEqual([]);
    expect(f.requests).toHaveLength(0);
  });

  // Fails if a busy device is an error instead of the stored list.
  it("returns the stored list when the device is busy", async () => {
    const { t, f, row, url } = await setup();
    devices.addPendingReboot(t.db, row.id, ["hostname"], new Date());
    f.setMode("busy");
    const res = await t.inject({ method: "GET", url: url("pending-reboot") });
    expect(res.json()).toEqual(["hostname"]);
  });

  // Fails if an offline device hides or clears the stored list.
  it("returns the stored list when the device is offline", async () => {
    const { t, f, row, url } = await setup();
    devices.addPendingReboot(t.db, row.id, ["hostname"], new Date());
    f.setMode("timeout");
    const res = await t.inject({ method: "GET", url: url("pending-reboot") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(["hostname"]);
  });
});

describe("POST unlock", () => {
  // Fails if unlock does not send the PIN to the device, so the next write is still refused.
  it("unlocks a locked device so a config write succeeds", async () => {
    const { t, url } = await setup({ pin: "1234" });
    expect((await t.inject({ method: "POST", url: url("unlock"), payload: { pin: "1234" } })).statusCode).toBe(204);
    const res = await t.inject({ method: "PATCH", url: url("config"), payload: { hw: { led: { maxpwr: 850 } } } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if a wrong PIN is reported as success.
  it("returns 401 wrong_pin for a wrong PIN", async () => {
    const { t, url } = await setup({ pin: "1234" });
    const res = await t.inject({ method: "POST", url: url("unlock"), payload: { pin: "0000" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "wrong_pin" });
  });

  // Fails if a failed lock check is reported as a successful unlock.
  it("passes on a lock-check failure other than pin_required", async () => {
    const { t, f, url } = await setup({ pin: "1234" });
    f.failNext("serverError", { method: "GET", path: "/settings/s.js" });
    const res = await t.inject({ method: "POST", url: url("unlock"), payload: { pin: "1234" } });
    expect(res.statusCode).toBe(502);
  });

  // Fails if a device with no PIN refuses to unlock.
  it("returns 204 for a device with no PIN", async () => {
    const { t, url } = await setup();
    expect((await t.inject({ method: "POST", url: url("unlock"), payload: { pin: "1234" } })).statusCode).toBe(204);
  });

  // Fails if the body schema accepts a missing, short, or non-string PIN.
  it.each([[{}], [{ pin: "12" }], [{ pin: 1234 }]])("returns 400 for %j and sends nothing", async (payload) => {
    const { t, f, url } = await setup({ pin: "1234" });
    const res = await t.inject({ method: "POST", url: url("unlock"), payload });
    expect(res.statusCode).toBe(400);
    expect(f.requests).toHaveLength(0);
  });
});

describe("POST reboot", () => {
  // Fails if reboot does not send rb or leaves pending_reboot set.
  it("sends rb and clears pending_reboot", async () => {
    const { t, f, row, url } = await setup();
    devices.addPendingReboot(t.db, row.id, ["hostname"], new Date());
    const res = await t.inject({ method: "POST", url: url("reboot") });
    expect(res.statusCode).toBe(204);
    expect(f.requests.at(-1)!.body).toEqual({ rb: true });
    expect(devices.get(t.db, row.id)!.pendingReboot).toEqual([]);
  });
});
