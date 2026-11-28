import type { Capabilities, PinInfo, WledConfigFull } from "../../shared/apiTypes";

/** The `c` bit of an input-only GPIO (`pin_manager.h`). */
const INPUT_ONLY = 0x20;

/** The largest `d.max_gpio` accepted. The largest real chip has 49 GPIOs. */
const MAX_GPIO = 256;

type Parsed = Capabilities & { maxGpio: number };

/**
 * Reads the text of `/settings/s.js?p=2` (spec §8.3). The text is JavaScript
 * from the device and is never run: each value is cut out with a regular
 * expression and read as data. Returns `null` when a value is missing, or
 * when `bLimits(...)` has an argument count that no known firmware prints.
 */
export function parseCapabilities(text: string): Parsed | null {
  const ledTypes = parseLedTypes(text);
  const limits = parseLimits(text);
  const reservedPins = parseIntList(text, "rsvd");
  const inputOnlyPins = parseIntList(text, "ro_gpio");
  const maxGpio = /\bd\.max_gpio=(\d+);/.exec(text)?.[1];
  if (!ledTypes || !limits || !reservedPins || !inputOnlyPins || maxGpio === undefined) return null;
  // The number sizes the pin list, so a device cannot make it large.
  if (Number(maxGpio) > MAX_GPIO) return null;
  return { ledTypes, limits, reservedPins, inputOnlyPins, maxGpio: Number(maxGpio) };
}

function parseLedTypes(text: string): Capabilities["ledTypes"] | null {
  const raw = /\bd\.ledTypes=(\[.*?\]);/s.exec(text)?.[1];
  if (raw === undefined) return null;
  // The device prints the keys without quotes. A string is matched first so that a key-like text inside one stays as it is.
  const json = raw.replace(/"(?:[^"\\]|\\.)*"|([{,])([a-z]+):/g, (m, lead?: string, key?: string) =>
    lead === undefined ? m : `${lead}"${key}":`,
  );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const types: Capabilities["ledTypes"] = [];
  for (const item of value as Record<string, unknown>[]) {
    if (typeof item?.i !== "number" || typeof item.c !== "number" || typeof item.t !== "string" || typeof item.n !== "string") {
      return null;
    }
    types.push({ i: item.i, c: item.c, t: item.t, n: item.n });
  }
  return types;
}

function parseLimits(text: string): Capabilities["limits"] | null {
  const args = /\bbLimits\(([\d,\s]*)\)/.exec(text)?.[1];
  if (args === undefined) return null;
  const n = args.split(",").map((a) => Number(a.trim()));
  // 0.15.x: maxBusses, minVirtualBusses, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxAnalogChannels.
  if (n.length === 8) {
    return { maxLedsPerOutput: n[2]!, ledMemoryBytes: n[3]!, maxLeds: n[4]!, maxDigitalOutputs: n[6]!, maxPwmPins: n[7]! };
  }
  // 17.0.0-dev: platformId, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxRmtChannels, maxI2sChannels, maxAnalogChannels, maxButtons.
  if (n.length === 10) {
    return { maxLedsPerOutput: n[1]!, ledMemoryBytes: n[2]!, maxLeds: n[3]!, maxDigitalOutputs: n[5]!, maxPwmPins: n[8]! };
  }
  return null;
}

/** `d.<name>=[6,7,8,];`. Either list can be empty, and an Ethernet build leaves a trailing comma. */
function parseIntList(text: string, name: string): number[] | null {
  const raw = new RegExp(`\\bd\\.${name}=\\[([\\d,\\s]*)\\];`).exec(text)?.[1];
  if (raw === undefined) return null;
  return raw
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "")
  .map(Number);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const toPins = (v: unknown): number[] => (Array.isArray(v) ? v : [v]).filter((p): p is number => Number.isInteger(p) && p >= 0);

/**
 * The GPIO list of a device that has no `/json/pins` (0.15): every GPIO from
 * 0 to `maxGpio - 1` except the reserved ones, with the owner of each pin the
 * config uses.
 */
export function pinsFromCapabilities(caps: Parsed, cfg: WledConfigFull): PinInfo[] {
  const hw = isObject(cfg.hw) ? cfg.hw : {};
  const section = (key: string): Record<string, unknown> => (isObject(hw[key]) ? hw[key] : {});
  const inList = (key: string): unknown[] => {
    const ins = section(key).ins;
    return Array.isArray(ins) ? ins : [];
  };

  const owners = new Map<number, string>();
  const own = (name: string, pins: number[]): void => {
    pins.forEach((p) => {
      if (!owners.has(p)) owners.set(p, name);
    });
  };
  inList("led").forEach((o) => own("LEDs", toPins(isObject(o) ? o.pin : undefined)));
  inList("btn").forEach((o) => own("Button", toPins(isObject(o) ? o.pin : undefined)));
  own("IR", toPins(section("ir").pin));
  own("Relay", toPins(section("relay").pin));

  const reserved = new Set(caps.reservedPins);
  const inputOnly = new Set(caps.inputOnlyPins);
  const pins: PinInfo[] = [];
  for (let p = 0; p < caps.maxGpio; p++) {
    if (reserved.has(p)) continue;
    const c = inputOnly.has(p) ? INPUT_ONLY : 0;
    const n = owners.get(p);
    pins.push(n ? { p, c, a: true, n } : { p, c, a: false });
  }
  return pins;
}
