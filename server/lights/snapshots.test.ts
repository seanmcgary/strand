import { describe, expect, it } from "vitest";
import type { RangeSnapshot, RangeView, SlotLook, SlotView, StrandView } from "../../shared/apiTypes";
import { seeds } from "../../test/fixtures/seeds";
import type { Strand } from "./layoutRead";
import { LayoutError, validateRanges } from "./layoutWrite";
import { fitRanges, lookFromRange, lookToPatches, resolveSlot, sceneToPatch, snapshotStrand } from "./snapshots";

const lists = { effects: seeds.backyard.effects, palettes: seeds.backyard.palettes };

const look = (over: Partial<SlotLook> = {}): SlotLook => ({
  col: [
    [255, 160, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  c1: 128,
  c2: 128,
  c3: 16,
  o1: false,
  o2: false,
  o3: false,
  pal: 0,
  palName: "Default",
  ...over,
});
const view = (over: Partial<SlotView> = {}): SlotView => ({ ...look(over), on: true, ...over });
const allSnap = (name: string, start: number, len: number): RangeSnapshot => ({ name, start, len, pattern: { kind: "all" }, slots: [look()] });
const allView = (name: string, start: number, len: number): RangeView => ({ name, start, len, pattern: { kind: "all" }, slots: [view()] });
const strandOf = (len: number): Strand => ({ key: "o0", name: "Patio", pins: [0], start: 0, len, members: ["o0"] });
const strandView = (len: number, ranges: RangeView[]): StrandView => ({ ...strandOf(len), on: true, bri: 200, ranges, normalize: false });

describe("snapshotStrand", () => {
  // Fails until snapshotStrand drops `on` from each slot and keeps the strand's `on` and `bri`.
  it("keeps strand power and brightness and drops slot power", () => {
    const snap = snapshotStrand(strandView(10, [allView("Rest", 0, 10)]));
    expect(snap.on).toBe(true);
    expect(snap.bri).toBe(200);
    expect(snap.ranges[0]!.slots[0]).not.toHaveProperty("on");
    expect(snap.ranges[0]!.slots[0]).toEqual(look());
  });
});

describe("lookFromRange", () => {
  // Fails until lookFromRange throws LayoutError for an Individual range.
  it("refuses a painted range", () => {
    const r: RangeView = { name: "P", start: 0, len: 2, pattern: { kind: "individual" }, slots: [view()], paint: ["#FF0000", "#00FF00"] };
    expect(() => lookFromRange(r)).toThrow(LayoutError);
  });

  // Fails until lookFromRange returns the pattern and the slots without `on`.
  it("returns the pattern and slots", () => {
    const r: RangeView = { name: "E", start: 0, len: 10, pattern: { kind: "every", n: 2, group: 1 }, slots: [view(), view({ fx: 3 })] };
    const l = lookFromRange(r);
    expect(l.pattern).toEqual({ kind: "every", n: 2, group: 1 });
    expect(l.slots[1]).toEqual(look({ fx: 3 }));
    expect(l.slots[0]).not.toHaveProperty("on");
  });
});

describe("fitRanges", () => {
  const ranges = [allSnap("A", 0, 100), allSnap("B", 100, 50)];

  // Fails until fitRanges cuts the last range, drops ranges past the end, and grows the last one.
  it.each([
    [120, [["A", 0, 100], ["B", 100, 20]]],
    [90, [["A", 0, 90]]],
    [200, [["A", 0, 100], ["B", 100, 100]]],
  ])("fits to %i LEDs", (len, expected) => {
    const fitted = fitRanges(ranges, len).ranges;
    expect(fitted.map((r) => [r.name, r.start, r.len])).toEqual(expected);
  });

  // Fails until fitRanges repeats the last paint color when it grows an Individual range.
  it("repeats the last color of a grown paint", () => {
    const paint: RangeSnapshot = { name: "P", start: 0, len: 3, pattern: { kind: "individual" }, slots: [look()], paint: ["#111111", "#222222", "#333333"] };
    const fitted = fitRanges([paint], 5).ranges[0]!;
    expect(fitted.paint).toEqual(["#111111", "#222222", "#333333", "#333333", "#333333"]);
  });

  // Fails until fitRanges cuts a shrunk paint to the new length.
  it("cuts a shrunk paint", () => {
    const paint: RangeSnapshot = { name: "P", start: 0, len: 3, pattern: { kind: "individual" }, slots: [look()], paint: ["#111111", "#222222", "#333333"] };
    expect(fitRanges([paint], 2).ranges[0]!.paint).toEqual(["#111111", "#222222"]);
  });

  // Fails until fitRanges turns an Every range that became too short into All with its first slot.
  it("turns a too-short Every into All", () => {
    const every: RangeSnapshot = { name: "Patio", start: 0, len: 10, pattern: { kind: "every", n: 4, group: 2 }, slots: [look({ fx: 1 }), look(), look(), look()] };
    const out = fitRanges([every], 6);
    expect(out.ranges[0]!.pattern).toEqual({ kind: "all" });
    expect(out.ranges[0]!.slots).toEqual([look({ fx: 1 })]);
    expect(out.warnings).toEqual(["Patio is too short for Every 4 now, so it uses All."]);
  });
});

describe("resolveSlot", () => {
  // Fails until resolveSlot re-finds an effect by name when its ID moved.
  it("follows an effect by name", () => {
    const rainbow = { effects: ["Solid", "Blink", "Other", ...Array<string>(6).fill("X"), "Rainbow"], palettes: ["Default"] };
    expect(resolveSlot(look({ fx: 2, fxName: "Rainbow" }), rainbow).slot.fx).toBe(9);
  });

  // Fails until resolveSlot keeps an ID whose name still matches.
  it("keeps an effect whose name matches", () => {
    const out = resolveSlot(look({ fx: 2, fxName: "Rainbow" }), { effects: ["Solid", "Rainbow", "Rainbow"], palettes: ["Default"] });
    expect(out.slot.fx).toBe(2);
    expect(out.warnings).toEqual([]);
  });

  // Fails until resolveSlot falls back to Default with a warning for a missing palette.
  it("falls back for a missing palette", () => {
    const out = resolveSlot(look({ pal: 4, palName: "Ocean" }), { effects: ["Solid"], palettes: ["Default", "Party"] });
    expect(out.slot.pal).toBe(0);
    expect(out.slot.palName).toBe("Default");
    expect(out.warnings).toEqual(["Ocean isn't on this controller. Default is used instead."]);
  });

  // Fails until resolveSlot falls back to Solid with a warning for a missing effect.
  it("falls back for a missing effect", () => {
    const out = resolveSlot(look({ fx: 7, fxName: "Gone" }), lists);
    expect(out.slot.fx).toBe(0);
    expect(out.slot.fxName).toBe("Solid");
    expect(out.warnings).toEqual(["Gone isn't on this controller. Solid is used instead."]);
  });
});

describe("sceneToPatch", () => {
  const snap = { on: false, bri: 90, ranges: [allSnap("A", 0, 100), allSnap("B", 100, 50)] };

  // Fails until sceneToPatch warns about a changed LED count, fits the ranges, and gives slots the strand's power.
  it("fits to the strand and warns about the LED count", () => {
    const { next, warnings } = sceneToPatch(snap, 150, strandOf(120), lists);
    expect(warnings).toEqual(["The strand has 120 LEDs now, not 150. The ranges were fitted to the new length."]);
    expect(next.on).toBe(false);
    expect(next.bri).toBe(90);
    expect(next.ranges!.map((r) => r.len)).toEqual([100, 20]);
    expect(next.ranges!.every((r) => r.slots.every((s) => s.on === false))).toBe(true);
    expect(validateRanges(strandOf(120), next.ranges!, lists.effects.length)).toBeNull();
  });

  // Fails until sceneToPatch resolves each slot's effect and reports a missing one once.
  it("warns once about a missing effect", () => {
    const gone = { ...snap, ranges: snap.ranges.map((r) => ({ ...r, slots: [look({ fx: 99, fxName: "Gone" })] })) };
    const { next, warnings } = sceneToPatch(gone, 150, strandOf(150), lists);
    expect(warnings).toEqual(["Gone isn't on this controller. Solid is used instead."]);
    expect(next.ranges![0]!.slots[0]!.fx).toBe(0);
  });
});

describe("lookToPatches", () => {
  const painted: RangeView = { name: "Paint", start: 10, len: 3, pattern: { kind: "individual" }, slots: [view()], paint: ["#FFFFFF", "#FFFFFF", "#FFFFFF"] };
  const strand = strandView(20, [allView("Front", 0, 10), painted, allView("Rest", 13, 7)]);
  const every = { pattern: { kind: "every" as const, n: 2, group: 3 }, slots: [look({ fx: 1, fxName: "Blink" }), look()] };

  // Fails until lookToPatches applies the look to one named range and keeps the others as they are.
  it("applies a look to one range", () => {
    const { patches, warnings } = lookToPatches({ pattern: { kind: "all" }, slots: [look({ fx: 1, fxName: "Blink" })] }, [{ strand, range: "Paint" }], lists);
    expect(warnings).toEqual([]);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.key).toBe("o0");
    const [a, b, c] = patches[0]!.next.ranges!;
    expect(a).toEqual(strand.ranges[0]);
    expect(b).toMatchObject({ name: "Paint", start: 10, len: 3, pattern: { kind: "all" } });
    expect(b!.paint).toBeUndefined();
    expect(b!.slots[0]).toMatchObject({ fx: 1, on: true });
    expect(c).toEqual(strand.ranges[2]);
  });

  // Fails until lookToPatches covers every range when the target has no `range`.
  it("covers every range of a strand when no range is named", () => {
    const { patches } = lookToPatches({ pattern: { kind: "all" }, slots: [look({ fx: 1, fxName: "Blink" })] }, [{ strand }], lists);
    expect(patches[0]!.next.ranges!.map((r) => r.slots[0]!.fx)).toEqual([1, 1, 1]);
    expect(validateRanges(strandOf(20), patches[0]!.next.ranges!, lists.effects.length)).toBeNull();
  });

  // Fails until lookToPatches skips a range that is too short for the look and warns.
  it("skips a range too short for the look", () => {
    const short = strandView(13, [allView("Front", 0, 10), allView("Rest", 10, 3)]);
    const { patches, warnings } = lookToPatches(every, [{ strand: short }], lists);
    expect(warnings).toEqual(["Rest is too short for this look."]);
    const [a, b] = patches[0]!.next.ranges!;
    expect(a!.pattern).toEqual(every.pattern);
    expect(b).toEqual(short.ranges[1]);
  });
});
