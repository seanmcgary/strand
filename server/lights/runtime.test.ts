import { afterEach, describe, expect, it, vi } from "vitest";
import { bigSeed, psaves, startLights } from "../../test/lightsRuntime";
import type { FakeWled } from "../../test/fakeWled";
import { readDeviceLights, notices } from "./deviceLights";
import { encodePaint } from "./layoutRead";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const setup = (times: { startupDelayMs?: number; flashMs?: number }, warn?: () => void) => startLights({ ...times, warn });

const segOf = (body: unknown, name: string) => (body as { seg: { n?: string; i?: unknown }[] }).seg.find((s) => s.n === name);

const A = Array<string>(10).fill("#FF0000");
const B = [...Array<string>(5).fill("#00FF00"), ...Array<string>(5).fill("#0000FF")];
const twoPainted = (f: FakeWled) =>
  f.applyState({
    seg: [
      { id: 0, start: 0, stop: 10, n: "A paint", frz: true },
      { id: 1, start: 10, stop: 20, n: "B paint", frz: true },
    ],
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("startup timer", () => {
  // Fails if afterWrite stops restarting the timer, or a timer fires more than once.
  it("saves once, startupDelayMs after the last write", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 80 });
    rt.afterWrite(row);
    await sleep(30);
    rt.afterWrite(row);
    await sleep(78);
    expect(psaves(f)).toHaveLength(0);
    await sleep(200);
    expect(psaves(f)).toHaveLength(1);
  });

  // Fails if a timer that fires during a save sends a second save at once instead of waiting for the first to end.
  it("never sends a save while another is in flight", async () => {
    let atFailure = -1;
    const s = await setup({ startupDelayMs: 50 }, () => {
      atFailure = psaves(s.f).length;
    });
    s.f.failNext("timeout", { method: "POST", path: "/json/state" });
    s.rt.afterWrite(s.row);
    await sleep(70);
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(psaves(s.f)).toHaveLength(2), { timeout: 2000 });
    expect(atFailure).toBe(1);
    expect(s.warn).toHaveBeenCalledWith({ deviceId: s.row.id, message: expect.any(String) }, "startup preset save failed");
  });

  // Fails if the save leaves out the paint memory, or keeps the memory after the save succeeds.
  it("sends the remembered paint and then forgets it", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 20 });
    twoPainted(f);
    rt.rememberPaint(row.id, { "A paint": A });
    rt.afterWrite(row);
    await vi.waitFor(() => expect(rt.paintFor(row.id)).toEqual({}));
    expect(segOf(psaves(f)[0]!.body, "A paint")!.i).toEqual(encodePaint(A));
  });

  // Fails if a successful save also forgets paint remembered while it was in flight.
  it("keeps paint remembered during the save", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 20 });
    twoPainted(f);
    rt.rememberPaint(row.id, { "A paint": A });
    f.afterPost(() => rt.rememberPaint(row.id, { "A paint": B }));
    rt.afterWrite(row);
    await vi.waitFor(() => expect(psaves(f)).toHaveLength(1));
    await sleep(100);
    expect(rt.paintFor(row.id)).toEqual({ "A paint": B });
  });

  // Fails if the save stops merging the paint memory over preset 250's paint, so an unedited strand loses its paint.
  it("keeps the paint of strands not edited since the last save", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 20 });
    twoPainted(f);
    rt.rememberPaint(row.id, { "A paint": A });
    rt.afterWrite(row);
    await vi.waitFor(() => expect(psaves(f)).toHaveLength(1));
    rt.rememberPaint(row.id, { "B paint": B });
    rt.afterWrite(row);
    await vi.waitFor(() => expect(psaves(f)).toHaveLength(2));
    const body = psaves(f)[1]!.body;
    expect(segOf(body, "A paint")!.i).toEqual(encodePaint(A));
    expect(segOf(body, "B paint")!.i).toEqual(encodePaint(B));
  });

  // Fails if a save runs during a flash, which would delete the flash segment early.
  it("waits for a flash to end", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 30, flashMs: 150 });
    rt.startFlash(row.id, async () => {});
    rt.afterWrite(row);
    await sleep(120);
    expect(psaves(f)).toHaveLength(0);
    await vi.waitFor(() => expect(psaves(f)).toHaveLength(1));
  });

  // Fails if a timer may fire a save less than startupDelayMs after the last one was sent.
  it("keeps startupDelayMs between two saves", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 200 });
    const sent: number[] = [];
    f.afterPost(() => {
      sent.push(Date.now());
      f.afterPost(() => sent.push(Date.now()));
    });
    const release = f.hold({ method: "GET", path: "/presets.json" });
    rt.afterWrite(row);
    await vi.waitFor(() => expect(f.requests.some((r) => r.path === "/presets.json")).toBe(true));
    await sleep(50);
    rt.afterWrite(row);
    await sleep(150);
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 2000 });
    expect(sent[1]! - sent[0]!).toBeGreaterThanOrEqual(195);
  });

  // Fails if a preset over the device's JSON buffer is sent with its paint, or the view does not say the paint is not kept.
  it("saves without paint when the paint is too large, and says so until a save with paint", async () => {
    const s = await startLights({ startupDelayMs: 20, seed: bigSeed(16) });
    s.f.applyState({ seg: [{ id: 0, start: 0, stop: 1000, n: "Big paint", frz: true }] });
    const stripes = Array.from({ length: 1000 }, (_, k) => (k % 2 === 0 ? "#FF0000" : "#0000FF"));
    s.rt.rememberPaint(s.row.id, { "Big paint": stripes });
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(psaves(s.f)).toHaveLength(1));
    const body = psaves(s.f)[0]!.body as { seg: Record<string, unknown>[] };
    expect(body.seg[0]).not.toHaveProperty("i");
    expect(body.seg[0]).not.toHaveProperty("frz");
    await vi.waitFor(async () => expect((await readDeviceLights(s.deps, s.row)).view.notices).toEqual([notices.paintNotSaved]));

    s.rt.rememberPaint(s.row.id, { "Big paint": Array<string>(1000).fill("#00FF00") });
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(psaves(s.f)).toHaveLength(2));
    await vi.waitFor(async () => expect((await readDeviceLights(s.deps, s.row)).view.notices).toEqual([]));
  });

  // Fails if the preset is measured by its text alone: this one is short, but its values overflow the ESP8266's JSON document.
  it("saves without paint when the paint's values do not fit the device's JSON document", async () => {
    const s = await startLights({ startupDelayMs: 20, seed: bigSeed(16) });
    s.f.applyState({ seg: [{ id: 0, start: 0, stop: 300, n: "Roof paint", frz: true }] });
    const stripes = Array.from({ length: 300 }, (_, k) => (k % 2 === 0 ? "#FF0000" : "#0000FF"));
    s.rt.rememberPaint(s.row.id, { "Roof paint": stripes });
    s.rt.afterWrite(s.row);
    await vi.waitFor(() => expect(psaves(s.f)).toHaveLength(1));
    const body = psaves(s.f)[0]!.body as { seg: Record<string, unknown>[] };
    expect(JSON.stringify(body).length).toBeLessThan(10240);
    expect(body.seg[0]).not.toHaveProperty("i");
    await vi.waitFor(async () => expect((await readDeviceLights(s.deps, s.row)).view.notices).toEqual([notices.paintNotSaved]));
  });

  // Fails if a preset that is too large even without paint is sent, or the view does not say the setup is not kept.
  it("skips a save that is too large without paint, and says so", async () => {
    const s = await startLights({ startupDelayMs: 20, seed: bigSeed(64) });
    const name = (k: number) => `Range number ${String(k).padStart(2, "0")} of many!!`;
    s.f.applyState({ seg: Array.from({ length: 60 }, (_, k) => ({ id: k, start: k * 16, stop: k * 16 + 16, n: name(k) })) });
    s.rt.afterWrite(s.row);
    await vi.waitFor(async () => expect((await readDeviceLights(s.deps, s.row)).view.notices).toEqual([notices.tooLarge]));
    expect(psaves(s.f)).toHaveLength(0);
  });

  // Fails if close() leaves a startup timer running.
  it("close() cancels the timer", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 50 });
    rt.afterWrite(row);
    rt.close();
    await sleep(200);
    expect(psaves(f)).toHaveLength(0);
  });

  // Fails if forget() leaves the device's timers or paint memory.
  it("forget() cancels the device's timers and paint", async () => {
    const { f, row, rt } = await setup({ startupDelayMs: 50, flashMs: 50 });
    const end = vi.fn(async () => {});
    rt.rememberPaint(row.id, { "A paint": A });
    rt.startFlash(row.id, end);
    rt.afterWrite(row);
    rt.forget(row.id);
    await sleep(200);
    expect(psaves(f)).toHaveLength(0);
    expect(end).not.toHaveBeenCalled();
    expect(rt.paintFor(row.id)).toEqual({});
  });
});

describe("flash timer", () => {
  // Fails if a second flash does not cancel the first one's end, or the end runs more than once.
  it("a second flash replaces the first", async () => {
    const { rt, row } = await setup({ flashMs: 50 });
    vi.useFakeTimers();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    rt.startFlash(row.id, first);
    await vi.advanceTimersByTimeAsync(10);
    rt.startFlash(row.id, second);
    expect(rt.flashActive(row.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(rt.flashActive(row.id)).toBe(false);
  });

  // Fails if a rejected flash end goes unhandled, or the log gets more than the device ID and the message.
  it("logs a failed flash end", async () => {
    const { rt, row, warn } = await setup({ flashMs: 50 });
    vi.useFakeTimers();
    rt.startFlash(row.id, async () => {
      throw new Error("x");
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(warn.mock.calls).toEqual([[{ deviceId: row.id, message: "x" }, "flash end failed"]]);
  });
});
