import { describe, expect, it } from "vitest"
import type { Effect, Palette, RangeView, SlotView, StrandView } from "../../shared/apiTypes"
import { cutRanges, everyPreview, ledColors, mergeInto, needMsg, nextRangeName, nameError, rangeColors, segsNeeded, splitRange, stepReasons, withPattern } from "./model"

const slot = (rgb: number[], over: Partial<SlotView> = {}): SlotView => ({
  col: [rgb, [0, 0, 0], [0, 0, 0]],
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  c1: 0,
  c2: 0,
  c3: 16,
  o1: false,
  o2: false,
  o3: false,
  pal: 0,
  palName: "Default",
  on: true,
  ...over,
})

const allRange = (name: string, start: number, len: number, rgb = [255, 180, 107]): RangeView => ({ name, start, len, pattern: { kind: "all" }, slots: [slot(rgb)] })
const strand = (ranges: RangeView[], over: Partial<StrandView> = {}): StrandView => ({
  key: "o0",
  name: "Strand 1",
  pins: [2],
  start: 0,
  len: ranges.reduce((t, r) => t + r.len, 0),
  on: true,
  bri: 128,
  ranges,
  normalize: false,
  ...over,
})

describe("lights model", () => {
  // Fails if everyPreview is not exported from the model.
  it("previews the Every N order", () => {
    expect(everyPreview(2, 2)).toBe("1 1 2 2 1 1 2 2 …")
  })

  // Fails if withPattern does not give a new slot the first unused SLOT_COLORS entry.
  it("adds slots in the first unused color when a range becomes Every", () => {
    const out = withPattern(null, null, allRange("A", 0, 8, [255, 180, 107]), { kind: "every", n: 2, group: 1 })
    expect(out.slots).toHaveLength(2)
    expect(out.slots[1]!.col[0]).toEqual([255, 0, 0])
  })

  // Fails if withPattern does not take paint from what the range shows now.
  it("paints an Individual range from the old range's colors", () => {
    const r = allRange("A", 0, 3)
    const out = withPattern(null, null, r, { kind: "individual" })
    expect(out.paint).toEqual(rangeColors(null, null, r))
    expect(out.paint).toEqual(["#FFB46B", "#FFB46B", "#FFB46B"])
  })

  // Fails if splitRange does not give the first piece the smaller half.
  it("splits a 5-LED range into 2 and 3", () => {
    const out = splitRange([allRange("Range 1", 0, 5)], 0, "Range 2")!
    expect(out.map((r) => [r.name, r.start, r.len])).toEqual([["Range 1", 0, 2], ["Range 2", 2, 3]])
  })

  // Fails if splitRange returns a piece an Every pattern cannot fit.
  it("turns a split piece that is too short for Every into All with its first slot", () => {
    const every = withPattern(null, null, allRange("A", 0, 4), { kind: "every", n: 3, group: 1 })
    const out = splitRange([every], 0, "Range 2")!
    expect(out.map((r) => [r.pattern.kind, r.slots.length])).toEqual([["all", 1], ["all", 1]])
  })

  // Fails if splitRange accepts a range of one LED.
  it("does not split a 1-LED range", () => {
    expect(splitRange([allRange("A", 0, 1)], 0, "B")).toBeNull()
  })

  // Fails if stepReasons does not give the group limit for N slots.
  it("explains the largest group for N slots", () => {
    const r: RangeView = { ...allRange("A", 0, 400), pattern: { kind: "every", n: 3, group: 127 }, slots: [slot([1, 1, 1]), slot([2, 2, 2]), slot([3, 3, 3])] }
    expect(stepReasons(r, 5).gUp).toBe("With 3 slots, a group can be at most 127 LEDs.")
  })

  // Fails if stepReasons does not stop N and the group where the range is too short.
  it("gives the length reasons", () => {
    const every = (n: number, group: number, len: number): RangeView => ({ ...allRange("A", 0, len), pattern: { kind: "every", n, group }, slots: Array.from({ length: n }, () => slot([1, 1, 1])) })
    expect(stepReasons(every(2, 3, 6), 5).nUp).toBe("This range is too short for another slot.")
    expect(stepReasons(every(3, 2, 6), 5).gUp).toBe("This range is too short for a bigger group.")
    expect(stepReasons(every(2, 2, 40), 0).nUp).toBe("No free segments. Remove a range first.")
  })

  const redBlue = (): RangeView => ({ ...allRange("A", 0, 8), pattern: { kind: "every", n: 2, group: 2 }, slots: [slot([255, 0, 0]), slot([0, 0, 255])] })

  // Fails if ledColors does not lay Every slots out by group.
  it("colors an Every range by group", () => {
    const fxs: Effect[] = [{ id: 0, name: "Solid", pal: false, sliders: [], checks: [], colors: ["Fx", "Bg", "Cs"] }]
    const pals: Palette[] = []
    const want = ["#FF0000", "#FF0000", "#0000FF", "#0000FF", "#FF0000", "#FF0000", "#0000FF", "#0000FF"]
    expect(ledColors(fxs, pals, strand([redBlue()]))).toEqual(want)
    expect(ledColors(null, null, strand([redBlue()]))).toEqual(want)
  })

  // Fails if slotColorAt does not fall back to col[0] when a palette has no stops.
  it("uses the slot color for a palette without stops", () => {
    const fxs: Effect[] = [{ id: 0, name: "Solid", pal: true, sliders: [], checks: [], colors: [] }]
    const pals: Palette[] = [{ id: 0, name: "Default", stops: [] }]
    expect(ledColors(fxs, pals, strand([allRange("A", 0, 2, [0, 255, 0])]))).toEqual(["#00FF00", "#00FF00"])
  })

  // Fails if needMsg changes its copy.
  it("words the segment budget message", () => {
    expect(needMsg(2, 1)).toBe("This needs 2 more segments and 1 is free. Remove a range first.")
  })

  // Fails if mergeInto does not append the dropped range's colors to a painted range.
  it("merges a range into a painted neighbor", () => {
    const a: RangeView = { ...allRange("A", 0, 2), pattern: { kind: "individual" }, paint: ["#111111", "#222222"] }
    const out = mergeInto(null, null, [a, allRange("B", 2, 2, [0, 0, 255])], 0, 1)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: "A", start: 0, len: 4, paint: ["#111111", "#222222", "#0000FF", "#0000FF"] })
  })

  // Fails if cutRanges does not name the ranges that cross a join between combined outputs.
  it("names the ranges that cross a join", () => {
    const ins = [{ start: 0, len: 10 }, { start: 10, len: 10 }] as Parameters<typeof cutRanges>[0]
    const st = strand([allRange("A", 0, 12), allRange("B", 12, 8)], { key: "o0+o1" })
    expect(cutRanges(ins, st)).toEqual(["A"])
  })

  // Fails if nextRangeName compares names without the device's 32-byte cut.
  it("skips a range name that matches by its 32-byte cut", () => {
    const long = "x".repeat(40)
    expect(nextRangeName([allRange("Range 2", 0, 1)])).toBe("Range 3")
    expect(nextRangeName([allRange("A", 0, 1)])).toBe("Range 2")
    expect(nameError([allRange(long, 0, 1), allRange("B", 1, 1)], 1, `${"x".repeat(32)}y`)).toBe("Another range has this name.")
  })

  // Fails if nameError does not count characters rather than UTF-16 units.
  it("limits a name to 1-64 characters", () => {
    const rs = [allRange("A", 0, 1)]
    expect(nameError(rs, 0, "  ")).toBe("A name needs 1 to 64 characters.")
    expect(nameError(rs, 0, "😀".repeat(64))).toBeNull()
    expect(nameError(rs, 0, "😀".repeat(65))).toBe("A name needs 1 to 64 characters.")
  })

  // Fails if segsNeeded counts a shared strand's changes against the budget.
  it("counts the segments a range edit adds", () => {
    const st = strand([allRange("A", 0, 8)])
    const every = withPattern(null, null, st.ranges[0]!, { kind: "every", n: 3, group: 1 })
    expect(segsNeeded(st, [every])).toBe(2)
    expect(segsNeeded({ ...st, shared: { with: ["o1"] } }, [every])).toBe(0)
  })
})
