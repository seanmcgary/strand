import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import { targetOf } from "../routes/devices";
import { deviceRequest } from "../wled/deviceClient";
import { maxsegOf } from "./deviceLights";
import { parseState, type PaintMap } from "./layoutRead";
import { buildStartupPreset, startupPaint } from "./startup";

/**
 * The server's only in-memory state (CONVENTIONS.md §5), per device: the flash
 * timer (spec §6.6), the startup-preset timer (spec §6.7), and the paint the
 * server sent since the last startup save. A restart loses at most one pending save.
 */

export type RuntimeLog = Pick<FastifyBaseLogger, "warn">;

export type LightsRuntime = {
  /** Restarts the device's startup-preset timer. */
  afterWrite(row: devices.DeviceRow): void;
  /** Merges paint (segment name → colors) into the device's paint memory. */
  rememberPaint(deviceId: string, paint: PaintMap): void;
  paintFor(deviceId: string): PaintMap;
  /** Calls `end` after `flashMs`; a previous flash's `end` is dropped. */
  startFlash(deviceId: string, end: () => Promise<void>): void;
  flashActive(deviceId: string): boolean;
  /** Drops the device's timers and paint memory. */
  forget(deviceId: string): void;
  /** Clears every timer. */
  close(): void;
};

type Timing = { flashMs: number; startupDelayMs: number };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createLightsRuntime(deps: AppDeps & Timing, log: RuntimeLog): LightsRuntime {
  const startupTimers = new Map<string, NodeJS.Timeout>();
  const flashTimers = new Map<string, NodeJS.Timeout>();
  const saving = new Set<string>();
  const paints = new Map<string, PaintMap>();
  let closed = false;

  const schedule = (deviceId: string): void => {
    clearTimeout(startupTimers.get(deviceId));
    if (closed) return;
    startupTimers.set(
      deviceId,
      setTimeout(() => fire(deviceId), deps.startupDelayMs),
    );
  };

  /** One startup save. It reads preset 250's paint first, so a strand not edited since the last save keeps its paint. */
  const save = async (row: devices.DeviceRow, memory: PaintMap): Promise<void> => {
    const target = targetOf(row);
    const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
    const maxseg = maxsegOf(await deviceRequest<unknown>(deps, target, "/json/info"), row.name);
    const presets = await deviceRequest<unknown>(deps, target, "/presets.json");
    const body = buildStartupPreset(state, { ...startupPaint(presets), ...memory }, maxseg);
    await deviceRequest(deps, target, "/json/state", { method: "POST", body });
  };

  const fire = (deviceId: string): void => {
    startupTimers.delete(deviceId);
    // The firmware warns that saves close together can corrupt presets.json, and a save deletes a flash segment.
    if (saving.has(deviceId) || flashTimers.has(deviceId)) {
      schedule(deviceId);
      return;
    }
    const row = devices.get(deps.db, deviceId);
    if (!row) return;
    const memory = { ...paints.get(deviceId) };
    saving.add(deviceId);
    save(row, memory)
    .then(() => {
      // Paint remembered during the save is newer than what was sent, so it stays.
      const current = paints.get(deviceId);
      if (!current) return;
      for (const [name, colors] of Object.entries(memory)) if (current[name] === colors) delete current[name];
      if (Object.keys(current).length === 0) paints.delete(deviceId);
    })
    .catch((err: unknown) => log.warn({ deviceId, message: messageOf(err) }, "startup preset save failed"))
    .finally(() => saving.delete(deviceId));
  };

  return {
    afterWrite(row) {
      schedule(row.id);
    },
    rememberPaint(deviceId, paint) {
      paints.set(deviceId, { ...paints.get(deviceId), ...paint });
    },
    paintFor(deviceId) {
      return { ...paints.get(deviceId) };
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
    },
    close() {
      closed = true;
      for (const timer of [...startupTimers.values(), ...flashTimers.values()]) clearTimeout(timer);
      startupTimers.clear();
      flashTimers.clear();
    },
  };
}
