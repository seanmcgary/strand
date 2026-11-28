import type { RangeView, SlotView, StrandPatch } from "../../shared/apiTypes";
import { messages } from "../errors";
import { HEX_COLOR, MAX_EVERY, NAME_CHARS } from "../../shared/segmentName";
import { encodePaint, FLASH_NAME, isColor, isInt, readStrand, segmentName, type Lists, type PaintMap, type Strand, type WledSeg, type WledState } from "./layoutRead";

/**
 * Writes a strand's layout as WLED segments (spec §6.2 "Writing a layout").
 * Pure: the result is the requests to send, and the endpoint sends them.
 */

export type SegPatch = { id: number } & Partial<Omit<WledSeg, "id">> & { rev?: boolean; mi?: boolean; i?: (number | string)[] };

export type LayoutWrite = { seg: SegPatch[][]; paint: { name: string; start: number; i: (number | string)[] }[] };

export type LayoutErrorCode = "segment_budget" | "invalid_layout" | "shared" | "painted";

export class LayoutError extends Error {
  code: LayoutErrorCode;
  need?: number;

  constructor(code: LayoutErrorCode, message: string, budget?: { need: number }) {
    super(message);
    this.name = "LayoutError";
    this.code = code;
    if (budget) this.need = budget.need;
  }
}

const BYTE_FIELDS = ["sx", "ix", "c1", "c2", "pal"] as const;
const SLOT_NUMBERS = ["fx", "sx", "ix", "c1", "c2", "c3", "pal"] as const;
const SLOT_FLAGS = ["o1", "o2", "o3"] as const;

const intIn = (v: unknown, min: number, max: number): boolean => isInt(v) && v >= min && v <= max;
const samePattern = (a: RangeView["pattern"], b: RangeView["pattern"]): boolean =>
  a.kind === b.kind && (a.kind !== "every" || (b.kind === "every" && a.n === b.n && a.group === b.group));

/** Why a slot breaks the contract, or null. An `fx` outside the list passes when the device already has it on that slot. */
function slotReason(s: SlotView, effectCount: number, currentFx: number | undefined): string | null {
  if (!Array.isArray(s.col) || s.col.length < 1 || s.col.length > 3 || !s.col.every(isColor)) return "a slot color is not valid";
  if (!isInt(s.fx) || ((s.fx < 0 || s.fx >= effectCount) && s.fx !== currentFx)) return "a slot effect is not on this controller";
  if (!BYTE_FIELDS.every((k) => intIn(s[k], 0, 255))) return "a slot setting is out of range";
  if (!intIn(s.c3, 0, 31)) return "a slot c3 is out of range";
  if (![s.on, s.o1, s.o2, s.o3].every((b) => typeof b === "boolean")) return "a slot flag is not a boolean";
  return null;
}

/** The current range a next range continues: the one with its name, or, when several share it, the one nearest its start. */
function currentRange(current: RangeView[], name: string, start: number): RangeView | undefined {
  const named = current.filter((c) => c.name.trim() === name);
  return named.sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))[0];
}

/**
 * Why `ranges` do not fit `strand` (the contract's `invalid_layout` rules), or
 * null. `current` is the strand's view on the device, for the `fx` exception.
 */
export function validateRanges(strand: Strand, ranges: RangeView[], effectCount: number, opts: { sharedNames?: boolean; current?: RangeView[] } = {}): string | null {
  if (ranges.length === 0) return "a strand needs a range";
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const names = new Set<string>();
  let at = 0;
  for (const r of sorted) {
    if (!isInt(r.start) || !isInt(r.len) || r.len < 1) return "a range has no LEDs";
    if (r.start < at) return "ranges overlap";
    if (r.start > at) return "ranges leave a gap";
    at = r.start + r.len;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const chars = [...name].length;
    if (chars < 1 || chars > NAME_CHARS) return "a range name needs 1 to 64 characters";
    // The device keeps the name cut to 32 bytes, so names must differ within that cut to read back.
    const written = segmentName(name, "");
    if (!opts.sharedNames && names.has(written)) return "two ranges have the same name";
    names.add(written);
    const p = r.pattern;
    if (p.kind === "every") {
      const span = (p.n - 1) * p.group;
      if (!intIn(p.n, 2, MAX_EVERY) || !intIn(p.group, 1, 255) || span > 255 || span >= r.len) return "an Every pattern does not fit its range";
    } else if (p.kind === "individual") {
      if (!Array.isArray(r.paint) || r.paint.length !== r.len || !r.paint.every((c) => typeof c === "string" && HEX_COLOR.test(c))) return "a paint does not fit its range";
    } else if (p.kind !== "all") {
      return "a pattern is not known";
    }
    const slots = p.kind === "every" ? p.n : 1;
    if (!Array.isArray(r.slots) || r.slots.length !== slots) return "a range has the wrong number of slots";
    const current = currentRange(opts.current ?? [], name, r.start);
    for (const [k, s] of r.slots.entries()) {
      const reason = slotReason(s, effectCount, current?.slots[k]?.fx);
      if (reason) return reason;
    }
  }
  if (at !== strand.len) return at < strand.len ? "ranges leave a gap" : "ranges run past the strand";
  return null;
}

type Body = Omit<SegPatch, "id">;

/** What a write changes, before IDs are given out. */
type Plan = { creates: Body[]; removed: number[]; patches: SegPatch[]; paint: LayoutWrite["paint"] };

const segOn = (slot: SlotView, next: StrandPatch): boolean => slot.on && next.on !== false;
const tagOf = (r: RangeView, k: number): "" | "paint" | { k: number; n: number } =>
  r.pattern.kind === "every" ? { k: k + 1, n: r.pattern.n } : r.pattern.kind === "individual" ? "paint" : "";
/** The slot's three colors; a color the slot leaves out is black, as on a new segment. */
const colorsOf = (slot: SlotView): number[][] => [0, 1, 2].map((j) => [...(slot.col[j] ?? [0, 0, 0])]);
/** Equal when every color's RGB part is equal; the white channel of an RGBW read-back is not compared. */
const sameColors = (a: number[][], b: number[][]): boolean => a.every((c, k) => [0, 1, 2].every((j) => c[j] === b[k]?.[j]));
const samePaint = (a: string[] | undefined, b: string[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((c, k) => c.toUpperCase() === b[k]!.toUpperCase());

/** The fields of `seg` that differ from the slot, power and brightness it should have. */
function diff(seg: WledSeg, slot: SlotView | undefined, on: boolean | undefined, bri: number | undefined): Body {
  const out: Body = {};
  if (slot) {
    const col = colorsOf(slot);
    if (!sameColors(col, seg.col)) out.col = col;
    for (const k of SLOT_NUMBERS) if (slot[k] !== seg[k]) out[k] = slot[k];
    for (const k of SLOT_FLAGS) if (slot[k] !== seg[k]) out[k] = slot[k];
  }
  if (on !== undefined && on !== seg.on) out.on = on;
  if (bri !== undefined && bri !== seg.bri) {
    out.bri = bri;
    // A segment `bri` also sets the segment's power (`json.cpp:194-197`), so `on` goes with it.
    out.on = on ?? seg.on;
  }
  return out;
}

/** The new segment bodies of a range (spec §6.2 geometry table), in slot order. */
function bodies(strand: Strand, r: RangeView, next: StrandPatch, bri: number): Body[] {
  const start = strand.start + r.start;
  const stop = start + r.len;
  const name = r.name.trim();
  const p = r.pattern;
  return r.slots.map((slot, k) => {
    const col = colorsOf(slot);
    const geometry = p.kind === "every" ? { start: start + k * p.group, grp: p.group, spc: (p.n - 1) * p.group } : { start, grp: 1, spc: 0 };
    return {
      ...geometry,
      stop,
      of: 0,
      rev: false,
      mi: false,
      frz: p.kind === "individual",
      n: segmentName(name, tagOf(r, k)),
      on: segOn(slot, next),
      bri,
      col,
      fx: slot.fx,
      sx: slot.sx,
      ix: slot.ix,
      c1: slot.c1,
      c2: slot.c2,
      c3: slot.c3,
      o1: slot.o1,
      o2: slot.o2,
      o3: slot.o3,
      pal: slot.pal,
    };
  });
}

const paintEntry = (strand: Strand, r: RangeView): LayoutWrite["paint"][number] => ({ name: segmentName(r.name.trim(), "paint"), start: strand.start + r.start, i: encodePaint(r.paint!) });

function plan(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap, opts: { sharedNames?: boolean }): Plan {
  const read = readStrand(state, strand, lists, paint);
  const segs = new Map(state.seg.map((s) => [s.id, s]));
  const seg = (id: number): WledSeg => segs.get(id)!;
  const ranges = next.ranges;

  if (ranges) {
    const reason = validateRanges(strand, ranges, lists.effects.length, { ...opts, current: read.view.ranges });
    if (reason) throw new LayoutError("invalid_layout", reason);
  }

  if (read.crossing.length > 0) {
    const r = ranges?.[0];
    const same = r !== undefined && r.pattern.kind === "all" && r.start === 0 && r.len === strand.len && r.name.trim() === read.view.ranges[0]!.name;
    if (ranges && (ranges.length !== 1 || !same)) {
      throw new LayoutError("shared", messages.shared(strand.name));
    }
    const slot = r?.slots[0];
    const on = slot ? segOn(slot, next) : next.on;
    const patches = [...read.crossing, ...read.inside]
    .sort((a, b) => a - b)
    .map((id) => ({ id, ...diff(seg(id), slot, on, next.bri) }))
    .filter((p) => Object.keys(p).length > 1);
    return { creates: [], removed: [], patches, paint: [] };
  }

  if (!ranges) {
    if (next.on === undefined && next.bri === undefined) return { creates: [], removed: [], patches: [], paint: [] };
    // A segment `bri` also sets the segment's power (`json.cpp:194-197`), so `on` goes with it.
    const patches = read.inside.map((id) => ({ id, on: next.on ?? seg(id).on, ...(next.bri !== undefined ? { bri: next.bri } : {}) }));
    const painted = next.on === true ? read.view.ranges.flatMap((r, k) => (r.paint ? [{ name: seg(read.segIds[k]![0]!).n ?? segmentName(r.name, "paint"), start: strand.start + r.start, i: encodePaint(r.paint) }] : [])) : [];
    return { creates: [], removed: [], patches, paint: painted };
  }

  const bri = next.bri ?? read.view.bri;
  const kept = new Set<number>();
  const creates: Body[] = [];
  const patches: SegPatch[] = [];
  const painted: LayoutWrite["paint"] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const k = read.view.normalize ? -1 : read.view.ranges.findIndex((c) => c.start === r.start && c.len === r.len && samePattern(c.pattern, r.pattern));
    const ids = k >= 0 ? read.segIds[k]! : [];
    if (ids.length === 0) {
      creates.push(...bodies(strand, r, next, bri));
      if (r.pattern.kind === "individual") painted.push(paintEntry(strand, r));
      continue;
    }
    let renamed = false;
    ids.forEach((id, j) => {
      kept.add(id);
      const slot = r.slots[j]!;
      const p: SegPatch = { id, ...diff(seg(id), slot, segOn(slot, next), next.bri) };
      const n = segmentName(r.name.trim(), tagOf(r, j));
      if (seg(id).n !== n) {
        p.n = n;
        renamed = true;
      }
      if (Object.keys(p).length > 1) patches.push(p);
    });
    // The paint memory is keyed by segment start and name, so a renamed paint is sent again under its new name.
    if (r.pattern.kind === "individual" && (renamed || !samePaint(r.paint, read.view.ranges[k]!.paint))) painted.push(paintEntry(strand, r));
  }
  return { creates, removed: read.inside.filter((id) => !kept.has(id)), patches, paint: painted };
}

/**
 * Segments a write adds to the device: creates minus removes. It checks `next`
 * as `writeStrand` does, so it throws `LayoutError` ("invalid_layout" or "shared") on a layout `writeStrand` refuses.
 */
export function segmentsNeeded(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap, opts: { sharedNames?: boolean } = {}): number {
  const p = plan(state, strand, next, lists, paint, opts);
  return p.creates.length - p.removed.length;
}

/**
 * The requests of a write. New segments take the removed IDs first (as overwrites), then the unlisted IDs
 * below the highest listed one, then the IDs above it. Deletes go first, split so the firmware never
 * purges and renumbers (`json.cpp:488`); everything else goes in the last request.
 */
function requestsFor(state: WledState, removedIds: number[], creates: Body[], patches: SegPatch[]): SegPatch[][] {
  const listed = new Set(state.seg.map((s) => s.id));
  const maxListed = Math.max(-1, ...listed);
  const removed = [...removedIds].sort((a, b) => a - b);
  const pool = [...removed];
  for (let id = 0; id < maxListed && pool.length < creates.length; id++) if (!listed.has(id)) pool.push(id);
  for (let id = maxListed + 1; pool.length < creates.length; id++) pool.push(id);
  const assigned = creates.map((body, k) => ({ id: pool[k]!, ...body }));
  const deletes = removed.slice(creates.length).map((id) => ({ id, stop: 0 }));

  // The firmware purges when a request deletes at least half of a vector of more than 3 slots, and
  // the vector has at least `sizeMin` slots. (With `sizeMin` ≤ 3 a purge can only drop empty slots after the last segment.)
  const sizeMin = Math.max(maxListed, ...assigned.map((a) => a.id)) + 1;
  const perRequest = sizeMin > 3 ? Math.floor(sizeMin / 2) - 1 : Infinity;
  const last = [...assigned, ...patches].sort((a, b) => a.id - b.id);
  const requests: SegPatch[][] = [];
  for (let k = 0; k < deletes.length; k += perRequest) requests.push(deletes.slice(k, k + perRequest));
  if (requests.length > 0) requests[requests.length - 1]!.push(...last);
  else if (last.length > 0) requests.push(last);
  return requests;
}

/**
 * The requests that give `strand` the content `next`; see `requestsFor` for their order.
 */
export function writeStrand(
  state: WledState,
  strand: Strand,
  next: StrandPatch,
  lists: Lists,
  paint: PaintMap,
  maxseg: number,
  opts: { sharedNames?: boolean } = {},
): LayoutWrite {
  const p = plan(state, strand, next, lists, paint, opts);
  const need = p.creates.length - p.removed.length;
  const free = maxseg - state.seg.length;
  if (need > free) throw new LayoutError("segment_budget", messages.segmentBudget(need, free), { need });

  return { seg: requestsFor(state, p.removed, p.creates, p.patches), paint: p.paint };
}

const overlapsSpan = (s: { start: number; stop: number }, o: { start: number; len: number }): boolean => s.start < o.start + o.len && o.start < s.stop;
const SLOT_KEYS = ["on", "bri", "col", "fx", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "pal"] as const;

/**
 * Gives each of `touched` (strands that share a segment, in LED order) a segment of its own, in one request.
 * The first crossing segment becomes the first strand's All range "Range 1"; every other strand gets a new
 * segment with the same slot; every other segment on these strands is deleted.
 */
export function splitShared(state: WledState, touched: Strand[], maxseg: number): LayoutWrite {
  const near = state.seg.filter((s) => s.n !== FLASH_NAME && touched.some((t) => overlapsSpan(s, t)));
  const inside = (s: WledSeg): boolean => touched.some((t) => s.start >= t.start && s.stop <= t.start + t.len);
  const first = near.filter((s) => !inside(s)).sort((a, b) => a.id - b.id)[0] ?? near[0]!;
  const removed = near.filter((s) => s.id !== first.id).map((s) => s.id);
  const slot = Object.fromEntries(SLOT_KEYS.map((k) => [k, first[k]]));
  const bodyOf = (t: Strand): Body => ({ ...slot, start: t.start, stop: t.start + t.len, grp: 1, spc: 0, of: 0, rev: false, mi: false, frz: false, n: "Range 1" });
  const creates = touched.slice(1).map(bodyOf);
  const need = creates.length - removed.length;
  const free = maxseg - state.seg.length;
  if (need > free) throw new LayoutError("segment_budget", messages.segmentBudget(need, free), { need });
  return { seg: requestsFor(state, removed, creates, [{ id: first.id, ...bodyOf(touched[0]!) }]), paint: [] };
}

/**
 * Cuts `ranges` at `cuts` (offsets in the strand). Each piece keeps the name, pattern and slots;
 * paint is cut by position. A piece too short for its Every pattern becomes All with its first slot, as `fitRanges` does.
 */
export function cutRanges(ranges: RangeView[], cuts: number[]): RangeView[] {
  return ranges.flatMap((r) => {
    const edges = [r.start, ...cuts.filter((c) => c > r.start && c < r.start + r.len).sort((a, b) => a - b), r.start + r.len];
    return edges.slice(1).map((end, k): RangeView => {
      const from = edges[k]!;
      const len = end - from;
      if (len === r.len) return r;
      const piece = { ...r, start: from, len, ...(r.paint ? { paint: r.paint.slice(from - r.start, end - r.start) } : {}) };
      const every = r.pattern.kind === "every" ? r.pattern : undefined;
      return every && (every.n - 1) * every.group >= len ? { ...piece, pattern: { kind: "all" }, slots: [r.slots[0]!] } : piece;
    });
  });
}
