import { decodePaint, encodePaint, FLASH_NAME, isInt, isObject, paintKey, PAINT_TAG, type PaintMap, type WledState } from "./layoutRead";

/**
 * The startup preset (spec §6.7): WLED preset 250, set as the boot preset, so
 * the layout and the paint survive a reboot with no Strand server running.
 */

const STARTUP_ID = 250;
const STARTUP_NAME = "Strand: startup";
/** The most segments a device has (`info.leds.maxseg` is at most 256). */
const MAX_SEGMENTS = 256;

/**
 * The `psave` body: every segment ID from 0 to `maxseg − 1` in order (Plan
 * decision 2). A listed segment is its full body, with `i` when it is a painted
 * range and `paint` has its colors at its length; a painted range without them
 * has no `frz`, so it does not boot frozen black. An unlisted ID, and a flash
 * segment, is `{ id, stop: 0 }`. No top-level `on` or `bri` (Plan decision 1).
 */
export function buildStartupPreset(state: WledState, paint: PaintMap, maxseg: number): Record<string, unknown> {
  const byId = new Map(state.seg.map((s) => [s.id, s]));
  const seg = Array.from({ length: maxseg }, (_, id): Record<string, unknown> => {
    const s = byId.get(id);
    if (!s || s.n === FLASH_NAME) return { id, stop: 0 };
    const body: Record<string, unknown> = { ...s, col: s.col.map((c) => [...c]) };
    if (!s.n?.endsWith(PAINT_TAG)) return body;
    const colors = paint[paintKey(s.start, s.n)];
    if (colors && colors.length === s.stop - s.start) body.i = encodePaint(colors);
    else delete body.frz;
    return body;
  });
  return { psave: STARTUP_ID, o: true, n: STARTUP_NAME, bootps: STARTUP_ID, seg };
}

/**
 * The paint in `/presets.json`'s preset 250, by `paintKey`. It reads at most
 * `MAX_SEGMENTS` entries, as the device's reply is untrusted. An entry counts
 * only when `n` is a painted segment's name, `i` is an array, and `start` and `stop` give its length.
 */
export function startupPaint(presets: unknown): PaintMap {
  const preset = isObject(presets) ? presets[String(STARTUP_ID)] : undefined;
  const seg = isObject(preset) && Array.isArray(preset.seg) ? preset.seg : [];
  const out: PaintMap = {};
  for (const s of seg.slice(0, MAX_SEGMENTS)) {
    if (!isObject(s) || typeof s.n !== "string" || !s.n.endsWith(PAINT_TAG) || !Array.isArray(s.i)) continue;
    const { start, stop } = s;
    if (!isInt(start) || !isInt(stop) || stop <= start || stop - start > 65535) continue;
    out[paintKey(start, s.n)] = decodePaint(s.i, stop - start);
  }
  return out;
}
