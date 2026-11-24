import { describe, expect, it } from "vitest";
import { applyPost, bootSim, listState, simFromState, type SimState } from "./wledSim.ts";

const seg0 = { id: 0, start: 0, stop: 300, grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false, sel: true, rev: false, mi: false };

const makeSim = (): SimState => simFromState({ on: true, bri: 128, seg: [seg0] }, 32, 300);
const listed = (sim: SimState) => listState(sim).seg as Record<string, unknown>[];
const ids = (sim: SimState) => listed(sim).map((s) => s.id);

describe("applyPost segments", () => {
  // Fails if a new segment keeps its requested ID instead of being appended, or misses the default color.
  it("appends an ID past the end at the end, in the default color", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 3, start: 0, stop: 10 }] });
    expect(ids(sim)).toEqual([0, 1]);
    expect(listed(sim)[1]).toMatchObject({ start: 0, stop: 10, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] });
  });

  // Fails if a delete removes the slot instead of emptying it, or an empty slot cannot be filled again.
  it("empties a slot on stop 0 and fills it again by ID", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 0, stop: 0 }] });
    expect(ids(sim)).toEqual([]);
    expect(sim.slots).toHaveLength(1);
    applyPost(sim, { seg: [{ id: 0, start: 0, stop: 5, n: "A" }] });
    expect(listed(sim)).toEqual([expect.objectContaining({ id: 0, start: 0, stop: 5, n: "A" })]);
  });

  // Fails if deleting at least half of more than three slots does not purge and renumber.
  it("purges and renumbers when one array deletes half the slots", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [0, 1, 2, 3, 4, 5].map((k) => ({ id: k, start: k * 50, stop: k * 50 + 50, n: `S${k}` })) });
    expect(ids(sim)).toEqual([0, 1, 2, 3, 4, 5]);
    applyPost(sim, { seg: [{ id: 1, stop: 0 }, { id: 3, stop: 0 }, { id: 5, stop: 0 }] });
    expect(listed(sim).map((s) => [s.id, s.n])).toEqual([[0, "S0"], [1, "S2"], [2, "S4"]]);
  });

  // Fails if a geometry change without `n` keeps the name.
  it("clears the name when start changes without n", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 0, n: "A" }] });
    applyPost(sim, { seg: [{ id: 0, start: 5 }] });
    expect(listed(sim)[0]).not.toHaveProperty("n");
  });

  // Fails if grp is not wrapped to one byte.
  it("wraps grp to a byte", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 0, grp: 300 }] });
    expect(listed(sim)[0]).toMatchObject({ grp: 44 });
  });

  // Fails if `i` does not freeze and paint, or power-on does not unfreeze.
  it("paints with i, freezes, and unfreezes on power-on", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 0, i: [0, 2, "FF0000"] }] });
    expect(listed(sim)[0]).toMatchObject({ frz: true });
    expect(sim.slots[0]?.pixels.slice(0, 3)).toEqual(["#FF0000", "#FF0000", null]);
    applyPost(sim, { on: false });
    applyPost(sim, { on: true });
    expect(listed(sim)[0]).toMatchObject({ frz: false });
  });
});

describe("applyPost psave and bootSim", () => {
  // Fails if psave does not apply the body, or stores o, psave or bootps, or ignores bootps.
  it("applies a psave body, stores it cleaned and sets the boot preset", () => {
    const sim = makeSim();
    applyPost(sim, { psave: 250, o: true, n: "Strand: startup", bootps: 250, seg: [{ id: 0, n: "X" }] });
    expect(sim.presets["250"]).toEqual({ n: "Strand: startup", seg: [{ id: 0, n: "X" }] });
    expect(sim.bootps).toBe(250);
    expect(listed(sim)[0]).toMatchObject({ n: "X" });
  });

  // Fails if boot keeps the old segments, ignores def, or does not apply the boot preset to fresh auto segments.
  it("boots to one auto segment per output, def power, then the boot preset", () => {
    const sim = makeSim();
    applyPost(sim, { seg: [{ id: 0, stop: 100, n: "Old" }, { id: 1, start: 100, stop: 300 }] });
    applyPost(sim, { psave: 250, o: true, bootps: 250, seg: [{ id: 0, n: "Left" }, { id: 2, start: 0, stop: 10 }] });
    bootSim(sim, { on: false, bri: 77 }, { outputs: [{ start: 0, len: 150 }, { start: 150, len: 150 }] });
    expect(listState(sim)).toMatchObject({ on: false, bri: 77, mainseg: 0 });
    expect(listed(sim).map((s) => [s.id, s.start, s.stop, s.n])).toEqual([
      [0, 0, 150, "Left"],
      [1, 150, 300, undefined],
      [2, 0, 10, undefined],
    ]);
  });
});
