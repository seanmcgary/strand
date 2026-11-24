import { describe, expect, it } from "vitest";
import type { ConfigPatch, WledConfigFull } from "../../shared/apiTypes";
import { checkUnsupported, classifyChanges, mergeConfigPatch, topLevelBody } from "./configMerge";

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

describe("topLevelBody", () => {
  // Fails if the body holds only the changed leaf, so the firmware resets hw.btn, hw.ir and hw.relay.
  it("returns the full merged subtree of each patched key and no other key", () => {
    const patch = patchOf({ hw: { led: { maxpwr: 850 } } });
    const body = topLevelBody(mergeConfigPatch(base(), patch), patch) as { hw: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["hw"]);
    expect(body.hw).toEqual({ ...(base().hw as object), led: { ...(base().hw as { led: object }).led, maxpwr: 850 } });
  });
});

describe("mergeConfigPatch", () => {
  // Fails if arrays merge by index, so a shorter output list keeps the old second entry.
  it("replaces an array whole", () => {
    const merged = mergeConfigPatch(base(), patchOf({ hw: { led: { ins: [{ start: 0, len: 10 }] } } }));
    expect((merged.hw as { led: { ins: unknown[] } }).led.ins).toEqual([{ start: 0, len: 10 }]);
  });

  // Fails if the merge walks into __proto__ and writes to Object.prototype.
  it("does not pollute Object.prototype", () => {
    mergeConfigPatch(base(), JSON.parse('{"__proto__":{"x":1},"def":{"__proto__":{"y":1}}}'));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).y).toBeUndefined();
  });
});

describe("checkUnsupported", () => {
  // Fails if a shorter network list is sent: the firmware keeps its list and ignores the write.
  it("rejects fewer networks than the device has", () => {
    expect(checkUnsupported(base(), patchOf({ nw: { ins: [entry("HomeNet")] } }))).toEqual(expect.any(String));
  });

  // Fails if an empty client password is sent: the firmware ignores it.
  it("rejects an empty client psk over a saved password", () => {
    const patch = patchOf({ nw: { ins: [entry("HomeNet", { psk: "" }), entry("Guest")] } });
    expect(checkUnsupported(base(), patch)).toEqual(expect.any(String));
  });

  // Fails if the empty-psk rule also blocks ap.psk, which makes the access point open.
  it("allows an empty ap psk", () => {
    expect(checkUnsupported(base(), patchOf({ ap: { psk: "" } }))).toBeNull();
  });
});

describe("classifyChanges", () => {
  const classify = (patch: object, after: WledConfigFull = mergeConfigPatch(base(), patchOf(patch))) =>
    classifyChanges(base(), after, patchOf(patch));

  // Fails if a changed SSID list is not a reconnect change.
  it("flags a new SSID as reconnect", () => {
    expect(classify({ nw: { ins: [entry("HomeNet"), entry("Other")] } })).toEqual({ reconnect: true, reboot: [] });
  });

  // Fails if a password write is not a reconnect change.
  it("flags a psk as reconnect", () => {
    expect(classify({ nw: { ins: [entry("HomeNet", { psk: "secret12" }), entry("Guest")] } }).reconnect).toBe(true);
  });

  // Fails if an access-point channel change is not a reconnect change.
  it("flags ap.chan as reconnect", () => {
    expect(classify({ ap: { chan: 6 } }).reconnect).toBe(true);
  });

  // Fails if an mDNS name change is not a pending hostname reboot.
  it("flags id.mdns as a hostname reboot", () => {
    expect(classify({ id: { mdns: "porch" } })).toEqual({ reconnect: false, reboot: ["hostname"] });
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
