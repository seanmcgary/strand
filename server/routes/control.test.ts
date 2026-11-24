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
  // Fails if the lists are not joined by index, or a RSVD entry stays in.
  it("joins effects with fxdata and drops RSVD", async () => {
    const { t, url } = await setup({ ...seeds.backyard, effects: ["Solid", "RSVD", "Blink"], fxdata: ["", "", "!,;!;"] });
    const res = await t.inject({ method: "GET", url: url("effects") });
    expect(res.statusCode).toBe(200);
    expect(res.json<Effect[]>()).toEqual([
      { id: 0, name: "Solid", meta: "" },
      { id: 2, name: "Blink", meta: "!,;!;" },
    ]);
  });

  // Fails if palette ids are not the list index.
  it("returns palettes with their index as id", async () => {
    const { t, url } = await setup();
    const res = await t.inject({ method: "GET", url: url("palettes") });
    expect(res.json<Palette[]>()).toEqual(seeds.backyard.palettes.map((name, id) => ({ id, name })));
  });

  // Fails if a non-array effects reply is not mapped to 502 device_error.
  it("answers 502 device_error when the device's effects reply is not a list", async () => {
    const { t, url } = await setup({ ...seeds.backyard, effects: {} as unknown as string[] });
    const res = await t.inject({ method: "GET", url: url("effects") });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "device_error" });
  });
});
