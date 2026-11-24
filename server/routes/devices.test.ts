import { lookup } from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Device, DiscoveredDevice } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as devices from "../db/devices";
import * as preferences from "../db/preferences";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const fakes: FakeWled[] = [];

async function fake(seed: (typeof seeds)[keyof typeof seeds], opts?: Parameters<typeof startFakeWled>[1]) {
  const f = await startFakeWled(seed, opts);
  fakes.push(f);
  return f;
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

async function listSetup() {
  const t = makeTestApp({ now: () => new Date("2026-11-24T12:00:00Z") });
  const backyard = await fake(seeds.backyard);
  const roof = await fake(seeds.frontRoof, { pin: "1234" });
  const lamp = await fake(seeds.deskLamp);
  t.addFake(backyard, seeds.backyard);
  t.addFake(roof, seeds.frontRoof);
  const lampRow = t.addFake(lamp, seeds.deskLamp);
  devices.recordSeen(t.db, lampRow.id, { name: lampRow.name, lastIp: lampRow.lastIp }, new Date("2026-11-20T08:00:00Z"));
  lamp.setMode("timeout");
  return { t, backyard, roof, lamp };
}

describe("GET /api/devices", () => {
  // Fails if the list drops a device, reorders them, or reads the lock and offline states wrongly.
  it("returns saved devices in insert order with online and lock state", async () => {
    const { t } = await listSetup();
    const res = await t.inject({ method: "GET", url: "/api/devices" });
    expect(res.statusCode).toBe(200);
    const list = res.json<Device[]>();
    expect(list.map((d) => d.name)).toEqual(["Backyard", "Front Roof", "Desk Lamp"]);
    expect(list[0]).toMatchObject({ online: true, pinLocked: false, lastSeen: "2026-11-24T12:00:00.000Z" });
    expect(list[1]).toMatchObject({ online: true, pinLocked: true });
    expect(list[2]).toMatchObject({ online: false, pinLocked: false, lastSeen: "2026-11-20T08:00:00.000Z" });
  });

  // Fails if a device answering as a different MAC is shown online or has its saved name overwritten.
  it("reports a device offline when another device answers at its address", async () => {
    const t = makeTestApp();
    const other = await fake(seeds.garage);
    t.addFake(other, seeds.backyard);
    const res = await t.inject({ method: "GET", url: "/api/devices" });
    expect(res.json<Device[]>()[0]).toMatchObject({ name: "Backyard", online: false });
    expect(devices.list(t.db)[0]!.name).toBe("Backyard");
  });

  // Fails if the list asks devices one after another.
  it("asks every device at once when devices do not reply", async () => {
    const t = makeTestApp();
    const first = await fake(seeds.backyard);
    const second = await fake(seeds.garage);
    t.addFake(first, seeds.backyard);
    t.addFake(second, seeds.garage);
    first.setMode("timeout");
    second.setMode("timeout");
    const pending = t.inject({ method: "GET", url: "/api/devices" });
    await vi.waitFor(() => expect(first.requests).toHaveLength(1));
    await vi.waitFor(() => expect(second.requests).toHaveLength(1), { timeout: t.deps.config.deviceTimeoutMs / 2 });
    await pending;
  });

  // Fails if the list stops saving the name and the time of a device that answered.
  it("saves the name and last seen time of an online device", async () => {
    const { t, backyard } = await listSetup();
    (backyard.cfg.id as { name: string }).name = "Back Porch";
    await t.inject({ method: "GET", url: "/api/devices" });
    const row = devices.list(t.db)[0]!;
    expect(row).toMatchObject({ name: "Back Porch", lastSeen: "2026-11-24T12:00:00.000Z" });
  });
});

describe("POST /api/devices/probe", () => {
  // Fails if probe stops returning the device's details or marks a new device as added.
  it("returns the device at an IP address and port", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: `127.0.0.1:${f.port}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json<DiscoveredDevice>()).toMatchObject({
      mac: seeds.backyard.info.mac,
      name: "Backyard",
      ip: "127.0.0.1",
      alreadyAdded: false,
    });
  });

  // Fails if a bare name stops being tried as <name>.local through mDNS, or probe ignores wledPort.
  it("resolves a bare name as <name>.local", async () => {
    const f = await fake(seeds.backyard);
    const t = makeTestApp({
      wledPort: f.port,
      resolveA: async (host) => (host === "wled-backyard.local" ? "127.0.0.1" : null),
    });
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: "wled-backyard" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ host: "wled-backyard.local", ip: "127.0.0.1" });
  });

  // Fails if probe stops comparing the MAC with the saved devices.
  it("sets alreadyAdded when the MAC is saved", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    t.addFake(f, seeds.backyard);
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: `127.0.0.1:${f.port}` } });
    expect(res.json()).toMatchObject({ alreadyAdded: true });
  });

  // Fails if a name that is not .local stops going through the system resolver.
  it("resolves a name that is not .local through DNS", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "127.0.0.1", family: 4 } as never);
    const f = await fake(seeds.backyard);
    const t = makeTestApp({ wledPort: f.port });
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: "wled.example.com" } });
    expect(lookup).toHaveBeenCalledWith("wled.example.com", { family: 4 });
    expect(res.json()).toMatchObject({ host: "wled.example.com", ip: "127.0.0.1" });
  });

  // Fails if a closed port stops giving 404 no_device with the typed host in the message.
  it("returns no_device when nothing answers", async () => {
    const t = makeTestApp();
    const f = await startFakeWled(seeds.backyard);
    await f.close();
    const host = `127.0.0.1:${f.port}`;
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "no_device" });
    expect(res.json<{ message: string }>().message).toContain(host);
  });

  // Fails if a reply that is not from WLED is accepted as a device.
  it("returns no_device when the brand is not WLED", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard, { infoOverride: { brand: "Other" } });
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: `127.0.0.1:${f.port}` } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "no_device" });
  });

  // Fails if a prefix, a path or a case difference in what was typed changes the host or port that is probed.
  it.each(["HTTP://127.0.0.1:PORT/", "https://127.0.0.1:PORT/a/b"])("reads the address %s", async (typed) => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    const res = await t.inject({
      method: "POST",
      url: "/api/devices/probe",
      payload: { host: typed.replace("PORT", String(f.port)) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ host: "127.0.0.1", ip: "127.0.0.1" });
  });

  // Fails if a reply without the LED count is accepted as a device, which would make the details throw.
  it("returns no_device when the reply has no leds", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard, { infoOverride: { leds: undefined } });
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload: { host: `127.0.0.1:${f.port}` } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "no_device" });
  });

  // Fails if a body that is not exactly { host: string } with a valid address reaches the handler or is coerced.
  it.each([
    { host: "a b" },
    {},
    { host: 5 },
    { host: "127.0.0.1", extra: 1 },
    { host: "  " },
    { host: "1.2.3.4?x=" },
    { host: "user@host" },
    { host: "host#x" },
    { host: "[::1]" },
    { host: "host:0" },
    { host: "host:99999" },
    { host: "host:ab" },
    { host: "300.1.1.1" },
    { host: ["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(62)].join(".") },
  ])("rejects the body %j", async (payload) => {
    const t = makeTestApp();
    const res = await t.inject({ method: "POST", url: "/api/devices/probe", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("POST /api/devices", () => {
  // Fails if add saves the address the device reports instead of the one reached, or lets a second add through.
  it("adds a device with the reached address, then rejects the same device", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    const payload = { host: `127.0.0.1:${f.port}` };
    const res = await t.inject({ method: "POST", url: "/api/devices", payload });
    expect(res.statusCode).toBe(201);
    expect(res.json<Device>()).toMatchObject({ name: "Backyard", lastIp: "127.0.0.1", online: true, pinLocked: false });
    const row = devices.getByMac(t.db, seeds.backyard.info.mac)!;
    expect(row).toMatchObject({ lastIp: "127.0.0.1", port: f.port });
    expect(seeds.backyard.info.ip).not.toBe("127.0.0.1");

    const again = await t.inject({ method: "POST", url: "/api/devices", payload });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_added", message: "Backyard is already in your devices." });
  });
});

describe("POST /api/devices with a PIN", () => {
  // Fails if add stops running the lock check.
  it("returns pinLocked for a locked device", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.frontRoof, { pin: "1234" });
    const res = await t.inject({ method: "POST", url: "/api/devices", payload: { host: `127.0.0.1:${f.port}` } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ pinLocked: true });
  });
});

describe("DELETE /api/devices/:id", () => {
  // Fails if delete does not remove the row, or a second delete stops giving 404.
  it("removes the device, then returns not_found", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    const row = t.addFake(f, seeds.backyard);
    const res = await t.inject({ method: "DELETE", url: `/api/devices/${row.id}` });
    expect(res.statusCode).toBe(204);
    expect(devices.list(t.db)).toEqual([]);
    const again = await t.inject({ method: "DELETE", url: `/api/devices/${row.id}` });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ error: "not_found" });
  });

  // Fails if delete leaves the device's strandNames preference behind.
  it("removes the device's strand names", async () => {
    const t = makeTestApp();
    const f = await fake(seeds.backyard);
    const row = t.addFake(f, seeds.backyard);
    preferences.put(t.db, `strandNames.${row.id}`, { o0: "Eaves" }, new Date());
    await t.inject({ method: "DELETE", url: `/api/devices/${row.id}` });
    expect(preferences.get(t.db, `strandNames.${row.id}`)).toBeUndefined();
  });

  // Fails if delete does not call lights.forget, so the flash timer still deletes the flash segment of a removed device.
  it("cancels the device's flash timer", async () => {
    const t = makeTestApp({ flashMs: 50 });
    const f = await fake(seeds.backyard);
    const row = t.addFake(f, seeds.backyard);
    await t.inject({ method: "POST", url: `/api/devices/${row.id}/lights/flash`, payload: { strandKey: "o0", led: 0 } });
    await t.inject({ method: "DELETE", url: `/api/devices/${row.id}` });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((f.state.seg as { n?: string }[]).filter((g) => g.n === "Strand flash")).toHaveLength(1);
  });
});
