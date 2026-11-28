import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RangeView, SlotView, StrandPatch } from "../../shared/apiTypes";
import { seeds } from "../../test/fixtures/seeds";
import { applyPost, listState, simFromState, type SimState } from "../../test/wledSim";
import { decodePaint, paintKey, parseState, readLayout, readStrand, strandsFromConfig, type PaintMap, type Strand, type WledState } from "./layoutRead";
import { LayoutError, segmentsNeeded, validateRanges, writeStrand, type LayoutWrite, type SegPatch } from "./layoutWrite";

const lists = { effects: seeds.backyard.effects, palettes: seeds.backyard.palettes };
const [o0, o1] = strandsFromConfig(seeds.backyard.cfg, [], {}).strands as [Strand, Strand];

const slot = (over: Partial<SlotView> = {}): SlotView => ({
  on: true,
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
const all = (name: string, start: number, len: number, over: Partial<SlotView> = {}): RangeView => ({ name, start, len, pattern: { kind: "all" }, slots: [slot(over)] });

const sim = (seg: object[], maxseg = 32, ledCount = 300): SimState => simFromState({ on: true, bri: 200, seg }, maxseg, ledCount);
const stateOf = (s: SimState): WledState => parseState(listState(s));
const deviceState = (seg: object[], maxseg = 32): WledState => stateOf(sim(seg, maxseg));
const splitBackyard = [
  { id: 0, n: "Range 1", start: 0, stop: 150, col: [[255, 160, 0]] },
  { id: 1, n: "Range 1", start: 150, stop: 300, col: [[255, 160, 0]] },
];

const write = (state: WledState, ranges: RangeView[], paint: PaintMap = {}, maxseg = 32): LayoutWrite => writeStrand(state, o0, { ranges }, lists, paint, maxseg);
const flat = (w: LayoutWrite): SegPatch[] => w.seg.flat();
const viewOf = (state: WledState, strand = o0, paint: PaintMap = {}) => readStrand(state, strand, lists, paint).view;

/** Sends a write to the simulator as the endpoint does: each request in order, then each paint entry to the segment with its name. */
function send(s: SimState, w: LayoutWrite): void {
  for (const req of w.seg) applyPost(s, { seg: req });
  for (const entry of w.paint) {
    const target = (listState(s).seg as { id: number; n?: string }[]).find((seg) => seg.n === entry.name);
    if (!target) throw new Error(`no segment named ${entry.name}`);
    applyPost(s, { seg: [{ id: target.id, i: entry.i }] });
  }
}

const layoutError = (fn: () => unknown): LayoutError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof LayoutError) return err;
    throw err;
  }
  throw new Error("expected a LayoutError");
};

describe("writeStrand", () => {
  // Fails if writeStrand touches a segment of another strand, deletes before it reuses an ID, or sends sel/mainseg.
  it("writes only the edited strand and reuses its segment ID", () => {
    const w = write(deviceState(splitBackyard), [all("A", 0, 75), all("B", 75, 75)]);
    const patches = flat(w);
    expect(patches.some((p) => p.id === 1)).toBe(false);
    expect(patches.find((p) => p.id === 0)).toMatchObject({ n: "A", start: 0, stop: 75 });
    expect(patches.find((p) => p.id === 2)).toMatchObject({ n: "B", start: 75, stop: 150 });
    expect(patches.some((p) => "sel" in p || "mainseg" in p)).toBe(false);
  });

  // Fails if a matched range sends fields that did not change, or resends paint it does not have.
  it("patches only the changed slot field of a matched range", () => {
    const s = sim(splitBackyard);
    send(s, write(stateOf(s), [all("A", 0, 75), all("B", 75, 75)]));
    const blue = [
      [0, 0, 255],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(write(stateOf(s), [all("A", 0, 75), all("B", 75, 75, { col: blue })])).toEqual({ seg: [[{ id: 2, col: blue }]], paint: [] });
  });

  // Fails if a rename does not patch n on every segment of the range with its tag, or sends anything else.
  it("renames an Every range on each of its segments", () => {
    const state = deviceState([
      { id: 0, n: "Patio 1/2", start: 0, stop: 60, grp: 2, spc: 2 },
      { id: 1, n: "Patio 2/2", start: 2, stop: 60, grp: 2, spc: 2 },
      { id: 2, n: "Rest", start: 60, stop: 150 },
    ]);
    const ranges = viewOf(state).ranges.map((r) => (r.name === "Patio" ? { ...r, name: "Deck" } : r));
    expect(write(state, ranges)).toEqual({
      seg: [
        [
          { id: 0, n: "Deck 1/2" },
          { id: 1, n: "Deck 2/2" },
        ],
      ],
      paint: [],
    });
  });

  // Fails if the Every N geometry of a new range is not the spec §6.2 table, relative to the strand start.
  it("writes Every 3 group 2 as three overlapping segments", () => {
    const every: RangeView = { name: "X", start: 10, len: 30, pattern: { kind: "every", n: 3, group: 2 }, slots: [slot(), slot(), slot()] };
    const created = flat(write(deviceState(splitBackyard), [all("A", 0, 10), every, all("B", 40, 110)])).filter((p) => p.n?.startsWith("X "));
    expect(created.map(({ start, stop, grp, spc, n }) => ({ start, stop, grp, spc, n }))).toEqual([
      { start: 10, stop: 40, grp: 2, spc: 4, n: "X 1/3" },
      { start: 12, stop: 40, grp: 2, spc: 4, n: "X 2/3" },
      { start: 14, stop: 40, grp: 2, spc: 4, n: "X 3/3" },
    ]);
  });

  // Fails if new segments do not take the unlisted IDs below the highest listed ID first, then the IDs above it.
  it("fills unlisted IDs before it grows the vector", () => {
    const state = deviceState([
      { id: 0, start: 150, stop: 200 },
      { id: 2, start: 200, stop: 250 },
      { id: 5, start: 250, stop: 300 },
    ]);
    const every: RangeView = { name: "E", start: 0, len: 150, pattern: { kind: "every", n: 4, group: 1 }, slots: [slot(), slot(), slot(), slot()] };
    expect(flat(write(state, [every])).map((p) => p.id)).toEqual([1, 3, 4, 6]);
  });

  // Fails if a large delete is sent in one request (the firmware then purges and renumbers every segment).
  it("splits deletes so the firmware does not purge", () => {
    const eight = Array.from({ length: 8 }, (_, id) => ({ id, n: `S${id}`, start: id * 18, stop: id === 7 ? 150 : (id + 1) * 18 }));
    const w = write(deviceState(eight), [all("All", 0, 150)]);
    const deletes = (req: SegPatch[]) => req.filter((p) => p.stop === 0);
    for (const req of w.seg) expect(deletes(req).length).toBeLessThanOrEqual(3);
    expect(w.seg.at(-1)).toContainEqual(expect.objectContaining({ id: 0, n: "All", start: 0, stop: 150 }));
    expect(w.seg.flatMap(deletes).map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // Fails if a strand marked normalize is diffed instead of rewritten from the view.
  it("rewrites a normalize strand from its view", () => {
    const state = deviceState([{ id: 0, n: "Porch", start: 0, stop: 150, grp: 3 }]);
    const view = viewOf(state);
    expect(view.normalize).toBe(true);
    expect(flat(write(state, view.ranges))).toContainEqual(expect.objectContaining({ id: 0, grp: 1, spc: 0 }));
  });

  // Fails if a new Individual range has no paint entry, or the paint is not run-length encoded under the paint name.
  it("sends the paint of a new Individual range by segment name", () => {
    const paint = [...Array<string>(5).fill("#FF0000"), ...Array<string>(5).fill("#FFFFFF")];
    const peak: RangeView = { name: "Peak", start: 0, len: 10, pattern: { kind: "individual" }, slots: [slot()], paint };
    expect(write(deviceState(splitBackyard), [peak, all("Rest", 10, 140)]).paint).toEqual([{ name: "Peak paint", start: 0, i: [0, 5, "FF0000", 5, 10, "FFFFFF"] }]);
  });

  // Fails if turning a strand on does not patch each segment or does not send the paint again.
  it("turns a painted strand on with its paint", () => {
    const paint = Array<string>(10).fill("#00FF00");
    const state = deviceState([
      { id: 0, n: "Peak paint", start: 0, stop: 10, frz: true, on: false },
      { id: 1, n: "Rest", start: 10, stop: 150, on: false },
    ]);
    expect(writeStrand(state, o0, { on: true }, lists, { "0:Peak paint": paint }, 32)).toEqual({
      seg: [
        [
          { id: 0, on: true },
          { id: 1, on: true },
        ],
      ],
      paint: [{ name: "Peak paint", start: 0, i: [0, 10, "00FF00"] }],
    });
  });

  // Fails if writeStrand writes ranges without validating them first.
  it("refuses ranges that leave a gap", () => {
    expect(layoutError(() => write(deviceState(splitBackyard), [all("A", 0, 70), all("B", 75, 75)])).code).toBe("invalid_layout");
  });

  // Fails if an effect ID the device already has on that slot, but not in its list, blocks the edit (or any unknown ID passes).
  it("accepts an unknown effect only where the device has it", () => {
    const state = deviceState([{ id: 0, n: "Odd", start: 0, stop: 150, fx: 200 }]);
    const ranges = viewOf(state).ranges;
    expect(flat(write(state, [{ ...ranges[0]!, slots: [{ ...ranges[0]!.slots[0]!, sx: 10 }] }]))).toEqual([{ id: 0, sx: 10 }]);
    expect(layoutError(() => write(deviceState(splitBackyard), [all("A", 0, 150, { fx: 200 })])).code).toBe("invalid_layout");
  });

  // Fails if the unknown-effect exception needs the range to keep its position, so a boundary drag is refused.
  it("keeps an unknown effect when a boundary moves", () => {
    const state = deviceState([
      { id: 0, n: "A", start: 0, stop: 75 },
      { id: 1, n: "Odd", start: 75, stop: 150, fx: 200 },
    ]);
    const odd = viewOf(state).ranges[1]!;
    expect(() => write(state, [all("A", 0, 80), { ...odd, start: 80, len: 70 }])).not.toThrow();
  });

  // Fails if the color diff ignores device colors the slot leaves out, or counts an RGBW read-back as a change.
  it("compares every color slot by its RGB part", () => {
    const state = deviceState([{ id: 0, n: "A", start: 0, stop: 150, col: [[255, 0, 0], [0, 255, 0], [0, 0, 0]] }]);
    expect(flat(write(state, [all("A", 0, 150, { col: [[255, 0, 0]] })]))).toEqual([{ id: 0, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] }]);
    const rgbw = { ...state, seg: [{ ...state.seg[0]!, col: [[255, 0, 0, 7], [0, 0, 0, 0], [0, 0, 0, 0]] }] };
    expect(write(rgbw, [all("A", 0, 150, { col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] })]).seg).toEqual([]);
  });

  // Fails if a shared strand's slot edit does not reach the crossing segment.
  it("edits only the slot of a shared strand", () => {
    const state = deviceState([{ id: 0, start: 0, stop: 300 }]);
    expect(flat(write(state, [all("Range 1", 0, 150, { fx: 2 })]))).toEqual([expect.objectContaining({ id: 0, fx: 2 })]);
  });

  // Fails if a shared strand's one range can be renamed (the name has no segment of its own to live on).
  it("refuses a rename on a shared strand", () => {
    expect(layoutError(() => write(deviceState([{ id: 0, start: 0, stop: 300 }]), [all("Eaves", 0, 150)])).code).toBe("shared");
  });

  // Fails if segmentsNeeded ignores sharedNames and refuses the names a separate cut writes.
  it("counts segments with the write's options", () => {
    const next = { ranges: [all("A", 0, 75), all("A", 75, 75)] };
    expect(segmentsNeeded(deviceState(splitBackyard), o0, next, lists, {}, { sharedNames: true })).toBe(1);
  });

  // Fails if segmentName is not used for tags (bytes over 32, a split code point, or a cut tag).
  it("keeps long multi-byte names within 32 bytes with whole tags", () => {
    const every: RangeView = { name: "Küche Fenster Nord Süd Ost West Garten", start: 0, len: 150, pattern: { kind: "every", n: 2, group: 1 }, slots: [slot(), slot()] };
    const names = flat(write(deviceState(splitBackyard), [every])).map((p) => p.n!);
    expect(names).toHaveLength(2);
    names.forEach((n, k) => {
      const bytes = new TextEncoder().encode(n);
      expect(bytes.length).toBeLessThanOrEqual(32);
      expect(n.endsWith(` ${k + 1}/2`)).toBe(true);
      expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(n);
    });
  });
});

describe("validateRanges", () => {
  const paint = Array<string>(10).fill("#FF0000");
  // Fails if any one contract rule is dropped from validateRanges.
  it.each<[string, RangeView[]]>([
    ["an overlap", [all("A", 0, 80), all("B", 75, 75)]],
    ["two ranges named A", [all("A", 0, 75), all("A", 75, 75)]],
    ["c3 32", [all("A", 0, 150, { c3: 32 })]],
    ["a 65-character name", [all("x".repeat(65), 0, 150)]],
    ["a 65-emoji name", [all("🎄".repeat(65), 0, 150)]],
    ["two names equal after the 32-byte cut", [all(`${"x".repeat(32)}1`, 0, 75), all(`${"x".repeat(32)}2`, 75, 75)]],
    ["paint of the wrong length", [{ name: "P", start: 0, len: 11, pattern: { kind: "individual" }, slots: [slot()], paint }, all("B", 11, 139)]],
    ["Every with a slot past the range end", [{ name: "E", start: 0, len: 2, pattern: { kind: "every", n: 3, group: 1 }, slots: [slot(), slot(), slot()] }, all("B", 2, 148)]],
  ])("refuses %s", (_, ranges) => {
    expect(validateRanges(o0, ranges, lists.effects.length)).not.toBeNull();
  });

  // Fails if sharedNames does not lift the unique-name rule, or a valid layout is refused.
  it("accepts a valid layout, and shared names when allowed", () => {
    const twoA = [all("A", 0, 75), all("A", 75, 75)];
    expect(validateRanges(o0, twoA, lists.effects.length, { sharedNames: true })).toBeNull();
    expect(validateRanges(o0, [all("A", 0, 75), all("B", 75, 75)], lists.effects.length)).toBeNull();
    expect(validateRanges(o0, [all("🎄".repeat(64), 0, 150)], lists.effects.length)).toBeNull();
  });

  // Fails if, among current ranges that share a name, the unknown-effect exception is taken from one other than the nearest start.
  it("takes the unknown-effect exception from the nearest range of that name", () => {
    const current = [all("A", 0, 75, { fx: 200 }), all("A", 75, 75)];
    const next = [all("A", 0, 70), all("A", 70, 80, { fx: 200 })];
    expect(validateRanges(o0, next, lists.effects.length, { sharedNames: true, current })).not.toBeNull();
    expect(validateRanges(o0, [all("A", 0, 80, { fx: 200 }), all("A", 80, 70)], lists.effects.length, { sharedNames: true, current })).toBeNull();
  });

  // Fails if readLayout can produce names that validateRanges refuses (finding F7).
  it("accepts the names readLayout gives to repeated and missing names", () => {
    const state = deviceState([
      { id: 0, n: "Porch", start: 0, stop: 50 },
      { id: 1, n: "Porch", start: 50, stop: 100 },
    ]);
    const view = readLayout(state, [o0, o1], lists, {}, 32).strands[0]!;
    expect(validateRanges(o0, view.ranges, lists.effects.length)).toBeNull();
    const full = "x".repeat(32);
    const cut = deviceState([
      { id: 0, n: full, start: 0, stop: 50 },
      { id: 1, n: full, start: 50, stop: 150 },
    ]);
    expect(validateRanges(o0, readLayout(cut, [o0, o1], lists, {}, 32).strands[0]!.ranges, lists.effects.length)).toBeNull();
  });
});

describe("round trip", () => {
  const COLORS = ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF"];
  const byte = fc.integer({ min: 0, max: 255 });
  const slotArb: fc.Arbitrary<SlotView> = fc
  .record({
    on: fc.boolean(),
    col: fc.array(fc.array(byte, { minLength: 3, maxLength: 3 }), { minLength: 3, maxLength: 3 }),
    fx: fc.integer({ min: 0, max: 9 }),
    sx: byte,
    ix: byte,
    c1: byte,
    c2: byte,
    c3: fc.integer({ min: 0, max: 31 }),
    o1: fc.boolean(),
    o2: fc.boolean(),
    o3: fc.boolean(),
    pal: fc.integer({ min: 0, max: lists.palettes.length - 1 }),
  })
  .map((s) => ({ ...s, fxName: lists.effects[s.fx]!, palName: lists.palettes[s.pal]! }));

  const bodyArb = (len: number): fc.Arbitrary<Pick<RangeView, "pattern" | "slots" | "paint">> => {
    const allArb = slotArb.map((s) => ({ pattern: { kind: "all" as const }, slots: [s] }));
    const paintArb = fc
    .tuple(slotArb, fc.array(fc.constantFrom(...COLORS), { minLength: len, maxLength: len }))
    .map(([s, paint]) => ({ pattern: { kind: "individual" as const }, slots: [s], paint }));
    if (len < 2) return fc.oneof(allArb, paintArb);
    const everyArb = fc.integer({ min: 2, max: Math.min(16, len) }).chain((n) =>
      fc
      .tuple(fc.integer({ min: 1, max: Math.floor(Math.min(255, len - 1) / (n - 1)) }), fc.array(slotArb, { minLength: n, maxLength: n }))
      .map(([group, slots]) => ({ pattern: { kind: "every" as const, n, group }, slots })),
    );
    return fc.oneof(allArb, paintArb, everyArb);
  };

  const layoutArb = (len: number): fc.Arbitrary<RangeView[]> => {
    const cuts = len < 2 ? fc.constant<number[]>([]) : fc.uniqueArray(fc.integer({ min: 1, max: len - 1 }), { maxLength: Math.min(len - 1, 4) });
    return cuts.chain((c) => {
      const bounds = [0, ...[...c].sort((a, b) => a - b), len];
      const spans = bounds.slice(1).map((stop, k) => ({ start: bounds[k]!, len: stop - bounds[k]! }));
      return fc
      .tuple(fc.uniqueArray(fc.stringMatching(/^[A-Z][a-z]{0,10}$/), { minLength: spans.length, maxLength: spans.length }), fc.tuple(...spans.map((s) => bodyArb(s.len))))
      .map(([names, bodies]) => spans.map((s, k) => ({ name: names[k]!, ...s, ...bodies[k]! })));
    });
  };

  const segCount = (ranges: RangeView[]) => ranges.reduce((sum, r) => sum + r.slots.length, 0);
  const o1SegArb = (from: number) =>
    fc.array(
      fc.tuple(fc.integer({ min: 0, max: 49 }), fc.integer({ min: 1, max: 50 })).map(([a, b]) => ({ start: from + Math.min(a, b - 1), stop: from + Math.max(a + 1, b) })),
      { minLength: 1, maxLength: 3 },
    );

  const caseArb = fc.integer({ min: 1, max: 300 }).chain((len) =>
    fc.record({
      len: fc.constant(len),
      o1Segs: o1SegArb(len),
      o1Id: fc.integer({ min: 1, max: 29 }),
      start: fc.option(fc.tuple(layoutArb(len), fc.integer({ min: 1, max: 255 }))),
      next: layoutArb(len),
      bri: fc.integer({ min: 1, max: 255 }),
    }),
  )
  .filter((c) => segCount(c.next) <= 32 - c.o1Segs.length && (c.start === null || segCount(c.start[0]) <= 32 - c.o1Segs.length));

  // Fails if any layout Strand writes does not read back as written, touches the other strand, sends sel/mainseg, or overflows maxseg.
  it("reads back every layout it writes", () => {
    fc.assert(
      fc.property(caseArb, ({ len, o1Segs, o1Id, start, next, bri }) => {
        const strand: Strand = { ...o0, len };
        const other: Strand = { ...o1, start: len, len: 50 };
        const seed = (seeds.backyard.state.seg as object[])[0]!;
        const s = sim([{ ...seed, id: 0, stop: len, len }, ...o1Segs.map((g, k) => ({ id: o1Id + k, ...g }))], 32, len + 50);
        const paint: PaintMap = {};
        const requests: SegPatch[][] = [];
        const run = (patch: StrandPatch) => {
          const w = writeStrand(stateOf(s), strand, patch, lists, paint, 32);
          requests.push(...w.seg);
          send(s, w);
          const after = stateOf(s);
          for (const entry of w.paint) {
            const seg = after.seg.find((g) => g.n === entry.name && g.start === entry.start)!;
            paint[paintKey(entry.start, entry.name)] = decodePaint(entry.i, seg.stop - seg.start);
          }
        };
        const others = () => (listState(s).seg as { start: number }[]).filter((g) => g.start >= len);

        if (start) run({ on: start[0].some((r) => r.slots.some((x) => x.on)), bri: start[1], ranges: start[0] });
        const before = others();
        const on = next.some((r) => r.slots.some((x) => x.on));
        run({ on, bri, ranges: next });

        const view = readLayout(stateOf(s), [strand, other], lists, paint, 32).strands[0]!;
        expect(view.ranges).toEqual(next);
        expect({ on: view.on, bri: view.bri, normalize: view.normalize }).toEqual({ on, bri, normalize: false });
        expect(others()).toEqual(before);
        expect(requests.flat().some((p) => "sel" in p || "mainseg" in p)).toBe(false);
        expect(listState(s).seg.length).toBeLessThanOrEqual(32);
      }),
      { numRuns: 300, seed: 4242 },
    );
  });
});
