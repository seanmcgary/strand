import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredDevice } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as devices from "../db/devices";

const fakes: FakeWled[] = [];

async function fake(seed: (typeof seeds)[keyof typeof seeds], opts?: Parameters<typeof startFakeWled>[1]) {
  const f = await startFakeWled(seed, opts);
  fakes.push(f);
  return f;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const service = (host: string, port: number, ...addresses: string[]) => ({ host, port, addresses });

/** Counts `fetch` calls by host name. Calls to any host but 127.0.0.1 fail at once, like an unreachable address. */
function spyFetch() {
  const real = globalThis.fetch;
  const hosts: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    hosts.push(url.hostname);
    return url.hostname === "127.0.0.1" ? real(input, init) : Promise.reject(new TypeError("unreachable"));
  });
  return hosts;
}

describe("GET /api/discovery", () => {
  // Fails if alreadyAdded is not read from the devices table, host is not the mDNS name, or the list is not sorted by name.
  it("returns found devices and marks the saved one", async () => {
    const garage = await fake(seeds.garage);
    const backyard = await fake(seeds.backyard);
    const t = makeTestApp({
      browse: async () => [
        service("wled-garage.local", garage.port, "127.0.0.1"),
        service("wled-backyard.local", backyard.port, "127.0.0.1"),
      ],
    });
    t.addFake(backyard, seeds.backyard);
    const res = await t.inject({ method: "GET", url: "/api/discovery" });
    const list = res.json<DiscoveredDevice[]>();
    expect(list.map((d) => [d.name, d.host, d.alreadyAdded])).toEqual([
      ["Backyard", "wled-backyard.local", true],
      ["Garage", "wled-garage.local", false],
    ]);
  });

  // Fails if /json/nodes of saved devices is not used, or an address from it is probed on the wrong port.
  it("finds a device that only a saved device's nodes list names", async () => {
    const garage = await fake(seeds.garage);
    const backyard = await fake(seeds.backyard, { nodes: [{ ip: "127.0.0.1" }] });
    const t = makeTestApp({ wledPort: garage.port });
    t.addFake(backyard, seeds.backyard);
    const res = await t.inject({ method: "GET", url: "/api/discovery" });
    const list = res.json<DiscoveredDevice[]>();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Garage", host: "wled-garage.local", ip: "127.0.0.1", alreadyAdded: false });
  });

  // Fails if an address that does not answer, is not WLED, or is public is returned or contacted.
  it("leaves out addresses that do not answer, are not WLED, or are public", async () => {
    const garage = await fake(seeds.garage);
    const notWled = await fake(seeds.wled, { infoOverride: { brand: "other" } });
    const hosts = spyFetch();
    const t = makeTestApp({
      browse: async () => [
        service("wled-garage.local", garage.port, "127.0.0.1"),
        service("other.local", notWled.port, "127.0.0.1"),
        service("gone.local", 80, "192.168.77.1"),
        service("public.local", 80, "8.8.8.8"),
      ],
    });
    const res = await t.inject({ method: "GET", url: "/api/discovery" });
    expect(res.json<DiscoveredDevice[]>().map((d) => d.name)).toEqual(["Garage"]);
    expect(hosts).toContain("192.168.77.1");
    expect(hosts).not.toContain("8.8.8.8");
  });

  // Fails if the number of /json/info requests is not capped at 64.
  it("sends at most 64 info requests", async () => {
    const hosts = spyFetch();
    const addresses = Array.from({ length: 100 }, (_, i) => `10.0.0.${i + 1}`);
    const t = makeTestApp({ browse: async () => [service("many.local", 80, ...addresses)] });
    await t.inject({ method: "GET", url: "/api/discovery" });
    expect(hosts).toHaveLength(64);
  });

  // Fails if one device found through mDNS and through nodes is listed twice.
  it("lists a MAC once when mDNS and nodes both find it", async () => {
    const garage = await fake(seeds.garage);
    const saved = await fake(seeds.backyard, { nodes: [{ ip: "127.0.0.1" }] });
    const t = makeTestApp({
      wledPort: garage.port,
      browse: async () => [service("wled-garage.local", garage.port, "127.0.0.1")],
    });
    t.addFake(saved, seeds.backyard);
    const list = (await t.inject({ method: "GET", url: "/api/discovery" })).json<DiscoveredDevice[]>();
    expect(list.map((d) => d.name)).toEqual(["Garage"]);
  });

  // Fails if a saved device found at a new address keeps its old last_ip.
  it("updates last_ip of a saved device found at a new address", async () => {
    const backyard = await fake(seeds.backyard);
    const t = makeTestApp({ browse: async () => [service("wled-backyard.local", backyard.port, "127.0.0.1")] });
    const row = t.addFake(backyard, seeds.backyard);
    devices.setLastIp(t.db, row.id, "192.168.1.99", new Date());
    await t.inject({ method: "GET", url: "/api/discovery" });
    expect(devices.get(t.db, row.id)!.lastIp).toBe("127.0.0.1");
  });

  // Fails if a device with an empty id.mdns gets a made-up name instead of its IP as host.
  it("uses the IP as host when the device has no mDNS name", async () => {
    const garage = await fake(seeds.garage);
    (garage.cfg.id as { mdns: string }).mdns = "";
    const backyard = await fake(seeds.backyard, { nodes: [{ ip: "127.0.0.1" }] });
    const t = makeTestApp({ wledPort: garage.port });
    t.addFake(backyard, seeds.backyard);
    const list = (await t.inject({ method: "GET", url: "/api/discovery" })).json<DiscoveredDevice[]>();
    expect(list[0]).toMatchObject({ name: "Garage", host: "127.0.0.1" });
  });

  // Fails if an id.mdns that is not a host name label is sent to the browser as host.
  it("uses the IP as host when the device's mDNS name is not a valid label", async () => {
    const garage = await fake(seeds.garage);
    (garage.cfg.id as { mdns: string }).mdns = "bad name!";
    const backyard = await fake(seeds.backyard, { nodes: [{ ip: "127.0.0.1" }] });
    const t = makeTestApp({ wledPort: garage.port });
    t.addFake(backyard, seeds.backyard);
    const list = (await t.inject({ method: "GET", url: "/api/discovery" })).json<DiscoveredDevice[]>();
    expect(list[0]).toMatchObject({ name: "Garage", host: "127.0.0.1" });
  });
});
