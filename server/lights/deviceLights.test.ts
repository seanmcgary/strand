import { describe, expect, it, vi } from "vitest";
import { seeds } from "../../test/fixtures/seeds";
import { bigSeed, psaves, startLights } from "../../test/lightsRuntime";
import { clearLeftovers, flashLed, readDeviceLights, setDevicePower, writeLayout } from "./deviceLights";
import { encodePaint, FLASH_NAME } from "./layoutRead";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flashStarts = (state: { seg: object[] }) =>
  state.seg.filter((s) => (s as { n?: string }).n === FLASH_NAME).map((s) => (s as { start: number }).start);
const names = (state: { seg: object[] }) => state.seg.map((s) => (s as { n?: string }).n);

describe("device writes during a startup save", () => {
  // Fails if writeLayout does not wait for a save in flight, whose psave then puts the old layout back.
  it("a write sent while a save is in flight is not reverted", async () => {
    const s = await startLights({ startupDelayMs: 20 });
    const d = await readDeviceLights(s.deps, s.row);
    const release = s.f.hold({ method: "GET", path: "/presets.json" });
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(s.f.requests.some((r) => r.path === "/presets.json")).toBe(true));
    const write = writeLayout(s.deps, d, { seg: [[{ id: 0, start: 0, stop: 150, n: "Porch" }]], paint: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await write;
    await vi.waitFor(() => expect(psaves(s.f).length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(names(s.f.state)).toEqual(["Porch"]);
  });

  // Fails if a flash start does not wait for a save in flight, whose psave then deletes the flash segment.
  it("a flash started during a save stays lit until its own end", async () => {
    const s = await startLights({ startupDelayMs: 20, flashMs: 300 });
    const d = await readDeviceLights(s.deps, s.row);
    const release = s.f.hold({ method: "GET", path: "/presets.json" });
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(s.f.requests.some((r) => r.path === "/presets.json")).toBe(true));
    const flash = flashLed(s.deps, d, 5);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await flash;
    await vi.waitFor(() => expect(psaves(s.f)).toHaveLength(1));
    expect(names(s.f.state)).toContain(FLASH_NAME);
    await vi.waitFor(() => expect(names(s.f.state)).not.toContain(FLASH_NAME), { timeout: 2000 });
  });
});

describe("writeLayout", () => {
  // Fails if the paint is remembered only after every chunk is sent, so a failed chunk leaves the old paint to be saved.
  it("remembers the paint before a chunk fails", async () => {
    const s = await startLights({ seed: bigSeed(16) });
    s.f.applyState({ seg: [{ id: 0, start: 0, stop: 600, n: "Big paint", frz: true }] });
    const d = await readDeviceLights(s.deps, s.row);
    const stripes = Array.from({ length: 600 }, (_, k) => (k % 2 === 0 ? "#FF0000" : "#0000FF"));
    s.f.failNext("serverError", { method: "POST", path: "/json/state", skip: 1 });
    await expect(writeLayout(s.deps, d, { seg: [], paint: [{ name: "Big paint", i: encodePaint(stripes) }] })).rejects.toThrow();
    expect(s.rt.paintFor(s.row.id)).toEqual({ "Big paint": stripes });
  });
});

describe("flash", () => {
  // Fails if a flash end that waited behind a newer flash deletes the newer flash segment.
  it("a stale flash end leaves a newer flash lit", async () => {
    const s = await startLights({ flashMs: 150 });
    const d = await readDeviceLights(s.deps, s.row);
    await flashLed(s.deps, d, 5);
    const release = s.f.hold({ method: "POST", path: "/json/state" });
    const power = setDevicePower(s.deps, s.row, { bri: 100 });
    const second = flashLed(s.deps, d, 6);
    await sleep(250);
    release();
    await Promise.all([power, second]);
    await sleep(50);
    expect(flashStarts(s.f.state)).toEqual([6]);
  });

  // Fails if clearLeftovers decides before it waits its turn, and deletes a flash started ahead of it.
  it("clearLeftovers keeps a flash that started while it waited", async () => {
    const s = await startLights();
    s.f.applyState({ seg: [{ id: 1, start: 0, stop: 1, n: FLASH_NAME }] });
    const d = await readDeviceLights(s.deps, s.row);
    const release = s.f.hold({ method: "POST", path: "/json/state" });
    const power = setDevicePower(s.deps, s.row, { bri: 100 });
    const flash = flashLed(s.deps, d, 6);
    const clear = clearLeftovers(s.deps, d);
    release();
    await Promise.all([power, flash, clear]);
    expect(flashStarts(s.f.state)).toEqual([6]);
  });
});

describe("paint requests", () => {
  // Fails if paint is cut into requests by a fixed run count instead of the device's JSON limits, so the ESP8266 refuses one.
  it("splits a 300-LED alternating paint into requests the ESP8266 accepts", async () => {
    const s = await startLights({ seed: seeds.frontRoof });
    s.f.applyState({ seg: [{ id: 0, start: 0, stop: 300, n: "Roof paint", frz: true }] });
    const d = await readDeviceLights(s.deps, s.row);
    const stripes = Array.from({ length: 300 }, (_, k) => (k % 2 === 0 ? "#FF0000" : "#0000FF"));
    await writeLayout(s.deps, d, { seg: [], paint: [{ name: "Roof paint", i: encodePaint(stripes) }] });
    const paintPosts = s.f.requests.filter((r) => r.method === "POST" && (r.body as { seg?: { i?: unknown } }).seg?.i !== undefined);
    expect(paintPosts.length).toBeGreaterThan(1);
    expect(s.f.pixels(0)).toEqual(stripes);
  });
});
