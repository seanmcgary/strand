import { describe, expect, it } from "vitest";
import { applyPost, bootSim, listState, simFromState } from "../../test/wledSim";
import { encodePaint, parseState, type WledState } from "./layoutRead";
import { buildStartupPreset } from "./startup";

const seg = (id: number, start: number, stop: number, over: Record<string, unknown> = {}) => ({
  id,
  start,
  stop,
  grp: 1,
  spc: 0,
  of: 0,
  on: true,
  frz: false,
  bri: 200,
  col: [
    [10, 20, 30],
    [0, 0, 0],
    [0, 0, 0],
  ],
  fx: 9,
  sx: 100,
  ix: 90,
  c1: 80,
  c2: 70,
  c3: 5,
  o1: true,
  o2: false,
  o3: true,
  pal: 6,
  ...over,
});

const peak = ["#FF0000", "#FF0000", "#00FF00", "#0000FF"];

describe("buildStartupPreset", () => {
  // Fails if the preset stops listing every ID up to maxseg, drops a field or the paint, keeps a flash segment, or gains a top-level on or bri.
  it("lists every segment ID with full bodies, paint, and the flash segment deleted", () => {
    const state: WledState = parseState({
      on: true,
      bri: 128,
      seg: [seg(0, 0, 10, { n: "Porch" }), seg(2, 10, 14, { n: "Peak paint", frz: true }), seg(3, 5, 6, { n: "Strand flash" })],
    });
    const preset = buildStartupPreset(state, { "Peak paint": peak }, 4);
    expect(preset).toEqual({
      psave: 250,
      o: true,
      n: "Strand: startup",
      bootps: 250,
      seg: [
        { ...state.seg[0] },
        { id: 1, stop: 0 },
        { ...state.seg[1], i: encodePaint(peak) },
        { id: 3, stop: 0 },
      ],
    });
    expect(preset).not.toHaveProperty("on");
    expect(preset).not.toHaveProperty("bri");
  });

  // Fails if loading the preset at boot no longer rebuilds the same segments and paint, or if it overrides the boot power.
  it.each([
    ["one auto segment", undefined],
    [
      "two auto segments",
      [
        { start: 0, len: 150 },
        { start: 150, len: 150 },
      ],
    ],
  ])("rebuilds the layout at boot over %s", (_label, outputs) => {
    const sim = simFromState(
      {
        on: true,
        bri: 200,
        seg: [
          seg(0, 0, 100, { n: "Porch" }),
          seg(2, 100, 200, { n: "Eaves 1/2", grp: 2, spc: 2 }),
          seg(3, 102, 200, { n: "Eaves 2/2", grp: 2, spc: 2, fx: 0 }),
          seg(5, 200, 204, { n: "Peak paint", frz: true }),
          seg(6, 204, 300, { on: false }),
        ],
      },
      8,
      300,
    );
    const before = parseState(listState(sim));
    applyPost(sim, buildStartupPreset(before, { "Peak paint": peak }, 8));
    bootSim(sim, { on: false, bri: 128 }, outputs ? { outputs } : {});

    const after = listState(sim);
    const noId = (s: WledState["seg"][number]) => ({ ...s, id: 0 });
    expect(after.on).toBe(false);
    expect(parseState(after).seg.map(noId)).toEqual(before.seg.map(noId));
    expect(sim.slots.find((s) => s?.n === "Peak paint")!.pixels).toEqual(peak);
  });
});
