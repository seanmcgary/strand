import { describe, expect, it } from "vitest";
import { palxStops, parseEffectMeta } from "./effectMeta";

describe("parseEffectMeta", () => {
  // Fails if parseEffectMeta does not split the metadata string, apply default labels or read the palette field.
  it.each([
    [7, "!,!,,,,Smooth;;!", { pal: true, sliders: ["Speed", "Intensity"], checks: ["Smooth"], colors: [] }],
    [4, "!;;!", { pal: true, sliders: ["Speed"], checks: [], colors: [] }],
    [0, "", { pal: false, sliders: [], checks: [], colors: ["Fx"] }],
    [30, "", { pal: true, sliders: ["Speed", "Intensity"], checks: [], colors: ["Fx", "Bg", "Cs"] }],
    [5, "!,,Delay;;4", { pal: false, sliders: ["Speed", "", "Delay"], checks: [], colors: [] }],
  ])("parses effect %i %j", (id, meta, expected) => {
    expect(parseEffectMeta(id, meta)).toEqual(expected);
  });
});

describe("palxStops", () => {
  // Fails if palxStops does not turn [pos, r, g, b] entries into uppercase hex and drop color references.
  it("converts color entries and drops references", () => {
    expect(palxStops([[0, 255, 0, 0], [255, 0, 0, 255]])).toEqual(["#FF0000", "#0000FF"]);
    expect(palxStops(["c1", "c2"])).toEqual([]);
  });

  // Fails if palxStops lets through a string, a wrong length, a non-integer or an out-of-range value.
  it("drops hostile entries", () => {
    expect(palxStops([[0, "<b>", 0, 0], [0, 256, 0, 0], [0, 1.5, 0, 0], [300, 0, 0, 0], [0, 0, 0], [0, 10, 20, 30]])).toEqual(["#0A141E"]);
  });
});
