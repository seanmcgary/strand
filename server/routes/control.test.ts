import { afterEach, describe, expect, it } from "vitest";
import type { Effect, Palette } from "../../shared/apiTypes";
import { startFakeWled, type FakeWled } from "../../test/fakeWled";
import { seeds, type Seed } from "../../test/fixtures/seeds";
import { makeTestApp } from "../../test/testApp";

const fakes: FakeWled[] = [];

async function setup(seed: Seed = seeds.backyard) {
  const t = makeTestApp();
  const f = await startFakeWled(seed);
  fakes.push(f);
  const row = t.addFake(f, seed);
  return { t, f, url: (path: string) => `/api/devices/${row.id}/${path}` };
}

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const posts = (f: FakeWled) => f.requests.filter((r) => r.method === "POST");

describe("GET state", () => {
  // Fails if the route stops returning the device's state object unchanged.
  it("returns the device state", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("state") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(f.state);
  });
});

describe("PATCH state", () => {
  // Fails if the write adds a key besides v, or does not return the device's full state.
  it.each([
    [{ on: false }, { on: false, v: true }],
    [{ bri: 128 }, { bri: 128, v: true }],
  ])("sends %j plus v and returns the state", async (payload, sent) => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("state"), payload });
    expect(res.statusCode).toBe(200);
    expect(posts(f).map((r) => r.body)).toEqual([sent]);
    expect(res.json()).toEqual(f.state);
  });

  // Fails if the route lets through a key outside { on, bri }, an empty body, or a wrong type or range.
  it.each([
    [{}],
    [{ pin: "1234" }],
    [{ rb: true }],
    [{ ps: 1 }],
    [{ seg: [{ id: 0, on: false }] }],
    [{ on: false, tt: 0 }],
    [{ on: "false" }],
    [{ bri: 256 }],
    [{ bri: 1.5 }],
    [[1]],
  ])("rejects %j with invalid_request and sends nothing", async (payload) => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "PATCH", url: url("state"), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
    expect(posts(f)).toHaveLength(0);
  });
});

describe("GET effects and palettes", () => {
  // Fails if the route stops dropping RSVD or returning the parsed metadata fields.
  it("returns effects with parsed metadata and without RSVD", async () => {
    const { t, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("effects") });
    expect(res.statusCode).toBe(200);
    const effects = res.json<Effect[]>();
    expect(effects).toHaveLength(10);
    expect(effects.find((e) => e.name === "Blink")).toEqual({
      id: 1,
      name: "Blink",
      pal: true,
      sliders: ["Speed", "Duty cycle"],
      checks: [],
      colors: ["Fx", "Bg"],
    });
  });

  // Fails if the route does not read every palx page or drop color references.
  it("returns palettes with stops from every palx page", async () => {
    const { t, f, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("palettes") });
    const palettes = res.json<Palette[]>();
    expect(palettes).toHaveLength(13);
    expect(palettes[0]).toEqual({ id: 0, name: "Default", stops: ["#FF0000", "#FFA000"] });
    expect(palettes[2]!.stops).toEqual([]);
    expect(palettes[12]!.stops.every((s) => /^#[0-9A-F]{6}$/.test(s))).toBe(true);
    const paths = f.requests.map((r) => r.path);
    expect(paths).toContain("/json/palx?page=0");
    expect(paths).toContain("/json/palx?page=1");
  });

  // Fails if a non-array effects reply is not mapped to 502 device_error.
  it("answers 502 device_error when the device's effects reply is not a list", async () => {
    const { t, url } = await setup({ ...seeds.backyard, effects: {} as unknown as string[] });
    const res = await t.inject({ method: "GET", url: url("effects") });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "device_error" });
  });
});
