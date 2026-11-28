import { afterEach, describe, expect, it } from "vitest";
import type { LightsView, RangeView } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds, type Seed } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as strandGroups from "../db/strandGroups";
import { encodePaint, FLASH_NAME } from "../lights/layoutRead";
import { psaves } from "../../test/lightsRuntime";

const fakes: FakeWled[] = [];

async function setup(seed: Seed = seeds.backyard, opts: { flashMs?: number; startupDelayMs?: number; infoOverride?: object } = {}) {
  const t = makeTestApp({ flashMs: opts.flashMs, startupDelayMs: opts.startupDelayMs });
  const f = await startFakeWled(seed, { infoOverride: opts.infoOverride });
  fakes.push(f);
  const row = t.addFake(f, seed);
  return { t, f, row, url: (path: string) => `/api/devices/${row.id}/${path}` };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const posts = (f: FakeWled) => f.requests.filter((r) => r.method === "POST");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flashSegs = (f: FakeWled) => (f.state.seg as { n?: string }[]).filter((s) => s.n === FLASH_NAME);
const candy = Array.from({ length: 100 }, (_, k) => (Math.floor(k / 5) % 2 === 0 ? "#FF0000" : "#FFFFFF"));

const seg = (id: number, n: string, start: number, stop: number, more: Record<string, unknown> = {}) => ({
  id,
  n,
  start,
  stop,
  grp: 1,
  spc: 0,
  on: true,
  bri: 255,
  col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]],
  fx: 0,
  pal: 0,
  ...more,
});

/** Front Roof as the demo has it: "Gutter" 0-200 and the frozen "Peak paint" 200-300, whose paint only preset 250 holds. */
async function roof() {
  const s = await setup(seeds.frontRoof);
  s.f.applyState({ seg: [seg(0, "Gutter", 0, 200), seg(1, "Peak paint", 200, 300, { frz: true })] });
  s.f.applyState({
    psave: 250,
    o: true,
    n: "Strand: startup",
    seg: [seg(0, "Gutter", 0, 200), seg(1, "Peak paint", 200, 300, { frz: true, i: encodePaint(candy) })],
  });
  return s;
}

describe("GET lights", () => {
  // Fails if the route is missing, or its view is not the readDeviceLights view of the device.
  it("answers the strands of Backyard and writes nothing", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("lights") });
    expect(res.statusCode).toBe(200);
    const view = res.json<LightsView>();
    expect(view.strands.map((s) => [s.key, s.shared])).toEqual([
      ["o0", { with: ["o1"] }],
      ["o1", { with: ["o0"] }],
    ]);
    expect(view.strands.map((s) => s.ranges.map((r) => [r.name, r.len]))).toEqual([[["Range 1", 150]], [["Range 1", 150]]]);
    expect(view.segments).toEqual({ used: 1, max: 32 });
    expect(view.notices).toEqual([]);
    expect(view.matrix).toBe(false);
    for (const path of ["/json/cfg", "/json/state", "/json/info", "/json/effects", "/json/palettes"]) {
      expect(f.requests.some((r) => r.method === "GET" && r.path === path)).toBe(true);
    }
    expect(posts(f)).toEqual([]);
  });

  // Fails if the route answers strands for a 2D device.
  it("answers a matrix device with no strands", async () => {
    const info = seeds.backyard.info;
    const { t, url } = await setup(seeds.backyard, { infoOverride: { leds: { ...info.leds, matrix: { w: 16, h: 16 } } } });
    const view = (await t.inject({ method: "GET", url: url("lights") })).json<LightsView>();
    expect(view.matrix).toBe(true);
    expect(view.strands).toEqual([]);
  });

  // Fails if the route does not read /presets.json for a painted segment, so the Peak range has no paint.
  it("reads the paint of a fresh app from the startup preset", async () => {
    const { t, url } = await roof();
    const view = (await t.inject({ method: "GET", url: url("lights") })).json<LightsView>();
    const peak = view.strands[0]!.ranges.find((r) => r.name === "Peak");
    expect(peak?.paint).toEqual(candy);
  });

  // Fails if the route clears leftovers itself (a POST on read) or shows the flash segment as a range.
  it("leaves a flash segment alone on read and deletes it on the next write", async () => {
    const { t, f, url } = await setup();
    f.applyState({ seg: [seg(1, FLASH_NAME, 0, 1)] });
    const view = (await t.inject({ method: "GET", url: url("lights") })).json<LightsView>();
    expect(posts(f)).toEqual([]);
    expect(view.strands[0]!.ranges.map((r) => r.name)).toEqual(["Range 1"]);
    await t.inject({ method: "PATCH", url: url("lights"), payload: { bri: 100 } });
    expect(posts(f).length).toBeGreaterThan(0);
    expect(flashSegs(f)).toEqual([]);
  });

  // Fails if the read deletes the dropped group from the database, or PATCH does not clear it.
  it("keeps a dropped group on read and removes it on the next write", async () => {
    const { t, f, row, url } = await setup();
    strandGroups.replace(t.db, row.id, ["o0+o1"]);
    f.cfg.hw = { led: { ins: [{ type: 22, pin: [16], start: 0, len: 150 }, { type: 22, pin: [17], start: 160, len: 150 }] } };
    const view = (await t.inject({ method: "GET", url: url("lights") })).json<LightsView>();
    expect(view.notices).toEqual(["A combined strand was separated because its LED outputs no longer touch."]);
    expect(strandGroups.list(t.db, row.id)).toEqual(["o0+o1"]);
    await t.inject({ method: "PATCH", url: url("lights"), payload: { on: true } });
    expect(strandGroups.list(t.db, row.id)).toEqual([]);
  });
});

describe("PATCH lights", () => {
  // Fails if the route does not send exactly { on, v } or does not answer the view after the write.
  it("sends on:false once and answers the view", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("lights"), payload: { on: false } });
    expect(res.statusCode).toBe(200);
    expect(posts(f).map((r) => r.body)).toEqual([{ on: false, v: true }]);
    expect(res.json<LightsView>().on).toBe(false);
  });

  // Fails if the route accepts a body outside { on?, bri? }, or an empty one.
  it.each([[{}], [{ on: "true" }], [{ bri: 256 }], [{ seg: [] }]])("rejects %j and sends nothing", async (payload) => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("lights"), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
    expect(posts(f)).toEqual([]);
  });

  // Fails if power-on does not go through setDevicePower, so the firmware's unfreeze leaves the painted segment frozen black.
  it("sends the paint again with the power-on and answers a LightsView", async () => {
    const { t, f, url } = await roof();
    await t.inject({ method: "PATCH", url: url("lights"), payload: { on: false } });
    f.requests.length = 0;
    const res = await t.inject({ method: "PATCH", url: url("lights"), payload: { on: true } });
    expect(posts(f)).toHaveLength(1);
    expect(posts(f)[0]!.body).toMatchObject({ on: true, seg: [{ id: 1 }] });
    expect(res.json<LightsView>().strands).toHaveLength(1);
    expect(f.pixels(1)).toEqual(candy);
  });
});

describe("PATCH state", () => {
  // Fails if PATCH state does not go through setDevicePower, so power-on leaves the painted segment unfrozen.
  it("power-on sends the paint with it and answers the device state", async () => {
    const { t, f, url } = await roof();
    await t.inject({ method: "PATCH", url: url("state"), payload: { on: false } });
    f.requests.length = 0;
    const res = await t.inject({ method: "PATCH", url: url("state"), payload: { on: true } });
    expect(posts(f)).toHaveLength(1);
    expect(posts(f)[0]!.body).toMatchObject({ on: true, seg: [{ id: 1, i: expect.any(Array) }] });
    expect((f.state.seg as { n: string; frz: boolean }[]).find((s) => s.n === "Peak paint")?.frz).toBe(true);
    expect(f.pixels(1)).toEqual(candy);
    expect(res.json()).toEqual(f.state);
  });
});

describe("POST lights/flash", () => {
  const split = (f: FakeWled) => f.applyState({ seg: [seg(0, "A", 0, 150), seg(1, "B", 150, 300)] });

  // Fails if the route is missing, uses a lower free ID, or does not delete the flash segment after flashMs.
  it("lights one LED at the highest free ID and deletes it after flashMs", async () => {
    const { t, f, url } = await setup(seeds.backyard, { flashMs: 60 });
    split(f);
    const res = await t.inject({ method: "POST", url: url("lights/flash"), payload: { strandKey: "o1", led: 0 } });
    expect(res.statusCode).toBe(204);
    expect(posts(f).at(-1)!.body).toEqual({
      seg: [{ id: 31, start: 150, stop: 151, fx: 0, col: [[255, 255, 255]], bri: 255, on: true, n: "Strand flash" }],
    });
    await sleep(200);
    expect(flashSegs(f)).toEqual([]);
  });

  // Fails if a second flash does not delete the first one's segment in its own request.
  // (The fake lists the first flash at the next free index, 2, so the delete names that listed ID.)
  it("a second flash replaces the first", async () => {
    const { t, f, url } = await setup(seeds.backyard, { flashMs: 500 });
    split(f);
    await t.inject({ method: "POST", url: url("lights/flash"), payload: { strandKey: "o1", led: 0 } });
    await sleep(10);
    await t.inject({ method: "POST", url: url("lights/flash"), payload: { strandKey: "o1", led: 5 } });
    expect(posts(f).at(-1)!.body).toMatchObject({ seg: [{ id: 2, stop: 0 }, { id: 31, start: 155 }] });
    expect(flashSegs(f)).toHaveLength(1);
  });

  // Fails if the route accepts an LED past the strand, or a strand the controller does not have.
  it.each([
    [{ strandKey: "o1", led: 150 }, 400, "invalid_request"],
    [{ strandKey: "o9", led: 0 }, 409, "strand_changed"],
  ])("rejects %j with %i", async (payload, status, error) => {
    const { t, f, url } = await setup();
    split(f);
    const res = await t.inject({ method: "POST", url: url("lights/flash"), payload });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ error });
  });

  // Fails if flash does not refuse with segment_budget when every ID is in use.
  it("answers 422 segment_budget when no segment is free", async () => {
    const { t, f, url } = await setup();
    f.applyState({ seg: Array.from({ length: 32 }, (_, id) => seg(id, `S${id}`, id, id + 1)) });
    const res = await t.inject({ method: "POST", url: url("lights/flash"), payload: { strandKey: "o0", led: 0 } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "segment_budget",
      message: "This needs 1 more segment and 0 are free. Remove a range first.",
      need: 1,
    });
  });
});

type Segs = { id: number; n?: string; start: number; stop: number; grp: number; spc: number; col: number[][]; fx: number; pal: number; bri: number }[];
const segsOf = (f: FakeWled) => f.state.seg as unknown as Segs;

describe("strand edit and resolve", () => {
  const strand = (s: Awaited<ReturnType<typeof setup>>, key = "o0") =>
    s.t.inject({ method: "GET", url: s.url("lights") }).then((res) => res.json<LightsView>().strands.find((v) => v.key === key)!);
  const patch = (s: Awaited<ReturnType<typeof setup>>, payload: unknown, key = "o0") =>
    s.t.inject({ method: "PATCH", url: s.url(`lights/strands/${key}`), payload: payload as object });
  const resolve = (s: Awaited<ReturnType<typeof setup>>, action: string) =>
    s.t.inject({ method: "POST", url: s.url("lights/strands/o0/resolve"), payload: { action } });
  const splitSeed = (f: FakeWled) => f.applyState({ seg: [seg(0, "Range 1", 0, 150), seg(1, "Range 1", 150, 300)] });
  const all = (base: RangeView, name: string, start: number, len: number): RangeView => ({ ...base, name, start, len, pattern: { kind: "all" }, slots: [base.slots[0]!] });

  // Fails if the route is missing, or a ranges edit on a shared strand is not refused with 409 shared.
  it("refuses a ranges edit on a shared strand", async () => {
    const s = await setup();
    const base = (await strand(s)).ranges[0]!;
    const res = await patch(s, { ranges: [all(base, "A", 0, 75), all(base, "B", 75, 75)] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: "shared",
      message: "Strand 1 shares a segment with another strand. Choose Split or Combine on the Lights tab first.",
    });
    expect(posts(s.f)).toEqual([]);
  });

  // Fails if a bri edit on a shared strand is not written to its shared segment.
  it("writes bri to the shared segment", async () => {
    const s = await setup();
    const res = await patch(s, { bri: 90 });
    expect(res.statusCode).toBe(200);
    expect(segsOf(s.f)[0]!.bri).toBe(90);
  });

  // Fails if resolve split does not give each strand its own segment with the old slot.
  it("split gives each strand a Range 1 with the old slot", async () => {
    const s = await setup();
    const before = segsOf(s.f)[0]!;
    const res = await resolve(s, "split");
    expect(res.statusCode).toBe(200);
    const after = segsOf(s.f).map((g) => ({ ...g }));
    expect(after.map((g) => [g.start, g.stop, g.n])).toEqual([[0, 150, "Range 1"], [150, 300, "Range 1"]]);
    for (const g of after) expect(g).toMatchObject({ col: before.col, fx: before.fx, pal: before.pal, grp: 1, spc: 0 });
    expect(res.json<LightsView>().strands.map((v) => v.shared)).toEqual([undefined, undefined]);
  });

  // Fails if resolve combine writes to the device or does not save the group.
  it("combine saves the group and sends nothing", async () => {
    const s = await setup();
    const res = await resolve(s, "combine");
    expect(strandGroups.list(s.t.db, s.row.id)).toEqual(["o0+o1"]);
    const view = res.json<LightsView>();
    expect(view.strands.map((v) => [v.key, v.ranges.length, v.ranges[0]!.pattern])).toEqual([["o0+o1", 1, { kind: "all" }]]);
    expect(posts(s.f)).toEqual([]);
  });

  // Fails if resolve on a strand that is not shared does anything but answer the view.
  it("resolve on an unshared strand answers the view", async () => {
    const s = await setup();
    splitSeed(s.f);
    const res = await resolve(s, "split");
    expect(res.statusCode).toBe(200);
    expect(posts(s.f)).toEqual([]);
  });

  // Fails if the edit does not write the ranges as sent, or touches the other strand's segment.
  it("writes two ranges to a split strand and leaves the other strand alone", async () => {
    const s = await setup(seeds.backyard, { startupDelayMs: 50 });
    await resolve(s, "split");
    await sleep(150);
    s.f.requests.length = 0;
    const base = (await strand(s)).ranges[0]!;
    const other = segsOf(s.f).find((g) => g.start === 150)!;
    const before = { ...other };
    const ranges: RangeView[] = [
      all(base, "A", 0, 75),
      { ...base, name: "B", start: 75, len: 75, pattern: { kind: "every", n: 2, group: 1 }, slots: [base.slots[0]!, base.slots[0]!] },
    ];
    const res = await patch(s, { ranges });
    expect(res.statusCode).toBe(200);
    expect(res.json<LightsView>().strands[0]!.ranges).toEqual(ranges);
    expect(segsOf(s.f).find((g) => g.id === before.id)).toEqual(before);
    await sleep(200);
    expect(psaves(s.f)).toHaveLength(1);
  });

  // Fails if validation of an Every pattern is skipped before the write.
  it("answers 422 invalid_layout for an Every pattern wider than its range, with no write", async () => {
    const s = await setup();
    await resolve(s, "split");
    const base = (await strand(s)).ranges[0]!;
    const bad: RangeView = { ...base, name: "Tiny", start: 146, len: 4, pattern: { kind: "every", n: 3, group: 2 }, slots: [base.slots[0]!, base.slots[0]!, base.slots[0]!] };
    s.f.requests.length = 0;
    const res = await patch(s, { ranges: [all(base, "A", 0, 146), bad] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "invalid_layout" });
    expect(posts(s.f)).toEqual([]);
  });

  // Fails if the endpoint does not turn a segment_budget LayoutError into 422 with need.
  it("answers 422 segment_budget when the layout needs more segments than are free", async () => {
    const s = await setup();
    const small = Array.from({ length: 30 }, (_, k) => seg(k + 1, `S${k}`, 150 + k * 5, 155 + k * 5));
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 150), ...small] });
    const base = (await strand(s)).ranges[0]!;
    const res = await patch(s, { ranges: [all(base, "A", 0, 50), all(base, "B", 50, 50), all(base, "C", 100, 50)] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "segment_budget", message: "This needs 2 more segments and 1 is free. Remove a range first.", need: 2 });
  });

  // Fails if a strand edit plans its segments outside the device queue, so two edits at once take the same free ID.
  it("two strands edited at once both keep their new ranges", async () => {
    const s = await setup();
    await resolve(s, "split");
    const [o0, o1] = [(await strand(s, "o0")).ranges[0]!, (await strand(s, "o1")).ranges[0]!];
    const res = await Promise.all([
      patch(s, { ranges: [all(o0, "A", 0, 75), all(o0, "B", 75, 75)] }, "o0"),
      patch(s, { ranges: [all(o1, "C", 0, 75), all(o1, "D", 75, 75)] }, "o1"),
    ]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200]);
    const segs = segsOf(s.f);
    expect(segs.map((g) => [g.n, g.start, g.stop]).sort()).toEqual([["A", 0, 75], ["B", 75, 150], ["C", 150, 225], ["D", 225, 300]]);
    expect(new Set(segs.map((g) => g.id)).size).toBe(segs.length);
  });

  // Fails if the segment budget is checked against a read made before the device queue, so two edits at once both pass it.
  it("two strands edited at once with one free segment give one 200 and one segment_budget", async () => {
    const s = await setup();
    const small = Array.from({ length: 30 }, (_, k) => seg(k + 1, `S${k}`, 150 + k * 5, 155 + k * 5));
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 150), ...small] });
    const o0 = (await strand(s, "o0")).ranges[0]!;
    const o1 = (await strand(s, "o1")).ranges;
    const res = await Promise.all([
      patch(s, { ranges: [all(o0, "A", 0, 75), all(o0, "B", 75, 75)] }, "o0"),
      patch(s, { ranges: [{ ...o1[0]!, len: 2 }, { ...o1[0]!, name: "S0b", start: 2, len: 3 }, ...o1.slice(1)] }, "o1"),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    expect(res.find((r) => r.statusCode === 422)!.json()).toMatchObject({ error: "segment_budget" });
    expect(segsOf(s.f)).toHaveLength(32);
  });

  // Fails if a layout write reaches a 2D device instead of answering 422 invalid_layout.
  it.each([
    ["PATCH", "lights/strands/o0", { bri: 90 }],
    ["PUT", "strand-groups", { keys: ["o0+o1"] }],
  ])("refuses %s %s on a matrix device and writes nothing", async (method, path, payload) => {
    const info = seeds.backyard.info;
    const s = await setup(seeds.backyard, { infoOverride: { leds: { ...info.leds, matrix: { w: 16, h: 16 } } } });
    const res = await s.t.inject({ method: method as "PUT", url: s.url(path), payload });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_layout", message: "2D matrix layouts aren't supported yet." });
    expect(posts(s.f)).toEqual([]);
    expect(strandGroups.list(s.t.db, s.row.id)).toEqual([]);
  });

  // Fails if the body schema does not reject these.
  it.each([[{}], [{ ranges: "x" }], [{ bri: 0 }], [{ on: true, x: 1 }], [{ ranges: [{ x: 1 }] }]])("rejects %j with 400", async (payload) => {
    const s = await setup();
    const res = await patch(s, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  // Fails if the RangeView schema lets a slot carry an extra key.
  it("rejects a slot with an extra key", async () => {
    const s = await setup();
    await resolve(s, "split");
    const base = (await strand(s)).ranges[0]!;
    const res = await patch(s, { ranges: [{ ...base, slots: [{ ...base.slots[0]!, extra: 1 }] }] });
    expect(res.statusCode).toBe(400);
  });

  // Fails if the edit leaves a foreign grp 3 segment as it is.
  it("overwrites a segment with a foreign grp on the first edit", async () => {
    const s = await setup();
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 150, { grp: 3 }), seg(1, "Range 1", 150, 300)] });
    const base = (await strand(s)).ranges[0]!;
    const res = await patch(s, { ranges: [all(base, "Range 1", 0, 150)] });
    expect(res.statusCode).toBe(200);
    expect(segsOf(s.f).find((g) => g.start === 0)).toMatchObject({ grp: 1, spc: 0 });
  });

  // Fails if a failed write does not schedule the startup save, or hides the device error.
  it("answers 504 after a write fails part-way and still schedules the startup save", async () => {
    const s = await setup(seeds.backyard, { startupDelayMs: 50 });
    s.f.applyState({ seg: [...Array.from({ length: 8 }, (_, k) => seg(k, `S${k}`, k * 18, k === 7 ? 150 : k * 18 + 18)), seg(8, "Range 1", 150, 300)] });
    const base = (await strand(s)).ranges[0]!;
    s.f.failNext("timeout", { method: "POST", path: "/json/state", skip: 2 });
    const res = await patch(s, { ranges: [all(base, "Range 1", 0, 150)] });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: "device_offline" });
    expect(posts(s.f).length).toBeGreaterThanOrEqual(3);
    await sleep(200);
    expect(psaves(s.f)).toHaveLength(1);
  });

  const paintRange = (base: RangeView, len: number, colors: string[]): RangeView => ({ ...base, name: "Paint", start: 0, len, pattern: { kind: "individual" }, paint: colors });

  // Fails if a failed paint request is not answered 504, or does not schedule the startup save.
  it("answers 504 when the paint request fails, with the segments on the device", async () => {
    const s = await setup(seeds.backyard, { startupDelayMs: 50 });
    await resolve(s, "split");
    await sleep(150);
    s.f.requests.length = 0;
    const base = (await strand(s)).ranges[0]!;
    s.f.failNext("timeout", { method: "POST", path: "/json/state", skip: 1 });
    const res = await patch(s, { ranges: [paintRange(base, 150, Array.from({ length: 150 }, () => "#00FF00"))] });
    expect(res.statusCode).toBe(504);
    expect(segsOf(s.f).find((g) => g.n === "Paint paint")).toBeDefined();
    await sleep(200);
    expect(psaves(s.f)).toHaveLength(1);
  });

  // Fails if the paint step does not find its segment by name and answer 409 when it has gone.
  it("answers 409 strand_changed when the paint segment is gone", async () => {
    const s = await setup();
    await resolve(s, "split");
    const base = (await strand(s)).ranges[0]!;
    s.f.afterPost(() => s.f.applyState({ seg: [{ id: 0, n: "Other" }] }));
    const res = await patch(s, { ranges: [paintRange(base, 150, Array.from({ length: 150 }, () => "#00FF00"))] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "strand_changed" });
  });

  // Fails if the largest paint is not split into requests the device accepts, or the startup save is refused.
  it("writes 300 different paint colors in requests of at most 256 runs", async () => {
    const s = await setup(seeds.frontRoof, { startupDelayMs: 50 });
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 300)] });
    const base = (await strand(s)).ranges[0]!;
    const colors = Array.from({ length: 300 }, () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`);
    const res = await patch(s, { ranges: [paintRange(base, 300, colors)] });
    expect(res.statusCode).toBe(200);
    const id = segsOf(s.f).find((g) => g.n === "Paint paint")!.id;
    const paintPosts = posts(s.f).filter((r) => (r.body as { seg?: { i?: unknown[] } }).seg?.i !== undefined);
    expect(paintPosts.length).toBeGreaterThan(0);
    for (const r of paintPosts) expect(((r.body as { seg: { i: unknown[] } }).seg.i).length).toBeLessThanOrEqual(256 * 3);
    expect(posts(s.f).every((r) => r.body !== undefined)).toBe(true);
    expect(s.f.pixels(id).map((c) => c?.toUpperCase())).toEqual(colors);
    await sleep(200);
    expect(psaves(s.f)).toHaveLength(1);
  });
});

describe("strand groups and names", () => {
  const putGroups = (s: Awaited<ReturnType<typeof setup>>, payload: unknown) =>
    s.t.inject({ method: "PUT", url: s.url("strand-groups"), payload: payload as object });
  const putNames = (s: Awaited<ReturnType<typeof setup>>, payload: unknown) =>
    s.t.inject({ method: "PUT", url: s.url("strand-names"), payload: payload as object });
  const combined = async (segments: object[]) => {
    const s = await setup();
    strandGroups.replace(s.t.db, s.row.id, ["o0+o1"]);
    s.f.applyState({ seg: segments });
    s.f.requests.length = 0;
    return s;
  };
  const strandOf = async (s: Awaited<ReturnType<typeof setup>>, key: string) =>
    (await s.t.inject({ method: "GET", url: s.url("lights") })).json<LightsView>().strands.find((v) => v.key === key)!;
  const three = [seg(0, "Left", 0, 100), seg(1, "Middle", 100, 200), seg(2, "Right", 200, 300)];

  // Fails if the PUT strand-groups and GET strand-groups routes are missing, or a new group writes to the device.
  it("combines two outputs without a device write", async () => {
    const s = await setup();
    s.f.applyState({ seg: [seg(0, "Left", 0, 150), seg(1, "Right", 150, 300)] });
    s.f.requests.length = 0;
    const res = await putGroups(s, { keys: ["o0+o1"] });
    expect(res.statusCode).toBe(200);
    expect(res.json<LightsView>().strands.map((v) => v.key)).toEqual(["o0+o1"]);
    const got = await s.t.inject({ method: "GET", url: s.url("strand-groups") });
    expect(got.json()).toEqual(["o0+o1"]);
    expect(posts(s.f)).toEqual([]);
  });

  // Fails if the handler does not check that the outputs exist, touch in key order and sit in one key only.
  it.each([["o0+o2"], ["o1+o0"], ["o0+o1", "o0+o1"]])("answers 422 not_adjacent for %j", async (...keys) => {
    const s = await setup();
    const res = await putGroups(s, { keys });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "not_adjacent" });
  });

  // Fails if the keys schema, or the more-keys-than-outputs check, is missing.
  it.each([[{ keys: ["o0"] }], [{ keys: "o0+o1" }], [{ keys: [], x: 1 }], [{ keys: ["o0+o1", "o0+o1", "o0+o1"] }]])(
    "answers 400 invalid_request for %j",
    async (body) => {
      const res = await putGroups(await setup(), body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "invalid_request" });
    },
  );

  // Fails if removing a group does not cut a range that crosses the member boundary.
  it("cuts a range at the boundary when the group is removed", async () => {
    const s = await combined(three);
    const res = await putGroups(s, { keys: [] });
    expect(res.statusCode).toBe(200);
    expect(strandGroups.list(s.t.db, s.row.id)).toEqual([]);
    const middle = segsOf(s.f).filter((g) => g.n === "Middle").map((g) => [g.start, g.stop]);
    expect(middle.sort()).toEqual([[100, 150], [150, 200]]);
  });

  // Fails if the paint is not cut by position between the two pieces.
  it("cuts the paint of a crossing Individual range", async () => {
    const s = await combined([]);
    const colors = [...Array<string>(50).fill("#FF0000"), ...Array<string>(50).fill("#0000FF")];
    const body = [seg(0, "Left", 0, 100), seg(1, "Paint paint", 100, 200, { frz: true, i: encodePaint(colors) }), seg(2, "Right", 200, 300)];
    s.f.applyState({ seg: body });
    s.f.applyState({ psave: 250, o: true, n: "Strand: startup", seg: body });
    await putGroups(s, { keys: [] });
    const paintOf = async (key: string) => (await strandOf(s, key)).ranges.find((r) => r.name === "Paint")?.paint;
    expect(await paintOf("o0")).toEqual(Array(50).fill("#FF0000"));
    expect(await paintOf("o1")).toEqual(Array(50).fill("#0000FF"));
  });

  // Fails if a piece too short for its Every pattern is not made an All range with the first slot.
  it("turns a piece too short for its Every pattern into All", async () => {
    const dots = [0, 1, 2].map((k) => seg(k + 1, `Dots ${k + 1}/3`, 146 + k * 2, 200, { grp: 2, spc: 4, fx: k + 1 }));
    const s = await combined([seg(0, "Before", 0, 146), ...dots, seg(4, "After", 200, 300)]);
    const res = await putGroups(s, { keys: [] });
    expect(res.statusCode).toBe(200);
    const dotsOf = async (key: string) => (await strandOf(s, key)).ranges.find((r) => r.name === "Dots")!;
    const first = await dotsOf("o0");
    expect([first.start, first.len, first.pattern, first.slots.map((x) => x.fx)]).toEqual([146, 4, { kind: "all" }, [1]]);
    const second = await dotsOf("o1");
    expect([second.start, second.len, second.pattern]).toEqual([0, 50, { kind: "every", n: 3, group: 2 }]);
  });

  // Fails if the groups are saved before the device write, or a failed write still changes them.
  it("keeps the groups when the device write fails", async () => {
    const s = await combined(three);
    s.f.failNext("timeout", { method: "POST", path: "/json/state" });
    const res = await putGroups(s, { keys: [] });
    expect(res.statusCode).toBe(504);
    expect(strandGroups.list(s.t.db, s.row.id)).toEqual(["o0+o1"]);
  });

  // Fails if the PUT strand-names route is missing, or does not store the trimmed name under strandNames.<id>.
  it("renames a strand and clears the name with an empty value", async () => {
    const s = await setup();
    const named = await putNames(s, { names: { o0: " Eaves " } });
    expect(named.statusCode).toBe(200);
    expect(named.json<LightsView>().strands[0]!.name).toBe("Eaves");
    const cleared = await putNames(s, { names: { o0: "  " } });
    expect(cleared.json<LightsView>().strands[0]!.name).toBe("Strand 1");
  });

  // Fails if a key that is not a current strand is stored.
  it("answers 409 strand_changed for a strand that is not there", async () => {
    const res = await putNames(await setup(), { names: { o9: "x" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "strand_changed" });
  });

  // Fails if the 64-character limit is not applied to the trimmed name.
  it("answers 422 invalid_name for a name over 64 characters", async () => {
    const res = await putNames(await setup(), { names: { o0: "x".repeat(65) } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_name", message: "Names need 1 to 64 characters." });
  });

  // Fails if the names schema accepts a non-string name, an extra key or a key that is not a strand key.
  it.each([[{ names: { o0: 5 } }], [{ names: {}, x: 1 }], [{ names: { "a b": "x" } }]])("answers 400 invalid_request for %j", async (body) => {
    const res = await putNames(await setup(), body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });
});
