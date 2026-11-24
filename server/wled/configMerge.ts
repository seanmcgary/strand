import type { ConfigPatch, WledConfigFull } from "../../shared/apiTypes";

/** The only top-level keys of `/json/cfg` that a config write may touch (plan decision 9). */
export const CONFIG_KEYS = ["id", "nw", "ap", "def", "light", "hw", "if"] as const;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const asList = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
const sub = (v: unknown): Json => (isObject(v) ? v : {});

/** A message when the JSON API cannot make the change (spec §8.3 step 2), else `null`. */
export function checkUnsupported(current: WledConfigFull, patch: ConfigPatch): string | null {
  const next = patch.nw?.ins;
  if (next === undefined) return null;
  const now = asList(sub(current.nw).ins);
  if (next.length < now.length) return "The device can't remove a saved Wi-Fi network.";
  const blank = next.some((entry, i) => entry.psk === "" && Number(now[i]?.pskl ?? 0) > 0);
  if (blank) return "The device can't clear a saved Wi-Fi password.";
  return null;
}

function merge(current: unknown, patch: unknown): unknown {
  if (!isObject(current) || !isObject(patch)) return structuredClone(patch);
  const out: Json = { ...structuredClone(current) };
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = merge(current[key], value);
  }
  return out;
}

/** The config with `patch` merged in. Objects merge at every depth; arrays and scalars in `patch` replace. */
export function mergeConfigPatch(current: WledConfigFull, patch: ConfigPatch): WledConfigFull {
  return merge(current, patch) as WledConfigFull;
}

/**
 * For each top-level key of `patch`, the complete merged subtree (spec §8.3 step 4), with two rules from `deserializeConfig`:
 * `hw.led.ins` is left out unless the request sets it (it re-initialises the buses), and `hw.led.rgbwm`,
 * `hw.led.fps` and `light.gc.{bri,col,val}` are always sent, because the firmware resets them when a write omits them (`cfg.cpp:183`, `:189`, `:531-532`).
 */
export function topLevelBody(merged: WledConfigFull, patch: ConfigPatch): WledConfigFull {
  const body: Json = {};
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    body[key] = structuredClone(merged[key]);
  }
  const led = sub(sub(merged.hw).led);
  const carriedLed: Json = {};
  for (const key of ["rgbwm", "fps"]) if (led[key] !== undefined) carriedLed[key] = led[key];
  const gc = sub(sub(merged.light).gc);
  const carriedGc: Json = {};
  for (const key of ["bri", "col", "val"]) if (gc[key] !== undefined) carriedGc[key] = gc[key];

  if (patch.hw === undefined && Object.keys(carriedLed).length > 0) body.hw = { led: carriedLed };
  if (patch.light === undefined && Object.keys(carriedGc).length > 0) body.light = { gc: carriedGc };

  if (patch.hw !== undefined && patch.hw.led?.ins === undefined) {
    const hw = sub(body.hw);
    body.hw = { ...hw, led: Object.fromEntries(Object.entries(sub(hw.led)).filter(([k]) => k !== "ins")) };
  }
  return body;
}

const ssids = (cfg: WledConfigFull): string => asList(sub(cfg.nw).ins).map((e) => e.ssid).join("|");
const zero = (ip: unknown): boolean => !Array.isArray(ip) || ip.every((n) => n === 0);
const staticKey = (cfg: WledConfigFull): string =>
  asList(sub(cfg.nw).ins)
  .filter((e) => !zero(e.ip))
  .map((e) => `${String(e.ssid)}:${String(e.ip)}:${String(e.gw)}:${String(e.sn)}`)
  .join("|");

/** The restarts a write needs (spec §8.3 step 7, from the design's `wifiChanged` and `getPendingReboot`). */
export function classifyChanges(
  before: WledConfigFull,
  after: WledConfigFull,
  patch: ConfigPatch,
): { reconnect: boolean; reboot: string[] } {
  const ap = patch.ap;
  const beforeAp = sub(before.ap);
  const nw = patch.nw?.ins;
  const reconnect =
    (nw !== undefined && (nw.map((e) => e.ssid).join("|") !== ssids(before) || nw.some((e) => e.psk !== undefined))) ||
    (ap !== undefined &&
      ((ap.ssid !== undefined && ap.ssid !== beforeAp.ssid) ||
        ap.psk !== undefined ||
        (ap.chan !== undefined && ap.chan !== beforeAp.chan)));

  const reboot: string[] = [];
  if (sub(before.id).mdns !== sub(after.id).mdns) reboot.push("hostname");
  if (staticKey(before) !== staticKey(after)) reboot.push("static IP");
  return { reconnect, reboot };
}
