import { afterEach, describe, expect, it } from "vitest";
import type { LightsView } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds, type Seed } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as strandGroups from "../db/strandGroups";
import { encodePaint, FLASH_NAME } from "../lights/layoutRead";

const fakes: FakeWled[] = [];

async function setup(seed: Seed = seeds.backyard, opts: { flashMs?: number; infoOverride?: object } = {}) {
  const t = makeTestApp({ flashMs: opts.flashMs });
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
