import type { LightsPatch, LightsView, WledConfig, WledInfo } from "../../shared/apiTypes";
import type { ServerDeps } from "../app";
import type { DeviceRow } from "../db/devices";
import * as preferences from "../db/preferences";
import * as strandGroups from "../db/strandGroups";
import { ApiError, messages } from "../errors";
import { targetOf } from "../routes/devices";
import { deviceRequest } from "../wled/deviceClient";
import { fitsDevice, splitRuns } from "../wled/jsonLimits";
import {
  decodePaint,
  encodePaint,
  FLASH_NAME,
  isInt,
  isObject,
  PAINT_TAG,
  parseState,
  readLayout,
  strandsFromConfig,
  type Lists,
  type PaintMap,
  type Strand,
  type WledSeg,
  type WledState,
} from "./layoutRead";
import type { LayoutError, LayoutWrite } from "./layoutWrite";
import { startupPaint } from "./startup";

/**
 * A device's lights as the Lights endpoints use them: read the device into a
 * `LightsView`, clear leftovers before a write, send a `LayoutWrite`, and power.
 * Every device request goes through `deviceRequest`; nothing here is cached.
 */

export type DeviceLights = {
  row: DeviceRow;
  state: WledState;
  info: WledInfo;
  lists: Lists;
  strands: Strand[];
  dropped: string[];
  paint: PaintMap;
  view: LightsView;
};

/** The Lights tab's notices (`LightsView.notices`). */
export const notices = {
  separated: "A combined strand was separated because its LED outputs no longer touch.",
  paintNotSaved: "Painted colors won't survive a restart: there are too many painted LEDs to save on this controller.",
  tooLarge: "Your setup is too large to keep after a restart.",
};

type Json = Record<string, unknown>;

const invalid = (name: string): ApiError => new ApiError(502, "device_error", messages.deviceError(name, "the reply is not valid"));

/** `info.leds.maxseg`, an integer 1-256, or `502 device_error`. */
export function maxsegOf(info: unknown, name: string): number {
  const leds = isObject(info) && isObject(info.leds) ? info.leds : {};
  if (!isInt(leds.maxseg) || leds.maxseg < 1 || leds.maxseg > 256) throw invalid(name);
  return leds.maxseg;
}

/** The LED outputs of `/json/cfg`. Each needs integer `start ≥ 0` and `len ≥ 1`, or `502 device_error`. */
function outputsOf(cfg: unknown, name: string): WledConfig {
  const hw = isObject(cfg) && isObject(cfg.hw) ? cfg.hw : {};
  const led = isObject(hw.led) ? hw.led : {};
  if (!Array.isArray(led.ins)) throw invalid(name);
  const ins = led.ins.map((out: unknown) => {
    if (!isObject(out) || !isInt(out.start) || out.start < 0 || !isInt(out.len) || out.len < 1) throw invalid(name);
    return { ...out, pin: Array.isArray(out.pin) ? out.pin.filter(isInt) : [] };
  });
  return { hw: { led: { ins } } } as unknown as WledConfig;
}

function namesOf(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function listOf(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw invalid(name);
  return value.map((v) => (typeof v === "string" ? v : ""));
}

const isPainted = (s: WledSeg): boolean => s.n !== undefined && s.n.endsWith(PAINT_TAG);

/** Preset 250's paint with the paint the server sent since the last startup save over it. */
async function readPaint(deps: ServerDeps, row: DeviceRow): Promise<PaintMap> {
  const presets = await deviceRequest<unknown>(deps, targetOf(row), "/presets.json");
  return { ...startupPaint(presets), ...deps.lights.paintFor(row.id) };
}

function viewOf(deps: ServerDeps, d: Omit<DeviceLights, "view">, maxseg: number, matrix: boolean): LightsView {
  const issue = deps.lights.startupIssue(d.row.id);
  const list = [
    ...(d.dropped.length > 0 ? [notices.separated] : []),
    ...(issue === "paint" ? [notices.paintNotSaved] : issue === "size" ? [notices.tooLarge] : []),
  ];
  if (matrix) {
    return { on: d.state.on, bri: d.state.bri, strands: [], segments: { used: d.state.seg.length, max: maxseg }, notices: list, matrix: true };
  }
  return { ...readLayout(d.state, d.strands, d.lists, d.paint, maxseg), notices: list, matrix: false };
}

/** Reads a device's lights. It writes nothing to the device or the database (Plan decision 13). */
export async function readDeviceLights(deps: ServerDeps, row: DeviceRow): Promise<DeviceLights> {
  const target = targetOf(row);
  const cfg = outputsOf(await deviceRequest<unknown>(deps, target, "/json/cfg"), row.name);
  const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
  const rawInfo = await deviceRequest<unknown>(deps, target, "/json/info");
  const maxseg = maxsegOf(rawInfo, row.name);
  const info = rawInfo as WledInfo;
  const lists: Lists = {
    effects: listOf(await deviceRequest<unknown>(deps, target, "/json/effects"), row.name),
    palettes: listOf(await deviceRequest<unknown>(deps, target, "/json/palettes"), row.name),
  };
  const paint = state.seg.some(isPainted) ? await readPaint(deps, row) : deps.lights.paintFor(row.id);
  const names = namesOf(preferences.get(deps.db, `strandNames.${row.id}`));
  const { strands, dropped } = strandsFromConfig(cfg, strandGroups.list(deps.db, row.id), names);
  const d = { row, state, info, lists, strands, dropped, paint };
  return { ...d, view: viewOf(deps, d, maxseg, isObject((info.leds as unknown as Json).matrix)) };
}

/**
 * Deletes what a read leaves in place (Plan decision 13): dropped combinations
 * from the database, and "Strand flash" segments when no flash is running.
 * With nothing to clear, it sends nothing.
 */
export async function clearLeftovers(deps: ServerDeps, d: DeviceLights): Promise<DeviceLights> {
  if (d.dropped.length > 0) {
    strandGroups.replace(deps.db, d.row.id, strandGroups.list(deps.db, d.row.id).filter((k) => !d.dropped.includes(k)));
  }
  // `flashActive` is read in turn: a flash that started while this waited is not a leftover.
  const state = d.state.seg.some((s) => s.n === FLASH_NAME)
    ? await deps.lights.run(d.row.id, async () => (deps.lights.flashActive(d.row.id) ? d.state : deleteFlashes(deps, d.row, true)))
    : d.state;
  if (d.dropped.length === 0 && state === d.state) return d;
  const next = { ...d, state, dropped: [] };
  return { ...next, view: viewOf(deps, next, d.view.segments.max, d.view.matrix) };
}

/**
 * Reads the state and deletes every segment named `FLASH_NAME`, by its ID in
 * that read. Returns the state after the delete (`reread`), or the state it read.
 * Call it inside `run`.
 */
async function deleteFlashes(deps: ServerDeps, row: DeviceRow, reread: boolean): Promise<WledState> {
  const target = targetOf(row);
  const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
  const flashes = state.seg.filter((s) => s.n === FLASH_NAME);
  if (flashes.length === 0) return state;
  await deviceRequest(deps, target, "/json/state", { method: "POST", body: { seg: flashes.map((s) => ({ id: s.id, stop: 0 })) } });
  return reread ? parseState(await deviceRequest<unknown>(deps, target, "/json/state")) : state;
}

/**
 * Lights one LED (`start`, from the device's first LED) white for `flashMs`
 * (spec §6.6). In one request it deletes every flash segment and creates one at
 * the highest ID that no other segment uses. The end deletes the flash
 * segments it finds by name, so it never deletes a segment that took a remembered ID.
 */
export async function flashLed(deps: ServerDeps, d: DeviceLights, start: number): Promise<void> {
  const { row } = d;
  const newest = deps.lights.flashTicket(row.id);
  await deps.lights.run(row.id, async () => {
    const target = targetOf(row);
    const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
    const others = new Set(state.seg.filter((s) => s.n !== FLASH_NAME).map((s) => s.id));
    let id = d.view.segments.max - 1;
    while (id >= 0 && others.has(id)) id--;
    if (id < 0) throw new ApiError(422, "segment_budget", messages.segmentBudget(1, 0), { need: 1 });
    const deletes = state.seg.filter((s) => s.n === FLASH_NAME && s.id !== id).map((s) => ({ id: s.id, stop: 0 }));
    const flash = { id, start, stop: start + 1, fx: 0, col: [[255, 255, 255]], bri: 255, on: true, n: FLASH_NAME };
    await deviceRequest(deps, target, "/json/state", { method: "POST", body: { seg: [...deletes, flash] } });
    deps.lights.startFlash(row.id, async () => {
      await deps.lights.run(row.id, async () => {
        if (newest()) await deleteFlashes(deps, row, false);
      });
    });
  });
}

/**
 * Sends a layout write: each `seg` request, then the paint, by segment name
 * after a fresh read of the state. It remembers the paint, restarts the
 * startup timer, and returns the device's lights as they are now.
 */
export async function writeLayout(deps: ServerDeps, d: DeviceLights, write: LayoutWrite): Promise<DeviceLights> {
  const target = targetOf(d.row);
  let sent = false;
  const post = async (body: Json): Promise<void> => {
    sent = true;
    await deviceRequest(deps, target, "/json/state", { method: "POST", body });
  };
  try {
    await deps.lights.run(d.row.id, async () => {
      for (const seg of write.seg) await post({ seg });
      if (write.paint.length === 0) return;
      const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
      const byName = new Map(state.seg.filter((s) => s.n !== undefined).map((s) => [s.n!, s]));
      if (write.paint.some((p) => !byName.has(p.name))) throw new ApiError(409, "strand_changed", messages.strandChanged());
      // Remembered before it is sent: after a failed chunk the next save then writes the new paint, never the old.
      deps.lights.rememberPaint(
        d.row.id,
        Object.fromEntries(write.paint.map((p) => [p.name, decodePaint(p.i, byName.get(p.name)!.stop - byName.get(p.name)!.start)])),
      );
      for (const p of write.paint) {
        const id = byName.get(p.name)!.id;
        for (const i of splitRuns(p.i, (part) => ({ seg: { id, i: part } }), d.info.arch)) await post({ seg: { id, i } });
      }
    });
  } catch (err) {
    if (sent) deps.lights.afterWrite(d.row);
    throw err;
  }
  deps.lights.afterWrite(d.row);
  return readDeviceLights(deps, d.row);
}

/**
 * Sets the device's power and brightness and returns its full state reply.
 * Turning on also sends the paint again, as the firmware unfreezes every
 * segment at power-on (spec §6.4, Plan decision 12). It does not schedule a startup save.
 */
export async function setDevicePower(deps: ServerDeps, row: DeviceRow, patch: LightsPatch): Promise<Record<string, unknown>> {
  return deps.lights.run(row.id, () => sendPower(deps, row, patch));
}

async function sendPower(deps: ServerDeps, row: DeviceRow, patch: LightsPatch): Promise<Record<string, unknown>> {
  const target = targetOf(row);
  const body: Json = { ...(patch.on === undefined ? {} : { on: patch.on }), ...(patch.bri === undefined ? {} : { bri: patch.bri }), v: true };
  if (patch.on !== true) return deviceRequest<Record<string, unknown>>(deps, target, "/json/state", { method: "POST", body });

  const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
  const painted = state.seg.filter((s) => isPainted(s) && s.grp === 1 && s.spc === 0);
  const paint = painted.length > 0 ? await readPaint(deps, row) : {};
  const items = painted
  .filter((s) => paint[s.n!]?.length === s.stop - s.start)
  .map((s) => ({ id: s.id, i: encodePaint(paint[s.n!]!) }));

  // The first request carries the whole segments' paint that fits the device; the rest follows in requests that fit.
  const info = items.length > 0 ? await deviceRequest<unknown>(deps, target, "/json/info") : undefined;
  const arch = isObject(info) ? info.arch : undefined;
  const first: { id: number; i: (number | string)[] }[] = [];
  const rest: { id: number; i: (number | string)[] }[] = [];
  for (const item of items) {
    if (rest.length === 0 && fitsDevice({ ...body, seg: [...first, item] }, arch)) first.push(item);
    else rest.push(...splitRuns(item.i, (part) => ({ seg: { id: item.id, i: part } }), arch).map((i) => ({ id: item.id, i })));
  }
  const reply = await deviceRequest<Record<string, unknown>>(deps, target, "/json/state", {
    method: "POST",
    body: first.length > 0 ? { ...body, seg: first } : body,
  });
  for (const seg of rest) await deviceRequest(deps, target, "/json/state", { method: "POST", body: { seg } });
  return reply;
}

/** The API error for a `LayoutError`, with the contract's status and message. */
export function deviceError(e: LayoutError, strandName: string): ApiError {
  switch (e.code) {
    case "segment_budget":
      return new ApiError(422, "segment_budget", e.message, { need: e.need ?? 0 });
    case "shared":
      return new ApiError(409, "shared", messages.shared(strandName));
    case "invalid_layout":
      // `lookFromRange` refuses a painted range with this code; validation reasons are not user text.
      if (e.message === messages.painted()) return new ApiError(422, "painted", e.message);
      return new ApiError(422, "invalid_layout", messages.invalidLayout());
  }
}
