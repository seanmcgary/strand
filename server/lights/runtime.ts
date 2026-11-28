import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import { targetOf } from "../routes/devices";
import { deviceRequest } from "../wled/deviceClient";
import { maxsegOf } from "./deviceLights";
import { isObject, parseState, type PaintMap } from "./layoutRead";
import { fitsDevice } from "../wled/jsonLimits";
import { buildStartupPreset, startupPaint } from "./startup";

/**
 * The server's only in-memory state (CONVENTIONS.md §5), per device: the flash
 * timer (spec §6.6), the startup-preset timer (spec §6.7), the paint the
 * server sent since the last startup save, and a queue that runs the device's
 * writes one at a time. A restart loses at most one pending save.
 */

export type RuntimeLog = Pick<FastifyBaseLogger, "warn">;

/** Why the last startup save left something out: the paint ("paint"), or everything ("size"). */
export type StartupIssue = "paint" | "size";

export type LightsRuntime = {
  /**
   * Runs `fn` after every earlier `run` of the device has settled. Every
   * device write goes through it, so a startup save never reads a state that a
   * write then changes before the save is sent. `fn` must not call `run` for the same device.
   */
  run<T>(deviceId: string, fn: () => Promise<T>): Promise<T>;
  /** Restarts the device's startup-preset timer. */
  afterWrite(row: devices.DeviceRow): void;
  /** Merges paint (`paintKey` → colors) into the device's paint memory. */
  rememberPaint(deviceId: string, paint: PaintMap): void;
  paintFor(deviceId: string): PaintMap;
  /** What the last startup save of the device left out, or null. */
  startupIssue(deviceId: string): StartupIssue | null;
  /**
   * Starts a new flash of the device and returns whether it is still the
   * newest one. A flash end that waited its turn checks it, so it never ends a newer flash.
   */
  flashTicket(deviceId: string): () => boolean;
  /** Calls `end` after `flashMs`; a previous flash's `end` is dropped. */
  startFlash(deviceId: string, end: () => Promise<void>): void;
  flashActive(deviceId: string): boolean;
  /** Drops the device's timers, paint memory and startup issue. */
  forget(deviceId: string): void;
  /** Clears every timer. */
  close(): void;
};

type Timing = { flashMs: number; startupDelayMs: number };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createLightsRuntime(deps: AppDeps & Timing, log: RuntimeLog): LightsRuntime {
  const startupTimers = new Map<string, NodeJS.Timeout>();
  const flashTimers = new Map<string, NodeJS.Timeout>();
  const queues = new Map<string, Promise<unknown>>();
  const saving = new Set<string>();
  const lastSave = new Map<string, number>();
  const paints = new Map<string, PaintMap>();
  const issues = new Map<string, StartupIssue>();
  const flashes = new Map<string, number>();
  let closed = false;

  const run = <T>(deviceId: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(deviceId) ?? Promise.resolve()).then(fn, fn);
    queues.set(deviceId, next);
    const done = (): void => {
      if (queues.get(deviceId) === next) queues.delete(deviceId);
    };
    next.then(done, done);
    return next;
  };

  const schedule = (deviceId: string, ms = deps.startupDelayMs): void => {
    clearTimeout(startupTimers.get(deviceId));
    if (closed) return;
    startupTimers.set(
      deviceId,
      setTimeout(() => fire(deviceId), ms),
    );
  };

  /**
   * One startup save. It reads preset 250's paint first, so a strand not edited
   * since the last save keeps its paint. A body the device would refuse
   * (`fitsDevice`) is sent without paint; one it would still refuse is not sent.
   * Returns whether the paint memory was saved.
   */
  const save = async (row: devices.DeviceRow, memory: PaintMap): Promise<boolean> => {
    const target = targetOf(row);
    const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
    const info = await deviceRequest<unknown>(deps, target, "/json/info");
    const maxseg = maxsegOf(info, row.name);
    const arch = isObject(info) ? info.arch : undefined;
    const presets = await deviceRequest<unknown>(deps, target, "/presets.json");
    let body = buildStartupPreset(state, { ...startupPaint(presets), ...memory }, maxseg);
    let issue: StartupIssue | null = null;
    if (!fitsDevice(body, arch)) {
      body = buildStartupPreset(state, {}, maxseg);
      issue = fitsDevice(body, arch) ? "paint" : "size";
    }
    if (issue === "size") {
      issues.set(row.id, issue);
      return false;
    }
    lastSave.set(row.id, Date.now());
    await deviceRequest(deps, target, "/json/state", { method: "POST", body });
    if (issue) issues.set(row.id, issue);
    else issues.delete(row.id);
    return issue === null;
  };

  const fire = (deviceId: string): void => {
    startupTimers.delete(deviceId);
    // The firmware warns that saves close together can corrupt presets.json (`presets.cpp:250`).
    const wait = (lastSave.get(deviceId) ?? -Infinity) + deps.startupDelayMs - Date.now();
    if (wait > 0) {
      schedule(deviceId, wait);
      return;
    }
    // A save would delete a lit flash segment.
    if (saving.has(deviceId) || flashTimers.has(deviceId)) {
      schedule(deviceId);
      return;
    }
    const row = devices.get(deps.db, deviceId);
    if (!row) return;
    const memory = { ...paints.get(deviceId) };
    saving.add(deviceId);
    run(deviceId, () => save(row, memory))
    .then((saved) => {
      // Paint remembered during the save is newer than what was sent, so it stays.
      const current = paints.get(deviceId);
      if (!saved || !current) return;
      for (const [name, colors] of Object.entries(memory)) if (current[name] === colors) delete current[name];
      if (Object.keys(current).length === 0) paints.delete(deviceId);
    })
    .catch((err: unknown) => log.warn({ deviceId, message: messageOf(err) }, "startup preset save failed"))
    .finally(() => saving.delete(deviceId));
  };

  return {
    run,
    afterWrite(row) {
      schedule(row.id);
    },
    rememberPaint(deviceId, paint) {
      paints.set(deviceId, { ...paints.get(deviceId), ...paint });
    },
    paintFor(deviceId) {
      return { ...paints.get(deviceId) };
    },
    startupIssue(deviceId) {
      return issues.get(deviceId) ?? null;
    },
    flashTicket(deviceId) {
      const n = (flashes.get(deviceId) ?? 0) + 1;
      flashes.set(deviceId, n);
      return () => flashes.get(deviceId) === n;
    },
    startFlash(deviceId, end) {
      clearTimeout(flashTimers.get(deviceId));
      if (closed) return;
      const timer = setTimeout(() => {
        flashTimers.delete(deviceId);
        Promise.resolve()
        .then(end)
        .catch((err: unknown) => log.warn({ deviceId, message: messageOf(err) }, "flash end failed"));
      }, deps.flashMs);
      flashTimers.set(deviceId, timer);
    },
    flashActive(deviceId) {
      return flashTimers.has(deviceId);
    },
    forget(deviceId) {
      clearTimeout(startupTimers.get(deviceId));
      clearTimeout(flashTimers.get(deviceId));
      startupTimers.delete(deviceId);
      flashTimers.delete(deviceId);
      paints.delete(deviceId);
      issues.delete(deviceId);
      lastSave.delete(deviceId);
      flashes.delete(deviceId);
    },
    close() {
      closed = true;
      for (const timer of [...startupTimers.values(), ...flashTimers.values()]) clearTimeout(timer);
      startupTimers.clear();
      flashTimers.clear();
    },
  };
}
