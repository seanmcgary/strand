import { describe, expect, it } from "vitest";
import { seeds } from "../../test/fixtures/seeds";
import { listState, simFromState } from "../../test/wledSim";
import { decodePaint, encodePaint, parseState, readLayout, segmentName, strandsFromConfig, type PaintMap } from "./layoutRead";

const lists = { effects: seeds.backyard.effects, palettes: seeds.backyard.palettes };
const backyard = strandsFromConfig(seeds.backyard.cfg, [], {}).strands;
const frontRoof = strandsFromConfig(seeds.frontRoof.cfg, [], {}).strands;

/** The device's `/json/state` reply for these segments, as the firmware lists them. */
const deviceState = (seg: object[]) => parseState(listState(simFromState({ on: true, bri: 200, seg }, 32, 300)));

const read = (seg: object[], strands = backyard, paint: PaintMap = {}) => readLayout(deviceState(seg), strands, lists, paint, 32);

describe("strandsFromConfig", () => {
  // Fails if strandsFromConfig stops making one strand per LED output with its key, default name, pins and span.
  it("makes one strand per output", () => {
    expect(strandsFromConfig(seeds.backyard.cfg, [], {})).toEqual({
      strands: [
        { key: "o0", name: "Strand 1", pins: [16], start: 0, len: 150, members: ["o0"] },
        { key: "o1", name: "Strand 2", pins: [17], start: 150, len: 150, members: ["o1"] },
      ],
      dropped: [],
    });
  });

  // Fails if a valid group does not replace its members or its name ignores the names map.
  it("combines a group of touching strands", () => {
    const combined = (names: Record<string, string>) => strandsFromConfig(seeds.backyard.cfg, ["o0+o1"], names).strands;
    expect(combined({})).toEqual([{ key: "o0+o1", name: "Strand 1 + Strand 2", pins: [16, 17], start: 0, len: 300, members: ["o0", "o1"] }]);
    expect(combined({ o0: "Eaves" })[0]!.name).toBe("Eaves + Strand 2");
    expect(combined({ "o0+o1": "Roof" })[0]!.name).toBe("Roof");
  });

  // Fails if a group with a missing member or with members that do not touch is kept instead of dropped.
  it("drops groups that do not fit the config", () => {
    expect(strandsFromConfig(seeds.backyard.cfg, ["o1+o0", "o0+o2", "o0"], {})).toEqual({ strands: backyard, dropped: ["o1+o0", "o0+o2", "o0"] });
  });
});

describe("readLayout", () => {
  const patio = [
    { id: 0, n: "Patio 1/2", start: 0, stop: 60, grp: 2, spc: 2 },
    { id: 1, n: "Patio 2/2", start: 2, stop: 60, grp: 2, spc: 2 },
  ];

  // Fails if tagged segments are not grouped into one Every range named by their base.
  it("reads tagged segments as an Every range", () => {
    const strand = read([...patio, { id: 2, n: "Rest", start: 60, stop: 150 }]).strands[0]!;
    expect(strand.ranges).toMatchObject([
      { name: "Patio", start: 0, len: 60, pattern: { kind: "every", n: 2, group: 2 } },
      { name: "Rest", start: 60, len: 90, pattern: { kind: "all" } },
    ]);
    expect(strand.ranges[0]!.slots).toHaveLength(2);
    expect(strand.normalize).toBe(false);
  });

  // Fails if untagged segments are not grouped by geometry or an unnamed range gets no default name.
  it("reads unnamed segments with Every geometry as an Every range", () => {
    const strand = read(patio.map(({ n: _n, ...seg }) => seg)).strands[0]!;
    expect(strand.ranges[0]).toMatchObject({ name: "Range 1", start: 0, len: 60, pattern: { kind: "every", n: 2, group: 2 } });
  });

  // Fails if a segment with grouping no pattern uses is not read as All and marked for normalizing.
  it("reads other grouping as All and normalizes", () => {
    const strand = read([{ id: 0, n: "Porch", start: 0, stop: 150, grp: 3, spc: 1 }]).strands[0]!;
    expect(strand.ranges).toMatchObject([{ name: "Porch", start: 0, len: 150, pattern: { kind: "all" } }]);
    expect(strand.normalize).toBe(true);
  });

  // Fails if LEDs that no segment covers do not become an off range and mark the strand for normalizing.
  it("fills a gap with an off range", () => {
    const strand = read([{ id: 0, n: "Patio", start: 0, stop: 100 }]).strands[0]!;
    expect(strand.ranges[1]).toMatchObject({ name: "Range 2", start: 100, len: 50, pattern: { kind: "all" } });
    expect(strand.ranges[1]!.slots).toEqual([
      { on: false, col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], fx: 0, fxName: lists.effects[0], sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false, pal: 0, palName: lists.palettes[0] },
    ]);
    expect(strand.normalize).toBe(true);
  });

  // Fails if a segment that overlaps a range read earlier is kept instead of left out.
  it("leaves out an overlapping segment", () => {
    const strand = read([
      { id: 1, n: "All", start: 0, stop: 150 },
      { id: 2, n: "Spot", start: 50, stop: 60 },
    ]).strands[0]!;
    expect(strand.ranges.map((r) => r.name)).toEqual(["All"]);
    expect(strand.normalize).toBe(true);
  });

  // Fails if two ranges read back with the same name or a default name repeats a device name.
  it("makes range names unique in a strand", () => {
    const strand = read([
      { id: 0, n: "Porch", start: 0, stop: 50 },
      { id: 1, n: "Porch", start: 50, stop: 100 },
    ]).strands[0]!;
    expect(strand.ranges.map((r) => r.name)).toEqual(["Porch", "Porch 2", "Range 3"]);
  });

  // Fails if a frozen paint segment is not read as an Individual range with the paint from the map, or col[0] without it.
  it("reads a paint segment as an Individual range", () => {
    const seg = [
      { id: 0, n: "Gutter", start: 0, stop: 200 },
      { id: 1, n: "Peak paint", start: 200, stop: 300, frz: true, col: [[255, 0, 0]] },
    ];
    const paint = Array.from({ length: 100 }, (_, k) => (k % 10 < 5 ? "#FF0000" : "#FFFFFF"));
    const withPaint = read(seg, frontRoof, { "200:Peak paint": paint }).strands[0]!.ranges[1]!;
    expect(withPaint).toMatchObject({ name: "Peak", start: 200, len: 100, pattern: { kind: "individual" }, paint });
    expect(read(seg, frontRoof).strands[0]!.ranges[1]!.paint).toEqual(Array(100).fill("#FF0000"));
  });

  // Fails if a segment over two uncombined strands does not mark both shared with each other.
  it("marks strands that share a segment", () => {
    const { strands } = read([{ id: 0, n: "Everything", start: 0, stop: 300 }]);
    expect(strands.map((s) => [s.key, s.shared, s.ranges.map((r) => [r.name, r.start, r.len])])).toEqual([
      ["o0", { with: ["o1"] }, [["Range 1", 0, 150]]],
      ["o1", { with: ["o0"] }, [["Range 1", 0, 150]]],
    ]);
  });

  // Fails if the segment count leaves out a flash segment or the flash segment is read as a range.
  it("ignores a flash segment but counts it", () => {
    const view = read([
      { id: 0, n: "Rest", start: 0, stop: 150 },
      { id: 1, n: "Strand flash", start: 10, stop: 11 },
    ]);
    expect(view.strands[0]!.ranges.map((r) => r.name)).toEqual(["Rest"]);
    expect(view.strands[0]!.normalize).toBe(false);
    expect(view.segments).toEqual({ used: 2, max: 32 });
  });
});

describe("parseState", () => {
  // Fails if parseState passes through a malformed field instead of dropping or defaulting it.
  it("checks the device reply", () => {
    const state = parseState({
      on: "x",
      seg: [
        { id: 0, start: "x", stop: 5 },
        { id: 1, start: 0, stop: 10, n: "A".repeat(100), col: [[300, 0, 0], "red"], grp: -1, c3: 99 },
      ],
    });
    expect(state.on).toBe(false);
    expect(state.seg.map((s) => s.id)).toEqual([1]);
    expect(state.seg[0]).toMatchObject({ n: "A".repeat(32), col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], grp: 1, c3: 16 });
  });
});

describe("segmentName", () => {
  // Fails if a long multi-byte name is not cut on a UTF-8 boundary to leave room for the whole tag.
  it("fits a multi-byte name and its tag in 32 bytes", () => {
    const name = segmentName("Küche Fenster Nord Süd Ost West Garten", { k: 1, n: 2 });
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(32);
    expect(name.endsWith(" 1/2")).toBe(true);
    expect(Buffer.from(name).toString()).toBe(name);
  });
});

describe("paint", () => {
  // Fails if decodePaint or encodePaint stop following the firmware's `seg.i` run semantics.
  it("decodes and encodes runs", () => {
    expect(decodePaint([0, 2, "FF0000", "00FF00"], 4)).toEqual(["#FF0000", "#FF0000", "#00FF00", "#000000"]);
    expect(encodePaint(["#FF0000", "#FF0000", "#FFFFFF"])).toEqual([0, 2, "FF0000", 2, 3, "FFFFFF"]);
  });

  // Fails if decodePaint lets an out-of-range index or a malformed color change the output's length or shape.
  it("decodes malformed paint safely", () => {
    const out = decodePaint([-5, 999, "ZZZZZZ", 0, 2, "FF0000", [1, 2], "<b>"], 4);
    expect(out).toHaveLength(4);
    for (const c of out) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(out.slice(0, 2)).toEqual(["#FF0000", "#FF0000"]);
  });
});
