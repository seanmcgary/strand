import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeWled, type FakeMode, type FakeWled } from "../../test/fakeWled";
import { seeds } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as devices from "../db/devices";
import { ApiError } from "../errors";
import { deviceRequest, fetchInfo, isPrivateIpv4 } from "./deviceClient";

const fakes: FakeWled[] = [];
const apps: ReturnType<typeof makeTestApp>[] = [];

async function setup(opts: Parameters<typeof startFakeWled>[1] = {}, appOpts: Parameters<typeof makeTestApp>[0] = {}) {
  const fake = await startFakeWled(seeds.backyard, opts);
  fakes.push(fake);
  const t = makeTestApp(appOpts);
  apps.push(t);
  const row = t.addFake(fake, seeds.backyard);
  return { fake, t, row };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
  await Promise.all(apps.splice(0).map((t) => t.app.close()));
});

describe("deviceRequest", () => {
  // Fails if a good reply is not returned as parsed JSON.
  it("returns the parsed JSON reply", async () => {
    const { fake, t, row } = await setup();
    await expect(deviceRequest(t.deps, row, "/json/state")).resolves.toEqual(fake.state);
  });

  // Fails if the request has no timeout, or a timeout is not device_offline.
  it("maps a timeout to 504 device_offline within the time limit", async () => {
    const { fake, t, row } = await setup();
    fake.setMode("timeout");
    const start = Date.now();
    await expect(deviceRequest(t.deps, row, "/json/state", { timeoutMs: 200 })).rejects.toMatchObject({
      status: 504,
      code: "device_offline",
      message: "Backyard isn't responding.",
    });
    expect(Date.now() - start).toBeLessThan(400);
  });

  // Fails if a refused connection is not device_offline.
  it("maps a closed port to 504 device_offline", async () => {
    const { fake, t, row } = await setup();
    await fake.close();
    await expect(deviceRequest(t.deps, row, "/json/state")).rejects.toMatchObject({ status: 504, code: "device_offline" });
  });

  // Fails if a 503 or a dropped connection is reported as offline instead of busy (Review Focus 3).
  it.each<FakeMode>(["busy", "reset"])("maps %s to 503 device_busy", async (mode) => {
    const { fake, t, row } = await setup();
    fake.setMode(mode);
    await expect(deviceRequest(t.deps, row, "/json/state")).rejects.toMatchObject({ status: 503, code: "device_busy" });
  });

  // Fails if a 200 reply with {"error":n} is passed through as data, or the message drops the code.
  it("maps a WLED error reply to 502 device_error with its code", async () => {
    const { fake, t, row } = await setup();
    fake.setMode("deviceError");
    const err = await deviceRequest(t.deps, row, "/json/state").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: "device_error" });
    expect((err as ApiError).message).toContain("3");
  });

  // Fails if a reply that is not JSON, a 500, or a reply over 1 MB is accepted or mapped to another code.
  it.each<FakeMode>(["notJson", "serverError", "huge"])("maps %s to 502 device_error", async (mode) => {
    const { fake, t, row } = await setup();
    fake.setMode(mode);
    await expect(deviceRequest(t.deps, row, "/json/state")).rejects.toMatchObject({ status: 502, code: "device_error" });
  });

  // Fails if a 401 from a locked device is not pin_required.
  it("maps a 401 to pin_required", async () => {
    const { t, row } = await setup({ pin: "1234" });
    await expect(deviceRequest(t.deps, row, "/settings/s.js?p=3", { parse: "text" })).rejects.toMatchObject({
      status: 401,
      code: "pin_required",
    });
  });

  // Fails if a path without a leading slash, or one that names another host, is sent.
  it.each(["json/state", "//example.com/json/state", "/\\example.com/json/state"])("rejects the path %s", async (path) => {
    const { fake, t, row } = await setup();
    const err = await deviceRequest(t.deps, row, path).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(fake.requests).toEqual([]);
  });

  describe("address recovery", () => {
    // 192.0.2.1 is TEST-NET-1: nothing answers there.
    async function staleDevice(opts: Parameters<typeof startFakeWled>[1] = {}) {
      const resolveA = vi.fn(async () => "127.0.0.1");
      const fake = await startFakeWled(seeds.backyard, opts);
      fakes.push(fake);
      const t = makeTestApp({ resolveA });
      apps.push(t);
      const added = t.addFake(fake, seeds.backyard, "wled-backyard.local");
      devices.setLastIp(t.db, added.id, "192.0.2.1", new Date());
      return { fake, t, resolveA, row: devices.get(t.db, added.id)! };
    }

    // Fails if a device that moved to a new address is not found through mDNS (Review Focus 1).
    it("finds the device at its new address and saves it", async () => {
      const { fake, t, resolveA, row } = await staleDevice();
      await expect(deviceRequest(t.deps, row, "/json/state")).resolves.toEqual(fake.state);
      expect(resolveA).toHaveBeenCalledWith("wled-backyard.local", 1000);
      expect(devices.get(t.db, row.id)!.lastIp).toBe("127.0.0.1");
    });

    // Fails if the new address is used without checking that the MAC matches.
    it("does not use an address where another device answers", async () => {
      const { t, row } = await staleDevice({ infoOverride: { mac: "000000000000" } });
      await expect(deviceRequest(t.deps, row, "/json/state")).rejects.toMatchObject({ status: 504, code: "device_offline" });
      expect(devices.get(t.db, row.id)!.lastIp).toBe("192.0.2.1");
    });

    // Fails if recover: false still queries mDNS.
    it("does not run with recover: false", async () => {
      const { t, resolveA, row } = await staleDevice();
      await expect(deviceRequest(t.deps, row, "/json/state", { recover: false })).rejects.toMatchObject({ status: 504 });
      expect(resolveA).not.toHaveBeenCalled();
    });
  });
});

describe("fetchInfo", () => {
  // Fails if fetchInfo stops returning the info, or stops cutting a long name.
  it("returns the info with the name cut to 64 characters", async () => {
    const { fake, t } = await setup({ infoOverride: { name: "x".repeat(70) } });
    const info = await fetchInfo(t.deps, "127.0.0.1", fake.port);
    expect(info).toMatchObject({ mac: "a4cf12345678", name: "x".repeat(64) });
  });

  // Fails if a reply that is not from WLED is accepted as a device.
  it.each([{ brand: "Other" }, { mac: "ZZ" }, { ver: undefined }])("returns null for %o", async (infoOverride) => {
    const { fake, t } = await setup({ infoOverride });
    await expect(fetchInfo(t.deps, "127.0.0.1", fake.port)).resolves.toBeNull();
  });
});

describe("isPrivateIpv4", () => {
  // Fails if a private range is dropped, a range edge moves, or a public or malformed address passes.
  it.each([
    ["10.0.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.1.42", true],
    ["169.254.1.1", true],
    ["127.0.0.1", true],
    ["8.8.8.8", false],
    ["192.169.0.1", false],
    ["10.0.0", false],
    ["10.0.0.256", false],
    ["wled.local", false],
  ])("%s is %s", (ip, expected) => {
    expect(isPrivateIpv4(ip)).toBe(expected);
  });
});
