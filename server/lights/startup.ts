import { decodePaint, encodePaint, FLASH_NAME, type PaintMap, type WledState } from "./layoutRead";

/**
 * The startup preset (spec §6.7): WLED preset 250, set as the boot preset, so
 * the layout and the paint survive a reboot with no Strand server running.
 */

export const STARTUP_ID = 250;
const STARTUP_NAME = "Strand: startup";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * The `psave` body: every segment ID from 0 to `maxseg − 1` in order (Plan
 * decision 2). A listed segment is its full body, with `i` when it is a painted
 * range and `paint` has its colors at its length; an unlisted ID, and a flash
 * segment, is `{ id, stop: 0 }`. No top-level `on` or `bri` (Plan decision 1).
 */
export function buildStartupPreset(state: WledState, paint: PaintMap, maxseg: number): Record<string, unknown> {
  const byId = new Map(state.seg.map((s) => [s.id, s]));
  const seg = Array.from({ length: maxseg }, (_, id): Record<string, unknown> => {
    const s = byId.get(id);
    if (!s || s.n === FLASH_NAME) return { id, stop: 0 };
    const body: Record<string, unknown> = { ...s, col: s.col.map((c) => [...c]) };
    const colors = s.n?.endsWith(" paint") ? paint[s.n] : undefined;
    if (colors && colors.length === s.stop - s.start) body.i = encodePaint(colors);
    return body;
  });
  return { psave: STARTUP_ID, o: true, n: STARTUP_NAME, bootps: STARTUP_ID, seg };
}

/**
 * The paint in `/presets.json`'s preset 250, by segment name. A `seg` entry
 * counts only when `n` is a string, `i` is an array, and `start` and `stop` give its length.
 */
export function startupPaint(presets: unknown): PaintMap {
  const preset = isObject(presets) ? presets[String(STARTUP_ID)] : undefined;
  const seg = isObject(preset) && Array.isArray(preset.seg) ? preset.seg : [];
  const out: PaintMap = {};
  for (const s of seg) {
    if (!isObject(s) || typeof s.n !== "string" || !Array.isArray(s.i)) continue;
    const { start, stop } = s;
    if (!isInt(start) || !isInt(stop) || stop <= start || stop - start > 65535) continue;
    out[s.n] = decodePaint(s.i, stop - start);
  }
  return out;
}
