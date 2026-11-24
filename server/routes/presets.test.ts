import { afterEach, describe, expect, it } from "vitest";
import type { ApplyResult, LightsView, Scene } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds, type Seed } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";
import * as scenes from "../db/scenes";
import { encodePaint } from "../lights/layoutRead";

const fakes: FakeWled[] = [];

async function setup(seed: Seed = seeds.backyard) {
  const t = makeTestApp();
  const f = await startFakeWled(seed);
  fakes.push(f);
  const row = t.addFake(f, seed);
  return { t, f, row, url: (path: string) => `/api/devices/${row.id}/${path}` };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

type Setup = Awaited<ReturnType<typeof setup>>;

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

/** Backyard with each output on its own segment. */
async function split() {
  const s = await setup();
  s.f.applyState({ seg: [seg(0, "Range 1", 0, 150), seg(1, "Range 1", 150, 300)] });
  return s;
}

const save = (s: Setup, payload: unknown) => s.t.inject({ method: "POST", url: s.url("scenes"), payload: payload as object });
const lights = (s: Setup) => s.t.inject({ method: "GET", url: s.url("lights") }).then((r) => r.json<LightsView>());
const segsOf = (f: FakeWled) => f.state.seg as unknown as { id: number; start: number; stop: number }[];

describe("POST and GET scenes", () => {
  // Fails if the POST route is missing or does not snapshot the strand into a scene with a summary.
  it("saves the strand as a scene and lists it", async () => {
    const s = await split();
    const res = await save(s, { name: " Party ", strandKey: "o0" });
    expect(res.statusCode).toBe(201);
    expect(res.json<Scene>()).toMatchObject({ name: "Party", strandKey: "o0", ledCount: 150, summary: "1 range · 100%" });
    const list = await s.t.inject({ method: "GET", url: s.url("scenes") });
    expect(list.json<Scene[]>().map((x) => x.name)).toEqual(["Party"]);
  });

  // Fails if the handler skips the 1 to 64 character name rule, or accepts a body the schema should refuse.
  it.each([
    [{ name: "", strandKey: "o0" }, 422, "invalid_name"],
    [{ name: "  ", strandKey: "o0" }, 422, "invalid_name"],
    [{ name: "a".repeat(65), strandKey: "o0" }, 422, "invalid_name"],
    [{ name: 5, strandKey: "o0" }, 400, "invalid_request"],
    [{ name: "a", strandKey: "o0", x: 1 }, 400, "invalid_request"],
    [{ name: "a", strandKey: "o9" }, 409, "strand_changed"],
  ])("refuses %j", async (payload, status, error) => {
    const s = await split();
    const res = await save(s, payload);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ error });
  });

  // Fails if the handler does not cap a device at 256 scenes.
  it("refuses the 257th scene", async () => {
    const s = await split();
    const content = (await lights(s)).strands[0]!;
    for (let k = 0; k < 256; k++) {
      scenes.insert(s.t.db, { deviceId: s.row.id, name: `S${k}`, strandKey: "o0", ledCount: 150, content: { on: content.on, bri: content.bri, ranges: [] } }, new Date());
    }
    const res = await save(s, { name: "Last", strandKey: "o0" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "too_many", message: "A device can keep 256 scenes." });
  });

  // Fails if the handler does not refuse a snapshot over 65536 bytes of JSON.
  it("refuses a setup that is too large to save", async () => {
    const roof = seeds.frontRoof;
    const s = await setup({ ...roof, info: { ...roof.info, leds: { ...roof.info.leds, count: 8000 } } });
    s.f.cfg.hw = { led: { ins: [{ type: 30, pin: [2], start: 0, len: 8000 }] } };
    const colors = Array.from({ length: 8000 }, (_, k) => `#${(k % 4096).toString(16).padStart(3, "0")}000`);
    s.f.applyState({ seg: [seg(0, "Big paint", 0, 8000, { frz: true })] });
    s.f.applyState({ psave: 250, o: true, n: "Strand: startup", seg: [seg(0, "Big paint", 0, 8000, { frz: true, i: encodePaint(colors) })] });
    const res = await save(s, { name: "Big", strandKey: "o0" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_layout", message: "This setup is too large to save." });
  });

  // Fails if GET scenes reads the device instead of only the database.
  it("lists scenes while the device is offline", async () => {
    const s = await split();
    await save(s, { name: "Party", strandKey: "o0" });
    await s.f.close();
    const res = await s.t.inject({ method: "GET", url: s.url("scenes") });
    expect(res.statusCode).toBe(200);
    expect(res.json<Scene[]>()).toHaveLength(1);
  });
});

describe("PATCH and DELETE scenes", () => {
  const body = (s: Setup) => save(s, { name: "Party", strandKey: "o0" }).then((r) => r.json<Scene>());

  // Fails if the PATCH route is missing, or does not apply the name rule.
  it("renames a scene and refuses a long name", async () => {
    const s = await split();
    const scene = await body(s);
    const ok = await s.t.inject({ method: "PATCH", url: s.url(`scenes/${scene.id}`), payload: { name: "Late" } });
    expect(ok.json<Scene>().name).toBe("Late");
    const bad = await s.t.inject({ method: "PATCH", url: s.url(`scenes/${scene.id}`), payload: { name: "a".repeat(65) } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ error: "invalid_name", message: "Names need 1 to 64 characters." });
  });

  // Fails if DELETE answers 404 for a scene that is already gone, or PATCH finds a deleted scene.
  it("deletes twice with 204 and then answers 404 to a rename", async () => {
    const s = await split();
    const scene = await body(s);
    const del = () => s.t.inject({ method: "DELETE", url: s.url(`scenes/${scene.id}`) });
    expect((await del()).statusCode).toBe(204);
    expect((await del()).statusCode).toBe(204);
    const res = await s.t.inject({ method: "PATCH", url: s.url(`scenes/${scene.id}`), payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "That scene was deleted." });
  });

  // Fails if the lookup is not scoped to the device in the URL.
  it("does not find the scene of another device", async () => {
    const s = await split();
    const scene = await body(s);
    const other = s.t.addFake(s.f, seeds.frontRoof, "127.0.0.2");
    const res = await s.t.inject({ method: "PATCH", url: `/api/devices/${other.id}/scenes/${scene.id}`, payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST scenes/:id/apply", () => {
  const apply = (s: Setup, id: string) => s.t.inject({ method: "POST", url: s.url(`scenes/${id}/apply`) });
  const saved = (s: Setup) => save(s, { name: "Party", strandKey: "o0" }).then((r) => r.json<Scene>());
  const twoRanges = async (s: Setup) => {
    const base = (await lights(s)).strands[0]!.ranges[0]!;
    const patch = { ranges: [{ ...base, name: "A", len: 75 }, { ...base, name: "B", start: 75, len: 75 }] };
    await s.t.inject({ method: "PATCH", url: s.url("lights/strands/o0"), payload: patch });
  };

  // Fails if apply does not write the saved ranges back to the device.
  it("restores the saved ranges", async () => {
    const s = await split();
    const before = (await lights(s)).strands[0]!;
    const scene = await saved(s);
    await twoRanges(s);
    const res = await apply(s, scene.id);
    expect(res.statusCode).toBe(200);
    const result = res.json<ApplyResult>();
    expect(result.warnings).toEqual([]);
    expect(result.view.strands[0]).toEqual(before);
    expect(segsOf(s.f).filter((g) => g.start === 0).map((g) => g.stop)).toEqual([150]);
  });

  // Fails if apply does not fit the scene to the strand's length and report it.
  it("warns when the strand length changed", async () => {
    const s = await split();
    const scene = await saved(s);
    s.f.cfg.hw = { led: { ins: [{ type: 22, pin: [16], start: 0, len: 100 }, { type: 22, pin: [17], start: 100, len: 150 }] } };
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 100), seg(1, "Range 1", 100, 250)] });
    const res = await apply(s, scene.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<ApplyResult>().warnings[0]).toBe("The strand has 100 LEDs now, not 150. The ranges were fitted to the new length.");
  });

  // Fails if apply does not resolve a saved effect by name against the device's list.
  it("warns about an effect the device no longer has", async () => {
    const s = await split();
    const scene = await saved(s);
    const row = scenes.get(s.t.db, s.row.id, scene.id)!;
    row.content.ranges[0]!.slots[0]!.fxName = "Gone";
    row.content.ranges[0]!.slots[0]!.fx = 999;
    s.t.db.prepare("UPDATE scenes SET content = ? WHERE id = ?").run(JSON.stringify(row.content), scene.id);
    const res = await apply(s, scene.id);
    expect(res.json<ApplyResult>().warnings).toContain("Gone isn't on this controller. Solid is used instead.");
  });

  // Fails if apply writes to a strand that shares a segment.
  it("refuses a shared strand", async () => {
    const s = await split();
    const scene = await saved(s);
    s.f.applyState({ seg: [seg(0, "Range 1", 0, 300), seg(1, "x", 0, 0)] });
    const res = await apply(s, scene.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "shared" });
  });

  // Fails if apply of a deleted scene is not 404 not_found.
  it("answers 404 for an unknown scene", async () => {
    const s = await split();
    const res = await apply(s, "nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "That scene was deleted." });
  });
});
