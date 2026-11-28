/**
 * A pure model of how WLED firmware (17.0.0-dev, `~/Code/WLED/wled00`) applies a
 * JSON state POST to its segments and presets. The fake device and the
 * property tests share it. Line references are to that source.
 */

export type SimSeg = {
  start: number;
  stop: number;
  grp: number;
  spc: number;
  of: number;
  on: boolean;
  frz: boolean;
  /** The segment's opacity. */
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
  sel: boolean;
  rev: boolean;
  mi: boolean;
  n?: string;
  /** Raw pixels relative to `start`, as "#RRGGBB"; `null` is black that `i` did not set. */
  pixels: (string | null)[];
};

/** `slots` is the firmware's segment vector. A slot is empty when it is `null` or its `stop` is 0. */
export type SimState = {
  on: boolean;
  /** The last brightness above 0, which the state reports even while off (`json.cpp:616`). */
  bri: number;
  mainseg: number;
  slots: (SimSeg | null)[];
  maxseg: number;
  ledCount: number;
  presets: Record<string, unknown>;
  bootps: number;
};

type Json = Record<string, unknown>;

// FX.h:45
const DEFAULT_COLOR = [255, 160, 0];
// const.h:175-184: 32 on ESP8266 (64 on ESP32); the stricter limit.
const NAME_MAX_BYTES = 32;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const byte = (v: number): number => v & 0xff;
const clone = <T>(v: T): T => structuredClone(v);
const hex2 = (v: number): string => v.toString(16).padStart(2, "0").toUpperCase();
const black = (): number[] => [0, 0, 0];
const blankPixels = (seg: SimSeg): (string | null)[] => new Array<string | null>(Math.max(0, seg.stop - seg.start)).fill(null);
const active = (seg: SimSeg | null | undefined): seg is SimSeg => !!seg && seg.stop > seg.start;

/** `getBoolVal` (util.cpp:105): a boolean, or a string starting with "t" toggles. */
const boolVal = (v: unknown, dflt: boolean): boolean => {
  if (typeof v === "string" && v[0] === "t") return !dflt;
  return typeof v === "boolean" ? v : dflt;
};

/** `getVal` for an integer (util.cpp:85): negatives are ignored, the rest wraps to a byte. */
const byteVal = (v: unknown, dflt: number): number => (isInt(v) && v >= 0 ? byte(v) : dflt);

/** ArduinoJson's `v | dflt` for a byte: an integer that fits, else the default. */
const byteOr = (v: unknown, dflt: number): number => (isInt(v) && v >= 0 && v <= 255 ? v : dflt);

/** `colorFromHexString` (colors.cpp:564): 6 or 8 hex digits, no "#". */
function fromHex(s: string): number[] | null {
  if (s.length !== 6 && s.length !== 8) return null;
  const c = Number.parseInt(s, 16) || 0;
  return s.length === 6 ? [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff] : [(c >>> 24) & 0xff, (c >> 16) & 0xff, (c >> 8) & 0xff];
}

/** The `Segment` constructor (FX.h:587-608). */
function newSeg(start: number, stop: number): SimSeg {
  const seg: SimSeg = {
    start,
    stop,
    grp: 1,
    spc: 0,
    of: 0,
    on: true,
    frz: false,
    bri: 255,
    col: [black(), black(), black()],
    fx: 0,
    sx: 128,
    ix: 128,
    c1: 128,
    c2: 128,
    c3: 16,
    o1: false,
    o2: false,
    o3: false,
    pal: 0,
    sel: true,
    rev: false,
    mi: false,
    pixels: [],
  };
  seg.pixels = blankPixels(seg);
  return seg;
}

function setName(seg: SimSeg, name: unknown): void {
  const bytes = new TextEncoder().encode(typeof name === "string" ? name : "");
  if (bytes.length === 0) delete seg.n;
  else seg.n = new TextDecoder().decode(bytes.slice(0, NAME_MAX_BYTES));
}

/** `WS2812FX::setMainSegmentId` (FX_fcn.cpp:2023): the ID if active, else the last active segment. */
function setMainSeg(sim: SimState, n: number): void {
  let last = 0;
  for (let i = sim.slots.length - 1; i > 0; i--) {
    if (active(sim.slots[i])) {
      last = i;
      break;
    }
  }
  sim.mainseg = n < sim.slots.length && active(sim.slots[n]) ? n : last;
}

/** `Segment::setGeometry` for a 1D strip (FX_fcn.cpp:552-640). Returns whether anything changed. */
function setGeometry(sim: SimState, seg: SimSeg, i1: number, i2: number, grp: number, spc: number, of: number): boolean {
  if (i2 <= i1) i2 = 0;
  if (i1 >= sim.ledCount) i1 = seg.start;
  if (i2 > sim.ledCount) i2 = sim.ledCount;
  if (grp === 0) {
    grp = 1;
    spc = 0;
  }
  if (i1 >= i2) i2 = 0;
  if (seg.start === i1 && seg.stop === i2 && seg.grp === grp && seg.spc === spc && seg.of === of) return false;
  const oldLength = seg.stop - seg.start;
  Object.assign(seg, { start: i1, stop: i2, grp, spc, of });
  if (i2 - i1 > 0 && i2 - i1 !== oldLength) seg.pixels = blankPixels(seg);
  return true;
}

/** One `col` entry (json.cpp:228-266): an int array or a hex string. Kelvin, "r" and objects are not modelled. */
function colorOf(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.length === 0 ? null : [0, 1, 2].map((k) => (isInt(v[k]) ? byte(v[k]) : 0));
  if (typeof v === "string") return fromHex(v);
  return null;
}

/** `seg.i` (json.cpp:314-361): paints raw pixels relative to the segment start, no grouping or spacing. */
function paint(seg: SimSeg, items: unknown[]): void {
  if (!seg.frz) {
    seg.frz = true;
    seg.pixels = blankPixels(seg);
  }
  let iStart = 0;
  let iStop = 0;
  let iSet = 0;
  for (const item of items) {
    if (isInt(item)) {
      if (!iSet) iStart = Math.abs(item);
      else iStop = Math.abs(item);
      iSet++;
      continue;
    }
    let rgb = [0, 0, 0];
    if (Array.isArray(item)) {
      if (item.length > 0 && item.length < 5) rgb = [0, 1, 2].map((k) => (isInt(item[k]) ? byte(item[k]) : 0));
    } else if (typeof item === "string") {
      rgb = fromHex(item) ?? rgb;
    }
    if (iSet < 2 || iStop <= iStart) iStop = iStart + 1;
    const color = `#${rgb.map(hex2).join("")}`;
    while (iStart < iStop) {
      if (iStart < seg.pixels.length) seg.pixels[iStart] = color;
      iStart++;
    }
    iSet = 0;
  }
}

/** `deserializeSegment` (json.cpp:72-364). Returns its return value. */
function applySeg(sim: SimState, elem: Json, it: number, presetId: number): boolean {
  let id = byteOr(elem.id, it);
  if (id >= sim.maxseg) return false;
  let stop = isInt(elem.stop) ? elem.stop : -1;

  let isNew = false;
  if (id >= sim.slots.length) {
    if (stop <= 0) return false;
    sim.slots.push(newSeg(0, sim.ledCount));
    id = sim.slots.length - 1;
    isNew = true;
  }
  const seg = sim.slots[id] ?? newSeg(0, 0);
  sim.slots[id] = seg;
  if (isNew && presetId === 0) seg.col[0] = [...DEFAULT_COLOR];

  const start = isInt(elem.start) ? elem.start & 0xffff : seg.start;
  if (stop < 0) {
    const len = isInt(elem.len) ? elem.len : 0;
    stop = len > 0 ? start + len : seg.stop;
  }
  stop &= 0xffff;

  if (elem.n !== undefined && elem.n !== null) setName(seg, elem.n);
  else if (start !== seg.start || stop !== seg.stop) delete seg.n;

  const grp = byte(isInt(elem.grp) ? elem.grp : seg.grp);
  const spc = byte(isInt(elem.spc) ? elem.spc : seg.spc);
  const sel = boolVal(elem.sel, seg.sel);
  const rev = boolVal(elem.rev, seg.rev);
  const mi = boolVal(elem.mi, seg.mi);

  const len = stop > start ? stop - start : 1;
  let of = seg.of;
  if (isInt(elem.of)) {
    let abs = Math.abs(elem.of);
    if (abs > len - 1) abs %= len;
    of = elem.of < 0 ? len - abs : abs;
  }
  if (stop > start && of > len - 1) of = len - 1;

  const changed = setGeometry(sim, seg, start, stop, grp, spc, of);
  if (changed && seg.stop === 0) {
    if (id === sim.mainseg) setMainSeg(sim, 0);
    return true;
  }

  if (isInt(elem.bri) && elem.bri >= 0) {
    const segbri = byte(elem.bri);
    if (segbri > 0) seg.bri = segbri;
    seg.on = segbri > 0;
  }
  seg.on = boolVal(elem.on, seg.on);
  seg.frz = boolVal(elem.frz, seg.frz);

  if (Array.isArray(elem.col)) {
    elem.col.slice(0, 3).forEach((v, i) => {
      const c = colorOf(v);
      if (c) seg.col[i] = c;
    });
  }

  seg.sel = sel;
  seg.rev = rev;
  seg.mi = mi;
  seg.fx = byteVal(elem.fx, seg.fx);
  seg.sx = byteVal(elem.sx, seg.sx);
  seg.ix = byteVal(elem.ix, seg.ix);
  seg.pal = byteVal(elem.pal, seg.pal);
  seg.c1 = byteVal(elem.c1, seg.c1);
  seg.c2 = byteVal(elem.c2, seg.c2);
  seg.c3 = Math.min(31, byteVal(elem.c3, seg.c3));
  seg.o1 = boolVal(elem.o1, seg.o1);
  seg.o2 = boolVal(elem.o2, seg.o2);
  seg.o3 = boolVal(elem.o3, seg.o3);

  if (Array.isArray(elem.i)) paint(seg, elem.i);
  return true;
}

/** `WS2812FX::purgeSegments` (FX_fcn.cpp:2077): drops empty slots after the first and renumbers. */
function purge(sim: SimState): void {
  if (sim.slots.length <= 1) return;
  const kept = sim.slots.filter((s, i) => i === 0 || (s !== null && s.stop !== 0));
  if (kept.length === sim.slots.length) return;
  sim.slots = kept;
  setMainSeg(sim, 0);
}

/** `savePreset` for an API call (presets.cpp:225-265). */
function savePreset(sim: SimState, index: number, body: Json): void {
  const saved = clone(body);
  if (saved.bootps !== undefined && saved.bootps !== null) {
    sim.bootps = byteOr(saved.bootps, sim.bootps);
    delete saved.bootps;
  }
  if (saved.o === undefined || saved.o === null) {
    // Without "o" the firmware saves the live state instead of the body; Strand always sends "o".
    sim.presets[String(index)] = { n: typeof saved.n === "string" ? saved.n : `Preset ${index}`, ...listState(sim) };
    return;
  }
  for (const key of ["o", "v", "time", "error", "psave"]) delete saved[key];
  if (saved.n === undefined || saved.n === null) saved.n = `Preset ${index}`;
  sim.presets[String(index)] = saved;
}

/** `deserializeState` (json.cpp:370-506), the parts that touch segments and presets. */
function apply(sim: SimState, body: Json, presetId: number): void {
  let live = sim.on ? sim.bri : 0;
  let briLast = sim.bri;
  const onBefore = live > 0;
  const toggle = () => {
    if (live === 0) live = briLast;
    else {
      briLast = live;
      live = 0;
    }
  };
  if (isInt(body.bri) && body.bri >= 0) live = byte(body.bri);
  const on = typeof body.on === "boolean" ? body.on : live > 0;
  if (!on !== !live) toggle();
  if (typeof body.on === "string" && body.on[0] === "t" && (onBefore || !live)) toggle();
  if (live > 0 && !onBefore) sim.slots.forEach((s) => s && (s.frz = false));
  if (live > 0) briLast = live;
  sim.on = live > 0;
  sim.bri = briLast;

  setMainSeg(sim, byteOr(body.mainseg, sim.mainseg));

  const seg = body.seg;
  if (isObject(seg)) {
    const id = isInt(seg.id) ? seg.id : -1;
    if (id < 0) {
      sim.slots.forEach((s, k) => {
        if (active(s) && s.sel) applySeg(sim, seg, k, presetId);
      });
    } else {
      applySeg(sim, seg, id, presetId);
    }
  } else if (Array.isArray(seg)) {
    let deleted = 0;
    seg.forEach((elem, it) => {
      if (!isObject(elem)) return;
      if (applySeg(sim, elem, it, presetId) && elem.stop === 0) deleted++;
    });
    if (sim.slots.length > 3 && deleted >= Math.floor(sim.slots.length / 2)) purge(sim);
  }

  if (isInt(body.psave) && body.psave > 0 && body.psave < 251) savePreset(sim, body.psave, body);
}

export function simFromState(state: { on: boolean; bri: number; seg: object[] }, maxseg: number, ledCount: number): SimState {
  const slots: (SimSeg | null)[] = [];
  state.seg.forEach((raw, k) => {
    const s = raw as Json;
    const id = isInt(s.id) ? s.id : k;
    const seg = newSeg(isInt(s.start) ? s.start : 0, isInt(s.stop) ? s.stop : 0);
    for (const key of ["grp", "spc", "of", "bri", "fx", "sx", "ix", "c1", "c2", "c3", "pal"] as const) {
      if (isInt(s[key])) seg[key] = s[key];
    }
    for (const key of ["on", "frz", "o1", "o2", "o3", "sel", "rev", "mi"] as const) {
      if (typeof s[key] === "boolean") seg[key] = s[key];
    }
    if (Array.isArray(s.col)) seg.col = [0, 1, 2].map((i) => colorOf((s.col as unknown[])[i]) ?? black());
    if (typeof s.n === "string" && s.n !== "") seg.n = s.n;
    while (slots.length < id) slots.push(null);
    slots[id] = seg;
  });
  const mainseg = isInt((state as Json).mainseg) ? ((state as Json).mainseg as number) : 0;
  return { on: state.on, bri: state.bri, mainseg, slots, maxseg, ledCount, presets: {}, bootps: 0 };
}

export function applyPost(sim: SimState, body: Record<string, unknown>): void {
  apply(sim, body, 0);
}

/**
 * A reboot (wled.cpp:683-691): the auto segments (one per output, or one over
 * every LED), power and brightness from `def`, then the boot preset.
 */
export function bootSim(sim: SimState, def: { on: boolean; bri: number }, opts: { outputs?: { start: number; len: number }[] } = {}): void {
  const spans = opts.outputs?.map((o) => [o.start, o.start + o.len] as const) ?? [[0, sim.ledCount] as const];
  sim.slots = spans.map(([start, stop]) => {
    const seg = newSeg(start, stop);
    // FX_fcn.cpp:2165 (auto segments) and wled.cpp:695 (no boot preset) both make it orange.
    seg.col[0] = [...DEFAULT_COLOR];
    return seg;
  });
  sim.mainseg = 0;
  sim.on = def.on && def.bri > 0;
  sim.bri = def.bri;
  const preset = sim.presets[String(sim.bootps)];
  if (sim.bootps > 0 && isObject(preset)) apply(sim, clone(preset), sim.bootps);
}

export function listState(sim: SimState): { on: boolean; bri: number; mainseg: number; seg: object[] } {
  const seg: object[] = [];
  sim.slots.forEach((s, id) => {
    if (!active(s)) return;
    seg.push({
      id,
      start: s.start,
      stop: s.stop,
      len: s.stop - s.start,
      grp: s.grp,
      spc: s.spc,
      of: s.of,
      on: s.on,
      frz: s.frz,
      bri: s.bri || 255,
      col: clone(s.col),
      fx: s.fx,
      sx: s.sx,
      ix: s.ix,
      pal: s.pal,
      c1: s.c1,
      c2: s.c2,
      c3: s.c3,
      sel: s.sel,
      rev: s.rev,
      mi: s.mi,
      o1: s.o1,
      o2: s.o2,
      o3: s.o3,
      ...(s.n !== undefined ? { n: s.n } : {}),
    });
  });
  return { on: sim.on, bri: sim.bri, mainseg: sim.mainseg, seg };
}
