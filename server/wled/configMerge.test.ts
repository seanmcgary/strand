import { describe, expect, it } from "vitest";
import type { ConfigPatch, WledConfigFull } from "../../shared/apiTypes";
import { checkUnsupported, classifyChanges, mergeConfigPatch } from "./configMerge";

const entry = (ssid: string, extra: object = {}) => ({
  ssid,
  pskl: 8,
  ip: [0, 0, 0, 0],
  gw: [0, 0, 0, 0],
  sn: [255, 255, 255, 0],
  ...extra,
});
const base = (): WledConfigFull => ({
  id: { name: "Backyard", mdns: "wled-backyard" },
  nw: { ins: [entry("HomeNet"), entry("Guest")] },
  ap: { ssid: "WLED-AP", pskl: 8, chan: 1, hide: false, behav: 0 },
  def: { on: true, bri: 128, ps: 3 },
  hw: {
    led: { maxpwr: 0, ins: [{ start: 0, len: 30 }, { start: 30, len: 30 }] },
    btn: { ins: [{ type: 2 }] },
    ir: { pin: 4 },
    relay: { pin: 12 },
  },
});
const patchOf = (p: object) => p as ConfigPatch;

describe("mergeConfigPatch", () => {
  // Fails if arrays merge by index, so a shorter output list keeps the old second entry.
  it("replaces an array whole", () => {
    const merged = mergeConfigPatch(base(), patchOf({ hw: { led: { ins: [{ start: 0, len: 10 }] } } }));
    expect((merged.hw as { led: { ins: unknown[] } }).led.ins).toEqual([{ start: 0, len: 10 }]);
  });
});

describe("checkUnsupported", () => {
  // Fails if the empty-psk rule also blocks ap.psk, which makes the access point open.
  it("allows an empty ap psk", () => {
    expect(checkUnsupported(base(), patchOf({ ap: { psk: "" } }))).toBeNull();
  });
});

describe("classifyChanges", () => {
  const classify = (patch: object, after: WledConfigFull = mergeConfigPatch(base(), patchOf(patch))) =>
    classifyChanges(base(), after, patchOf(patch));

  // Fails if a gw-only change is missed.
  it("flags a gateway-only change as a static IP reboot", () => {
    const cur = base();
    (cur.nw as { ins: Record<string, unknown>[] }).ins[0]!.ip = [192, 168, 1, 50];
    const patch = patchOf({ nw: { ins: [entry("HomeNet", { ip: [192, 168, 1, 50], gw: [192, 168, 1, 1] }), entry("Guest")] } });
    expect(classifyChanges(cur, mergeConfigPatch(cur, patch), patch).reboot).toEqual(["static IP"]);
  });

  // Fails if going back to DHCP (zeros) is not a change.
  it("flags static IP back to DHCP as a static IP reboot", () => {
    const cur = base();
    (cur.nw as { ins: Record<string, unknown>[] }).ins[0]!.ip = [192, 168, 1, 50];
    const patch = patchOf({ nw: { ins: [entry("HomeNet"), entry("Guest")] } });
    expect(classifyChanges(cur, mergeConfigPatch(cur, patch), patch).reboot).toEqual(["static IP"]);
  });

  // Fails if a password write is not a reconnect change.
  it("flags a psk as reconnect", () => {
    expect(classify({ nw: { ins: [entry("HomeNet", { psk: "secret12" }), entry("Guest")] } }).reconnect).toBe(true);
  });

  // Fails if an access-point channel change is not a reconnect change.
  it("flags ap.chan as reconnect", () => {
    expect(classify({ ap: { chan: 6 } }).reconnect).toBe(true);
  });

  // Fails if a static IP is not a pending reboot.
  it("flags a static IP as a static IP reboot", () => {
    const patch = { nw: { ins: [entry("HomeNet", { ip: [192, 168, 1, 50] }), entry("Guest")] } };
    expect(classify(patch)).toEqual({ reconnect: false, reboot: ["static IP"] });
  });

  // Fails if a boot brightness change asks for a restart.
  it("flags nothing for def.bri", () => {
    expect(classify({ def: { bri: 200 } })).toEqual({ reconnect: false, reboot: [] });
  });
});
