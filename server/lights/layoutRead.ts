import { cutBytes, HEX_COLOR, MAX_EVERY, NAME_BYTES, NAME_CHARS, PAINT_TAG, segmentName } from "../../shared/segmentName";
import type { LightsView, Pattern, RangeView, SlotView, StrandView, WledConfig } from "../../shared/apiTypes";

/**
 * Reads a device's WLED segments back as strands, ranges and patterns
 * (spec §6.2 "Reading a layout back"). Pure functions; the device's replies
 * are untrusted, so `parseState` and `decodePaint` check them first.
 */

export type WledSeg = {
  id: number;
  start: number;
  stop: number;
  grp: number;
  spc: number;
  of: number;
  on: boolean;
  frz: boolean;
  bri: number;
  col: number[][];
  fx: number;
  sx: number;
  ix: number;
  c1: number;
  c2: number;
  c3: number;
  o1: boolean;
  o2: boolean;
  o3: boolean;
  pal: number;
  n?: string;
};

export type WledState = { on: boolean; bri: number; seg: WledSeg[] };

export type Strand = { key: string; name: string; pins: number[]; start: number; len: number; members: string[] };

/**
 * Segment key → one "#RRGGBB" per LED. The key is the segment's first LED and name (`paintKey`),
 * as two strands may each have a painted range of the same name.
 */
export type PaintMap = Record<string, string[]>;

export const paintKey = (start: number, name: string): string => `${start}:${name}`;

export type Lists = { effects: string[]; palettes: string[] };

export const FLASH_NAME = "Strand flash";
export { PAINT_TAG, segmentName };

type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const intIn = (v: unknown, min: number, max: number, dflt: number): number => (isInt(v) && v >= min && v <= max ? v : dflt);
const bool = (v: unknown): boolean => (typeof v === "boolean" ? v : false);
export const isColor = (v: unknown): v is number[] => Array.isArray(v) && (v.length === 3 || v.length === 4) && v.every((c) => intIn(c, 0, 255, -1) >= 0);
const hex = (rgb: number[]): string => `#${rgb.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** The longest prefix of `s` with at most `max` UTF-16 units, cut between code points. */
function cutChars(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

function parseSeg(raw: unknown): WledSeg | null {
  if (!isObject(raw)) return null;
  const { id, start, stop } = raw;
  if (!isInt(id) || !isInt(start) || !isInt(stop)) return null;
  if (id < 0 || id > 255 || start < 0 || start >= stop || stop > 65535) return null;
  const col = Array.isArray(raw.col) ? raw.col : [];
  const seg: WledSeg = {
    id,
    start,
    stop,
    grp: intIn(raw.grp, 1, 255, 1),
    spc: intIn(raw.spc, 0, 255, 0),
    of: intIn(raw.of, 0, 65535, 0),
    on: bool(raw.on),
    frz: bool(raw.frz),
    bri: intIn(raw.bri, 0, 255, 0),
    col: [0, 1, 2].map((k) => {
      const c: unknown = col[k];
      return isColor(c) ? [...c] : [0, 0, 0];
    }),
    fx: intIn(raw.fx, 0, 255, 0),
    sx: intIn(raw.sx, 0, 255, 0),
    ix: intIn(raw.ix, 0, 255, 0),
    c1: intIn(raw.c1, 0, 255, 0),
    c2: intIn(raw.c2, 0, 255, 0),
    c3: intIn(raw.c3, 0, 31, 16),
    o1: bool(raw.o1),
    o2: bool(raw.o2),
    o3: bool(raw.o3),
    pal: intIn(raw.pal, 0, 255, 0),
  };
  if (typeof raw.n === "string") seg.n = cutBytes(raw.n, NAME_BYTES);
  return seg;
}

/** Checks the device's `/json/state` reply before any other code uses it. */
export function parseState(raw: unknown): WledState {
  const state = isObject(raw) ? raw : {};
  const seg = Array.isArray(state.seg) ? state.seg : [];
  return {
    on: bool(state.on),
    bri: intIn(state.bri, 0, 255, 0),
    seg: seg.map(parseSeg).filter((s): s is WledSeg => s !== null),
  };
}

/** One strand per LED output, with valid groups combined; invalid groups go to `dropped`. */
export function strandsFromConfig(cfg: WledConfig, groupKeys: string[], names: Record<string, string>): { strands: Strand[]; dropped: string[] } {
  const singles: Strand[] = cfg.hw.led.ins.map((out, i) => {
    const key = `o${i}`;
    return { key, name: names[key] || `Strand ${i + 1}`, pins: [...out.pin], start: out.start, len: out.len, members: [key] };
  });
  const byKey = new Map(singles.map((s) => [s.key, s]));
  const grouped = new Set<string>();
  const groups: Strand[] = [];
  const dropped: string[] = [];
  for (const key of groupKeys) {
    const members = key.split("+").map((k) => byKey.get(k));
    const valid =
      members.length >= 2 &&
      members.every((m, i): boolean => m !== undefined && !grouped.has(m.key) && (i === 0 || members[i - 1]!.start + members[i - 1]!.len === m.start));
    if (!valid) {
      dropped.push(key);
      continue;
    }
    const parts = members as Strand[];
    for (const m of parts) grouped.add(m.key);
    groups.push({
      key,
      name: names[key] || parts.map((m) => m.name).join(" + "),
      pins: parts.flatMap((m) => m.pins),
      start: parts[0]!.start,
      len: parts.reduce((sum, m) => sum + m.len, 0),
      members: parts.map((m) => m.key),
    });
  }
  const strands = [...singles.filter((s) => !grouped.has(s.key)), ...groups].sort((a, b) => a.start - b.start);
  return { strands, dropped };
}

/** One `seg.i` color (6 hex digits, or 3-4 integers 0-255) as "#RRGGBB"; anything else is null. */
function paintColor(item: unknown): string | null {
  if (typeof item === "string") return /^[0-9A-Fa-f]{6}$/.test(item) ? `#${item.toUpperCase()}` : null;
  return isColor(item) ? hex(item) : null;
}

/**
 * The LED colors a `seg.i` array sets (`json.cpp:314-358`): integers set a
 * start and a stop, and a color fills `[start, stop)` or the one LED at the
 * start. Indices are clamped to the segment; a malformed color paints nothing.
 */
export function decodePaint(i: unknown[], len: number): string[] {
  const out = Array<string>(len).fill("#000000");
  let iStart = 0;
  let iStop = 0;
  let iSet = 0;
  for (const item of i) {
    if (isInt(item)) {
      const index = Math.min(Math.max(item, 0), len);
      if (iSet === 0) iStart = index;
      else iStop = index;
      iSet++;
      continue;
    }
    if (iSet < 2 || iStop <= iStart) iStop = iStart + 1;
    const color = paintColor(item);
    if (color !== null) {
      for (let k = iStart; k < Math.min(iStop, len); k++) out[k] = color;
    }
    iStart = iStop;
    iSet = 0;
  }
  return out;
}

/** The `seg.i` body for a paint: each run of one color as `start, stop, "RRGGBB"`. */
export function encodePaint(paint: string[]): (number | string)[] {
  const out: (number | string)[] = [];
  let start = 0;
  for (let k = 1; k <= paint.length; k++) {
    if (k < paint.length && paint[k]!.toUpperCase() === paint[start]!.toUpperCase()) continue;
    out.push(start, k, paint[start]!.slice(1).toUpperCase());
    start = k;
  }
  return out;
}

function slotOf(seg: WledSeg, lists: Lists): SlotView {
  return {
    on: seg.on,
    col: seg.col.map((c) => [...c]),
    fx: seg.fx,
    fxName: lists.effects[seg.fx] ?? "",
    sx: seg.sx,
    ix: seg.ix,
    c1: seg.c1,
    c2: seg.c2,
    c3: seg.c3,
    o1: seg.o1,
    o2: seg.o2,
    o3: seg.o3,
    pal: seg.pal,
    palName: lists.palettes[seg.pal] ?? "",
  };
}

function offSlot(lists: Lists): SlotView {
  return {
    on: false,
    col: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    fx: 0,
    fxName: lists.effects[0] ?? "",
    sx: 128,
    ix: 128,
    c1: 128,
    c2: 128,
    c3: 16,
    o1: false,
    o2: false,
    o3: false,
    pal: 0,
    palName: lists.palettes[0] ?? "",
  };
}

/** A range read from segments, before names and positions are final. `segs` are in slot order. */
type Candidate = { name?: string; start: number; stop: number; pattern: Pattern; segs: WledSeg[]; paint?: string[]; normalize: boolean };

/** A name read from the device; blank reads as no name. */
const nameOf = (n: string | undefined): string | undefined => (n === undefined || n.trim() === "" ? undefined : n.trim());

const byId = (a: WledSeg, b: WledSeg): number => a.id - b.id;
const overlaps = (a: { start: number; stop: number }, b: { start: number; stop: number }): boolean => a.start < b.stop && b.start < a.stop;

/** Every N geometry: slot k starts `(k − 1)·G` after slot 1, all share `stop` and `grp`, and `spc = (N − 1)·G`. */
function isEvery(segs: WledSeg[]): boolean {
  const first = segs[0]!;
  const g = first.grp;
  return segs.every((s, k) => s.stop === first.stop && s.grp === g && s.spc === (segs.length - 1) * g && s.start === first.start + k * g);
}

function everyRange(name: string | undefined, segs: WledSeg[]): Candidate {
  return {
    name,
    start: segs[0]!.start,
    stop: segs[0]!.stop,
    pattern: { kind: "every", n: segs.length, group: segs[0]!.grp },
    segs,
    normalize: segs.some((s) => s.of !== 0),
  };
}

/** Steps 4-7: tag groups, paint, geometry groups, then All. */
function candidates(inside: WledSeg[], paint: PaintMap): Candidate[] {
  const out: Candidate[] = [];
  const used = new Set<number>();

  const tagged = new Map<string, { base: string; n: number; members: { k: number; seg: WledSeg }[] }>();
  for (const seg of inside) {
    const m = /^(.*) (\d+)\/(\d+)$/.exec(seg.n ?? "");
    if (!m) continue;
    const [, base, k, n] = m as unknown as [string, string, string, string];
    const key = `${n}/${base}`;
    const group = tagged.get(key) ?? { base, n: Number(n), members: [] };
    group.members.push({ k: Number(k), seg });
    tagged.set(key, group);
  }
  for (const { base, n, members } of tagged.values()) {
    if (n < 2 || n > MAX_EVERY || members.length !== n) continue;
    const segs = [...members].sort((a, b) => a.k - b.k);
    if (!segs.every((m, i) => m.k === i + 1) || !isEvery(segs.map((m) => m.seg))) continue;
    for (const m of segs) used.add(m.seg.id);
    out.push(everyRange(nameOf(base), segs.map((m) => m.seg)));
  }

  for (const seg of inside) {
    const base = seg.n?.endsWith(PAINT_TAG) ? seg.n.slice(0, -PAINT_TAG.length) : undefined;
    if (used.has(seg.id) || base === undefined || !seg.frz || seg.grp !== 1 || seg.spc !== 0) continue;
    used.add(seg.id);
    const len = seg.stop - seg.start;
    const known = paint[paintKey(seg.start, seg.n!)];
    const colors = Array.isArray(known) && known.length === len && known.every((c) => HEX_COLOR.test(c)) ? known.map((c) => c.toUpperCase()) : Array<string>(len).fill(hex(seg.col[0]!));
    out.push({ name: nameOf(base), start: seg.start, stop: seg.stop, pattern: { kind: "individual" }, segs: [seg], paint: colors, normalize: seg.of !== 0 });
  }

  const buckets = new Map<string, WledSeg[]>();
  for (const seg of inside) {
    if (used.has(seg.id) || seg.spc === 0 || seg.spc % seg.grp !== 0 || seg.spc / seg.grp + 1 > MAX_EVERY) continue;
    const key = `${seg.stop}:${seg.grp}:${seg.spc}`;
    buckets.set(key, [...(buckets.get(key) ?? []), seg]);
  }
  for (const bucket of buckets.values()) {
    const sorted = bucket.sort((a, b) => a.start - b.start || a.id - b.id);
    const n = sorted[0]!.spc / sorted[0]!.grp + 1;
    let i = 0;
    while (i + n <= sorted.length) {
      const segs = sorted.slice(i, i + n);
      if (!isEvery(segs)) {
        i++;
        continue;
      }
      for (const s of segs) used.add(s.id);
      out.push(everyRange(nameOf(segs[0]!.n), segs));
      i += n;
    }
  }

  for (const seg of inside) {
    if (used.has(seg.id)) continue;
    out.push({
      name: nameOf(seg.n),
      start: seg.start,
      stop: seg.stop,
      pattern: { kind: "all" },
      segs: [seg],
      normalize: seg.grp !== 1 || seg.spc !== 0 || seg.of !== 0,
    });
  }
  return out;
}

/**
 * Step 11: a name already used by an earlier range gets the first free " 2", " 3" suffix; every name fits 64 characters.
 * Names are compared as the device keeps them (cut to `NAME_BYTES`), and a suffixed name fits `NAME_BYTES`, so the names stay unique when written.
 */
function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let out = cutChars(name, NAME_CHARS);
    for (let k = 2; taken.has(cutBytes(out, NAME_BYTES)); k++) out = cutBytes(name, NAME_BYTES - ` ${k}`.length) + ` ${k}`;
    taken.add(cutBytes(out, NAME_BYTES));
    return out;
  });
}

/** Steps 12: the strand's power is on when any segment is on; its brightness is its lowest-start segment's, 1-255. */
function strandPower(segs: WledSeg[]): { on: boolean; bri: number } {
  const first = [...segs].sort((a, b) => a.start - b.start || a.id - b.id)[0];
  return { on: segs.some((s) => s.on), bri: first && first.bri > 0 ? first.bri : 255 };
}

/**
 * One strand's view. `segIds[r][k]` is the segment ID of slot k of range r
 * (empty for a gap). `inside` and `crossing` are segment IDs. A shared strand's
 * `shared.with` is empty here; `readLayout` fills it, as it knows the other strands.
 */
export function readStrand(
  state: WledState,
  strand: Strand,
  lists: Lists,
  paint: PaintMap,
): { view: StrandView; segIds: number[][]; inside: number[]; crossing: number[] } {
  const end = strand.start + strand.len;
  const span = { start: strand.start, stop: end };
  const near = state.seg.filter((s) => s.n !== FLASH_NAME && overlaps(s, span)).sort(byId);
  const inside = near.filter((s) => s.start >= strand.start && s.stop <= end);
  const crossing = near.filter((s) => !inside.includes(s));
  const head = { key: strand.key, name: strand.name, pins: [...strand.pins], start: strand.start, len: strand.len, ...strandPower(near) };

  if (crossing.length > 0) {
    const seg = crossing[0]!;
    return {
      view: {
        ...head,
        ranges: [{ name: "Range 1", start: 0, len: strand.len, pattern: { kind: "all" }, slots: [slotOf(seg, lists)] }],
        normalize: false,
        shared: { with: [] },
      },
      segIds: [[seg.id]],
      inside: inside.map((s) => s.id),
      crossing: crossing.map((s) => s.id),
    };
  }

  let normalize = false;
  const accepted: Candidate[] = [];
  const order = (c: Candidate): number => Math.min(...c.segs.map((s) => s.id));
  for (const c of candidates(inside, paint).sort((a, b) => order(a) - order(b))) {
    if (accepted.some((a) => overlaps(a, c))) {
      normalize = true;
      continue;
    }
    accepted.push(c);
    normalize ||= c.normalize;
  }

  accepted.sort((a, b) => a.start - b.start);
  const ranges: Candidate[] = [];
  let at = strand.start;
  for (const c of [...accepted, { start: end, stop: end } as Candidate]) {
    if (c.start > at) {
      ranges.push({ start: at, stop: c.start, pattern: { kind: "all" }, segs: [], normalize: true });
      normalize = true;
    }
    if (c.stop > c.start) ranges.push(c);
    at = c.stop;
  }

  const names = uniqueNames(ranges.map((c, k) => c.name ?? `Range ${k + 1}`));
  const views: RangeView[] = ranges.map((c, k) => ({
    name: names[k]!,
    start: c.start - strand.start,
    len: c.stop - c.start,
    pattern: c.pattern,
    slots: c.segs.length > 0 ? c.segs.map((s) => slotOf(s, lists)) : [offSlot(lists)],
    ...(c.paint ? { paint: c.paint } : {}),
  }));

  return {
    view: { ...head, ranges: views, normalize },
    segIds: ranges.map((c) => c.segs.map((s) => s.id)),
    inside: inside.map((s) => s.id),
    crossing: [],
  };
}

/** The Lights view of every strand, without the notices and the 2D flag, which come from elsewhere. */
export function readLayout(state: WledState, strands: Strand[], lists: Lists, paint: PaintMap, maxseg: number): Omit<LightsView, "notices" | "matrix"> {
  const views = strands.map((strand) => {
    const read = readStrand(state, strand, lists, paint);
    if (!read.view.shared) return read.view;
    const crossing = state.seg.filter((s) => read.crossing.includes(s.id));
    const others = strands.filter((o) => o.key !== strand.key && crossing.some((s) => overlaps(s, { start: o.start, stop: o.start + o.len })));
    return { ...read.view, shared: { with: others.map((o) => o.key) } };
  });
  return { on: state.on, bri: state.bri, strands: views, segments: { used: state.seg.length, max: maxseg } };
}
