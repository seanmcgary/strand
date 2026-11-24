import type { LightsPatch, LightsView, WledConfig, WledInfo } from "../../shared/apiTypes";
import type { ServerDeps } from "../app";
import type { DeviceRow } from "../db/devices";
import * as preferences from "../db/preferences";
import * as strandGroups from "../db/strandGroups";
import { ApiError, messages } from "../errors";
import { targetOf } from "../routes/devices";
import { deviceRequest } from "../wled/deviceClient";
import {
  decodePaint,
  encodePaint,
  FLASH_NAME,
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

const SEPARATED = "A combined strand was separated because its LED outputs no longer touch.";
/** The most color runs (`start, stop, "RRGGBB"`) in one request, to stay under the device's JSON buffer. */
const RUNS_PER_REQUEST = 256;
const PAINT_TAG = " paint";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

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

function viewOf(d: Omit<DeviceLights, "view">, maxseg: number, matrix: boolean): LightsView {
  const notices = d.dropped.length > 0 ? [SEPARATED] : [];
  if (matrix) {
    return { on: d.state.on, bri: d.state.bri, strands: [], segments: { used: d.state.seg.length, max: maxseg }, notices, matrix: true };
  }
  return { ...readLayout(d.state, d.strands, d.lists, d.paint, maxseg), notices, matrix: false };
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
  return { ...d, view: viewOf(d, maxseg, isObject((info.leds as unknown as Json).matrix)) };
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
  let state = d.state;
  const flashes = state.seg.filter((s) => s.n === FLASH_NAME);
  if (flashes.length > 0 && !deps.lights.flashActive(d.row.id)) {
    const target = targetOf(d.row);
    await deviceRequest(deps, target, "/json/state", { method: "POST", body: { seg: flashes.map((s) => ({ id: s.id, stop: 0 })) } });
    state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
  }
  if (d.dropped.length === 0 && state === d.state) return d;
  const next = { ...d, state, dropped: [] };
  return { ...next, view: viewOf(next, d.view.segments.max, d.view.matrix) };
}

/** Splits a `seg.i` array into requests of at most `RUNS_PER_REQUEST` runs. */
function paintChunks(i: (number | string)[]): (number | string)[][] {
  const size = RUNS_PER_REQUEST * 3;
  const out: (number | string)[][] = [];
  for (let k = 0; k < i.length; k += size) out.push(i.slice(k, k + size));
  return out;
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
    for (const seg of write.seg) await post({ seg });
    if (write.paint.length > 0) {
      const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
      const byName = new Map(state.seg.filter((s) => s.n !== undefined).map((s) => [s.n!, s]));
      if (write.paint.some((p) => !byName.has(p.name))) throw new ApiError(409, "strand_changed", messages.strandChanged());
      const remembered: PaintMap = {};
      for (const p of write.paint) {
        const seg = byName.get(p.name)!;
        for (const i of paintChunks(p.i)) await post({ seg: { id: seg.id, i } });
        remembered[p.name] = decodePaint(p.i, seg.stop - seg.start);
      }
      deps.lights.rememberPaint(d.row.id, remembered);
    }
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
  const target = targetOf(row);
  const body: Json = { ...(patch.on === undefined ? {} : { on: patch.on }), ...(patch.bri === undefined ? {} : { bri: patch.bri }), v: true };
  if (patch.on !== true) return deviceRequest<Record<string, unknown>>(deps, target, "/json/state", { method: "POST", body });

  const state = parseState(await deviceRequest<unknown>(deps, target, "/json/state"));
  const painted = state.seg.filter((s) => isPainted(s) && s.grp === 1 && s.spc === 0);
  const paint = painted.length > 0 ? await readPaint(deps, row) : {};
  const items = painted
  .filter((s) => paint[s.n!]?.length === s.stop - s.start)
  .map((s) => ({ id: s.id, i: encodePaint(paint[s.n!]!) }));

  // The first request carries the paint that fits in one request; the rest follows, `RUNS_PER_REQUEST` runs at a time.
  const first: { id: number; i: (number | string)[] }[] = [];
  const rest: { id: number; i: (number | string)[] }[] = [];
  let runs = 0;
  for (const item of items) {
    const n = item.i.length / 3;
    if (rest.length === 0 && runs + n <= RUNS_PER_REQUEST) {
      first.push(item);
      runs += n;
    } else {
      rest.push(...paintChunks(item.i).map((i) => ({ id: item.id, i })));
    }
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
