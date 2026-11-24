/**
 * How big a JSON request a WLED device accepts (`~/Code/WLED/wled00`):
 *
 * - AsyncJson keeps a body only when it is under 16384 bytes, and answers a
 *   larger one with 413 (`src/dependencies/json/AsyncJson-v6.h:118, :144, :154`).
 * - The handler parses the body into one ArduinoJson document of
 *   `JSON_BUFFER_SIZE` bytes (`wled_server.cpp:430`, `wled.cpp:457-461`,
 *   `const.h:656-664`): 10240 on ESP8266, 24576 on ESP32-S2, 32767 on other ESP32.
 *   It parses in place, so strings and keys take no room, and every value
 *   below the root (array element or object member, containers included)
 *   takes one 16-byte slot. When they do not fit, the device answers 400.
 *
 * Strand keeps to 90% of the document, as a margin for the parser's own use.
 */

const MAX_TEXT_BYTES = 16384;
const SLOT_BYTES = 16;
const MARGIN = 0.9;

export type JsonCost = { bytes: number; slots: number };
export type JsonLimits = { bytes: number; slots: number };

/** `JSON_BUFFER_SIZE` for an `info.arch` ("esp8266", "esp32", or a chip model such as "ESP32-S2", `json.cpp:853-871`). An unknown arch gets the smallest. */
export function jsonBufferSize(arch: unknown): number {
  const a = typeof arch === "string" ? arch.toLowerCase() : "";
  if (a === "esp32-s2") return 24576;
  if (a.startsWith("esp32")) return 32767;
  return 10240;
}

/** The most text bytes and value slots one request may have on a device of this arch. */
export function jsonLimits(arch: unknown): JsonLimits {
  return { bytes: MAX_TEXT_BYTES - 1, slots: Math.floor((jsonBufferSize(arch) * MARGIN) / SLOT_BYTES) };
}

function slots(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n: number, item) => n + 1 + slots(item), 0);
  if (typeof v === "object" && v !== null) return Object.values(v).reduce((n: number, item) => n + 1 + slots(item), 0);
  return 0;
}

/** The text bytes and value slots of a request body. */
export function jsonCost(body: unknown): JsonCost {
  return { bytes: Buffer.byteLength(JSON.stringify(body)), slots: slots(body) };
}

export const fits = (cost: JsonCost, limits: JsonLimits): boolean => cost.bytes <= limits.bytes && cost.slots <= limits.slots;

/** Whether a device of this arch accepts the body. */
export function fitsDevice(body: unknown, arch: unknown): boolean {
  return fits(jsonCost(body), jsonLimits(arch));
}

/**
 * Cuts a `seg.i` array into the fewest requests `wrap(part)` that fit the
 * device, at run boundaries (a run is `start, stop, "RRGGBB"`). Each part has
 * at least one run.
 */
export function splitRuns<T>(i: (number | string)[], wrap: (part: (number | string)[]) => T, arch: unknown): (number | string)[][] {
  const limits = jsonLimits(arch);
  const base = jsonCost(wrap([]));
  const out: (number | string)[][] = [];
  let part: (number | string)[] = [];
  let cost = base;
  for (let k = 0; k < i.length; k += 3) {
    const run = i.slice(k, k + 3);
    // Each item adds its text and a comma, and one slot.
    const add = { bytes: run.reduce((n: number, x) => n + Buffer.byteLength(JSON.stringify(x)) + 1, 0), slots: run.length };
    const next = { bytes: cost.bytes + add.bytes, slots: cost.slots + add.slots };
    if (part.length > 0 && !fits(next, limits)) {
      out.push(part);
      part = [];
      cost = { bytes: base.bytes + add.bytes, slots: base.slots + add.slots };
    } else {
      cost = next;
    }
    part.push(...run);
  }
  if (part.length > 0) out.push(part);
  return out;
}
