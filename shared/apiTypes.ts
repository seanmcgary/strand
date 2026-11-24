/**
 * The app server's API types, shared by the server and the browser. Names and
 * fields follow the mock app server in `docs/design/strand-wled-spec.html`.
 */

/** A saved device, as `GET /api/devices` returns it. */
export interface Device {
  id: string;
  name: string;
  host: string;
  lastIp: string;
  mac: string;
  online: boolean;
  /** ISO 8601. Null until the server first reaches the device. */
  lastSeen: string | null;
  pinLocked: boolean;
}

/** A device found by discovery or probe. */
export interface DiscoveredDevice {
  mac: string;
  name: string;
  ip: string;
  host: string;
  ver: string;
  ledCount: number;
  arch: string;
  alreadyAdded: boolean;
}

/** The fields of WLED's `/json/info` that the app uses. */
export interface WledInfo {
  ver: string;
  vid: number;
  name: string;
  mac: string;
  ip: string;
  arch: string;
  clock: number;
  flash: number;
  /** Seconds since the device started. */
  uptime: number;
  freeheap: number;
  psram?: number;
  fs: { u: number; t: number };
  wifi: {
    rssi: number;
    signal: number;
    channel: number;
    band: string;
    ap: boolean;
    ssid?: string;
  };
  leds: {
    count: number;
    fps: number;
    pwr: number;
    maxpwr: number;
    maxseg: number;
    /** Present only on a 2D device. */
    matrix?: { w: number; h: number };
  };
  live: boolean;
}

/** A Wi-Fi client entry in `nw.ins`. The device returns `pskl`, never `psk`. */
export interface WifiEntry {
  ssid: string;
  pskl: number;
  /** Write only: the new password. */
  psk?: string;
  ip: number[];
  gw: number[];
  sn: number[];
}

/** The device's own access point. The device returns `pskl`, never `psk`. */
export interface ApConfig {
  ssid: string;
  pskl: number;
  /** Write only: the new password. `""` makes the access point open. */
  psk?: string;
  chan: number;
  hide: boolean;
  behav: number;
}

/** One LED output in `hw.led.ins`. */
export interface LedOutput {
  type: number;
  pin: number[];
  start: number;
  len: number;
  order: number;
  rev: boolean;
  skip: number;
  ledma: number;
}

/** `if.sync`: UDP sync between WLED devices. */
export interface SyncConfig {
  recv: { bri: boolean; col: boolean; fx: boolean; pal: boolean; seg: boolean; sb: boolean; grp: number };
  send: { en: boolean; dir: boolean; btn: boolean; grp: number };
}

/** The subtrees of `/json/cfg` that the app's settings cover. */
export interface WledConfig {
  id: { name: string; mdns: string };
  nw: { ins: WifiEntry[] };
  ap: ApConfig;
  def: { on: boolean; bri: number };
  light: { "scale-bri": number };
  hw: { led: { maxpwr: number; ins: LedOutput[] } };
  if: { sync: SyncConfig };
}

/** The whole `/json/cfg` object, as the device returns it. */
export type WledConfigFull = Record<string, unknown>;

/** Every field optional, at every depth. An array is replaced whole, so it stays complete. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** The body of `PATCH /api/devices/:id/config`. */
export type ConfigPatch = DeepPartial<WledConfig>;

/** What the device's LED hardware supports, from `/settings/s.js?p=2`. */
export interface Capabilities {
  /** `i` type ID, `n` name, `t` pin kinds, `c` capability bits. */
  ledTypes: { i: number; n: string; t: string; c: number }[];
  limits: {
    maxLedsPerOutput: number;
    maxLeds: number;
    maxDigitalOutputs: number;
    maxPwmPins: number;
    ledMemoryBytes: number;
  };
  reservedPins: number[];
  inputOnlyPins: number[];
}

/** One GPIO: `p` number, `c` capability bits, `a` allocated, `n` owner. */
export interface PinInfo {
  p: number;
  c: number;
  a: boolean;
  n?: string;
}

/** A Wi-Fi network from a scan. */
export interface WifiNetwork {
  ssid: string;
  rssi: number;
  channel: number;
  enc: number;
}

/** The body of `PATCH /api/devices/:id/state`: the only live-state write the browser sends. */
export interface StatePatch {
  on?: boolean;
  bri?: number;
}

export interface Effect {
  id: number;
  name: string;
  /** Whether the effect uses a palette. */
  pal: boolean;
  /** Labels for sx, ix, c1, c2, c3; "" hides a slider. */
  sliders: string[];
  /** Labels for o1-o3; "" hides a checkbox. */
  checks: string[];
  /** Labels for col[0..2]; "" hides a color. */
  colors: string[];
}

export interface Palette {
  id: number;
  name: string;
  /** Preview colors as "#RRGGBB"; empty when the palette depends on the slot's colors. */
  stops: string[];
}

export type ErrorCode =
  | "invalid_request"
  | "pin_required"
  | "wrong_pin"
  | "not_found"
  | "no_device"
  | "already_added"
  | "unsupported_change"
  | "device_error"
  | "device_busy"
  | "device_offline"
  | "strand_changed"
  | "shared"
  | "segment_budget"
  | "invalid_layout"
  | "invalid_name"
  | "not_adjacent"
  | "too_many"
  | "painted";

/** Every API error body. `message` is a sentence the UI shows to the user. */
export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  /** `segment_budget` only: how many more segments the write needs. */
  need?: number;
}

/** One slot's colors, effect and palette. Effects and palettes are kept by ID and by name. */
export type SlotLook = {
  col: number[][];
  fx: number;
  fxName: string;
  sx: number;
  ix: number;
  c1: number;
  c2: number;
  c3: number;
  o1: boolean;
  o2: boolean;
  o3: boolean;
  pal: number;
  palName: string;
};

export type Pattern = { kind: "all" } | { kind: "every"; n: number; group: number } | { kind: "individual" };

/** A range's pattern and slots, without its position. A painted range has no look. */
export type Look = { pattern: Exclude<Pattern, { kind: "individual" }>; slots: SlotLook[] };

/** A range as a scene keeps it. `start` is relative to the strand; `paint` is one hex color per LED. */
export type RangeSnapshot = {
  name: string;
  start: number;
  len: number;
  pattern: Pattern;
  slots: SlotLook[];
  paint?: string[];
};

/** A strand as a scene keeps it. */
export type StrandSnapshot = { on: boolean; bri: number; ranges: RangeSnapshot[] };

export type SlotView = SlotLook & { on: boolean };

/** A range on the Lights tab. `start` is relative to the strand. */
export type RangeView = {
  name: string;
  start: number;
  len: number;
  pattern: Pattern;
  slots: SlotView[];
  paint?: string[];
};

/** One LED output, or adjacent outputs combined (`key` "o0+o1"). */
export type StrandView = {
  key: string;
  name: string;
  pins: number[];
  start: number;
  len: number;
  on: boolean;
  bri: number;
  ranges: RangeView[];
  /** The view differs from the device's segments; the strand's first write rewrites it whole. */
  normalize: boolean;
  /** A segment crosses into these uncombined strands. */
  shared?: { with: string[] };
};

export type LightsView = {
  on: boolean;
  bri: number;
  strands: StrandView[];
  segments: { used: number; max: number };
  notices: string[];
  /** A 2D device: no strands, and every write gets `invalid_layout`. */
  matrix: boolean;
};

/** The body of `PATCH /api/devices/:id/lights`. `bri` 0-255. */
export type LightsPatch = { on?: boolean; bri?: number };

/** The body of `PATCH /api/devices/:id/lights/strands/:key`. `bri` 1-255; `ranges` is the strand's full list. */
export type StrandPatch = { on?: boolean; bri?: number; ranges?: RangeView[] };

export type Scene = {
  id: string;
  name: string;
  strandKey: string;
  ledCount: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type LookRecord = { id: string; name: string; look: Look; createdAt: string; updatedAt: string };

/** Where a look goes: a whole strand, or one range of it by name. */
export type LookTarget = { strandKey: string; range?: string };

export type ApplyResult = { view: LightsView; warnings: string[] };
