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
  def: { on: boolean; bri: number; ps: number };
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

export interface Preset {
  id: number;
  name: string;
}

export interface Effect {
  id: number;
  name: string;
  meta: string;
}

export interface Palette {
  id: number;
  name: string;
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
  | "device_offline";

/** Every API error body. `message` is a sentence the UI shows to the user. */
export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
}
