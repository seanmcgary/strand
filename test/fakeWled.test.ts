import { afterEach, describe, expect, it } from "vitest";
import { startFakeWled, type FakeWled } from "./fakeWled.ts";
import { seeds } from "./fixtures/seeds.ts";

const fakes: FakeWled[] = [];
afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const start = async (...args: Parameters<typeof startFakeWled>): Promise<FakeWled> => {
  const f = await startFakeWled(...args);
  fakes.push(f);
  return f;
};

const post = (f: FakeWled, path: string, body: string) =>
  fetch(`http://127.0.0.1:${f.port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("fake WLED device", () => {
  // Fails if /json/palx does not page the palettes as the firmware does.
  it("serves palette stops a page at a time", async () => {
    const f = await start(seeds.backyard);
    const res = await fetch(`http://127.0.0.1:${f.port}/json/palx?page=0`);
    const body = (await res.json()) as { m: number; p: Record<string, unknown> };
    expect(body.m).toBe(1);
    expect(Object.keys(body.p)).toHaveLength(8);
    expect(body.p["2"]).toEqual(["c1"]);
  });

  // Fails if the `port` option is ignored.
  it("listens on the requested port", async () => {
    const f = await start(seeds.garage, { port: 18999 });
    expect(f.port).toBe(18999);
    expect((await fetch("http://127.0.0.1:18999/json/state")).status).toBe(200);
  });

  // Fails if a psave with bootps does not set the config's boot preset.
  it("reports a psave's bootps as def.ps", async () => {
    const f = await start(seeds.backyard);
    await post(f, "/json/state", JSON.stringify({ psave: 250, o: true, bootps: 250, seg: [{ id: 0, n: "X" }] }));
    const cfg = (await (await fetch(`http://127.0.0.1:${f.port}/json/cfg`)).json()) as { def: { ps: number } };
    expect(cfg.def.ps).toBe(250);
  });

  // Fails if a body over the size limit is applied or answered with anything but 400.
  it("refuses a body over maxBody with 400 and changes nothing", async () => {
    const f = await start(seeds.backyard);
    const before = f.state;
    const prefix = '{"seg":[{"id":0,"n":"X"}],"pad":"';
    const body = `${prefix}${"a".repeat(10241 - prefix.length - 2)}"}`;
    expect(body).toHaveLength(10241);
    const res = await post(f, "/json/state", body);
    expect(res.status).toBe(400);
    expect(f.state).toEqual(before);
  });
});
