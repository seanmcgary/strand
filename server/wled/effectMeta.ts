import type { Effect } from "../../shared/apiTypes";

const SLIDERS = ["Speed", "Intensity", "Custom 1", "Custom 2", "Custom 3"];
const CHECKS = ["Option 1", "Option 2", "Option 3"];
const COLORS = ["Fx", "Bg", "Cs"];

/** Labels from one comma-separated metadata field: `!` is the default label, empty is hidden, trailing empties go. */
function labels(field: string | undefined, defaults: string[], offset: number, count: number): string[] {
  const items = (field ?? "").split(",").slice(offset, offset + count);
  const out = items.map((item, k) => (item === "!" ? defaults[k]! : item));
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Parses a WLED `fxdata` string (`sliders;colors;palette;flags`) into the controls an effect shows. */
export function parseEffectMeta(id: number, meta: string): Pick<Effect, "pal" | "sliders" | "checks" | "colors"> {
  const source = id === 0 ? ";!;" : meta === "" ? "!,!;!,!,!;!" : meta;
  const [sliders, colors, palette] = source.split(";");
  return {
    pal: palette === "!" || (palette !== undefined && palette !== "" && !/^\d+$/.test(palette)),
    sliders: labels(sliders, SLIDERS, 0, 5),
    checks: labels(sliders, CHECKS, 5, 3),
    colors: labels(colors, COLORS, 0, 3),
  };
}

const channel = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;

/** `#RRGGBB` for each `[pos, r, g, b]` entry; color references and malformed device data are dropped. */
export function palxStops(entries: unknown[]): string[] {
  const stops: string[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 4 || !entry.every(channel)) continue;
    const [, r, g, b] = entry as number[];
    stops.push(`#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
  }
  return stops;
}
