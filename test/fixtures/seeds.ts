import type { PinInfo, WifiNetwork, WledConfig, WledInfo } from "../../shared/apiTypes";

/**
 * The five devices of the design's mock (`SEEDS` in
 * docs/design/strand-wled-spec.html), as the data a WLED device serves:
 * `/json/info`, `/json/cfg`, `/json/state`, `/presets.json`, the effect and
 * palette lists, `/json/pins` and the Wi-Fi scan.
 */

export type SeedConfig = WledConfig & {
  hw: WledConfig["hw"] & { btn: Record<string, unknown>; ir: Record<string, unknown>; relay: Record<string, unknown> };
  if: WledConfig["if"] & { mqtt: Record<string, unknown>; ntp: Record<string, unknown> };
};

export type Seed = {
  info: WledInfo & { brand: string };
  cfg: SeedConfig;
  state: Record<string, unknown>;
  presets: Record<string, Record<string, unknown>>;
  effects: string[];
  fxdata: string[];
  palettes: string[];
  pins: PinInfo[];
  networks: WifiNetwork[];
};

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

type Arch = { pins: number[]; inputOnly: number[]; boot: number[]; strapping: number[]; analog: number[] };

// The design's `ARCH` table, without the limits (the s.js fixtures carry those).
const ARCH: Record<string, Arch> = {
  esp32: {
    pins: [...range(0, 5), ...range(12, 19), ...range(21, 23), ...range(25, 27), ...range(32, 39)],
    inputOnly: range(34, 39),
    boot: [0],
    strapping: [2, 12],
    analog: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27, ...range(32, 39)],
  },
  esp8266: {
    pins: [...range(0, 5), ...range(12, 16)],
    inputOnly: [],
    boot: [0],
    strapping: [2, 15],
    analog: [],
  },
  "ESP32-C3": {
    pins: [...range(0, 10), 20, 21],
    inputOnly: [],
    boot: [9],
    strapping: [2, 8, 9],
    analog: range(0, 4),
  },
};

// The design's `pinsFor`.
function pinsFor(arch: string, owners: Record<number, string>): PinInfo[] {
  const p = ARCH[arch] ?? ARCH.esp32!;
  return p.pins.map((gpio) => {
    let c = 0;
    if (p.analog.includes(gpio)) c |= 2;
    if (p.boot.includes(gpio)) c |= 8;
    if (p.strapping.includes(gpio)) c |= 16;
    if (p.inputOnly.includes(gpio)) c |= 32;
    const n = owners[gpio];
    return n ? { p: gpio, c, a: true, n } : { p: gpio, c, a: false };
  });
}

// The design's `AIRWAVES`.
const AIRWAVES: WifiNetwork[] = [
  { ssid: "HomeNet", rssi: -48, channel: 6, enc: 3 },
  { ssid: "HomeNet-IoT", rssi: -55, channel: 11, enc: 3 },
  { ssid: "Neighbor5G", rssi: -80, channel: 36, enc: 3 },
  { ssid: "xfinitywifi", rssi: -77, channel: 1, enc: 3 },
  { ssid: "Cafe", rssi: -85, channel: 3, enc: 0 },
];

// The first effects of WLED's list, with one reserved slot. The index is the effect ID.
const EFFECTS = ["Solid", "Blink", "Breathe", "Wipe", "Wipe Random", "Random Colors", "Sweep", "Dynamic", "Colorloop", "Rainbow", "RSVD"];
const FXDATA = ["", "!,Duty cycle;!,!;!;01", "!;!,!;!;01", "!,!;!,!;!", "!;;!", "!,Fade time;;!;01", "!,!;!,!;!", "!,!,,,,Smooth;;!", "!,Saturation;;!", "!,Size;;!", ""];
const PALETTES = [
  "Default",
  "* Random Cycle",
  "* Color 1",
  "* Colors 1&2",
  "* Color Gradient",
  "* Colors Only",
  "Party",
  "Cloud",
  "Lava",
  "Ocean",
  "Forest",
  "Rainbow",
  "Rainbow Bands",
];

const dhcp = () => ({ ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] });
const ap = () => ({ ssid: "WLED-AP", pskl: 8, chan: 1, hide: false, behav: 0 });
const defaultSync = (): WledConfig["if"]["sync"] => ({
  recv: { bri: true, col: true, fx: true, pal: true, seg: false, sb: false, grp: 1 },
  send: { en: false, dir: true, btn: false, grp: 1 },
});

type DesignSeed = {
  mac: string;
  ip: string;
  ver: string;
  vid: number;
  arch: string;
  clock: number;
  flash: number;
  freeheap: number;
  psram?: number;
  fs: { u: number; t: number };
  rssi: number;
  uptimeSec: number;
  fps: number;
  extraPins?: Record<number, string>;
  presets: { id: number; name: string }[];
  state: { on: boolean; bri: number };
  config: WledConfig;
};

// The design's `estimateCurrent`.
function estimateCurrent(s: DesignSeed): number {
  const max = s.config.hw.led.maxpwr;
  if (max === 0) return 0;
  if (!s.state.on) return 40;
  const total = 100 + s.config.hw.led.ins.reduce((t, o) => t + o.len * (o.ledma === 255 ? 12 : o.ledma), 0);
  const scale = s.config.light["scale-bri"] / 100;
  return Math.round(Math.min(max, total * (s.state.bri / 255) * scale * 0.22));
}

function toSeed(s: DesignSeed): Seed {
  const ledCount = s.config.hw.led.ins.reduce((t, o) => t + o.len, 0);
  const sync = s.config.if.sync;
  const owners: Record<number, string> = { ...s.extraPins };
  s.config.hw.led.ins.forEach((o) => o.pin.forEach((p) => (owners[p] = "LEDs")));
  const presets: Seed["presets"] = { "0": {} };
  s.presets.forEach((p) => (presets[String(p.id)] = { n: p.name, on: true, bri: s.state.bri }));

  return {
    // The design's `info()` on a device that just joined HomeNet (channel 6).
    info: {
      ver: s.ver,
      vid: s.vid,
      name: s.config.id.name,
      mac: s.mac,
      ip: s.ip,
      arch: s.arch,
      clock: s.clock,
      flash: s.flash,
      uptime: s.uptimeSec,
      freeheap: s.freeheap,
      ...(s.psram ? { psram: s.psram } : {}),
      fs: { ...s.fs },
      wifi: {
        rssi: s.rssi,
        signal: Math.max(0, Math.min(100, 2 * (s.rssi + 100))),
        channel: 6,
        band: "2.4GHz",
        ap: false,
        ssid: "HomeNet",
      },
      leds: {
        count: ledCount,
        fps: s.state.on ? s.fps : 0,
        pwr: estimateCurrent(s),
        maxpwr: s.config.hw.led.maxpwr,
        maxseg: s.arch === "esp8266" ? 16 : 32,
      },
      live: false,
      brand: "WLED",
    },
    cfg: {
      ...s.config,
      hw: {
        ...s.config.hw,
        btn: { max: 4, pull: true, ins: [{ type: 2, pin: [0], macros: [0, 0, 0] }], tt: 32, mqtt: false },
        ir: { pin: -1, type: 0, sel: true },
        relay: { pin: -1, rev: false, odrain: false },
      },
      if: {
        ...s.config.if,
        mqtt: { en: false, broker: "", port: 1883, user: "", pskl: 0, cid: `WLED-${s.mac.slice(6)}` },
        ntp: { en: false, host: "0.wled.pool.ntp.org", tz: 0, offset: 0, ampm: false, ln: 0, lt: 0 },
      },
    },
    state: {
      on: s.state.on,
      bri: s.state.bri,
      transition: 7,
      ps: -1,
      pl: -1,
      nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 },
      udpn: { send: sync.send.en, recv: sync.recv.grp > 0, sgrp: sync.send.grp, rgrp: sync.recv.grp },
      lor: 0,
      mainseg: 0,
      seg: [
        {
          id: 0,
          start: 0,
          stop: ledCount,
          len: ledCount,
          grp: 1,
          spc: 0,
          of: 0,
          on: true,
          frz: false,
          bri: 255,
          cct: 127,
          set: 0,
          lc: 1,
          col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]],
          fx: 0,
          sx: 128,
          ix: 128,
          pal: 0,
          c1: 128,
          c2: 128,
          c3: 16,
          sel: true,
          rev: false,
          mi: false,
        },
      ],
    },
    presets,
    effects: [...EFFECTS],
    fxdata: [...FXDATA],
    palettes: [...PALETTES],
    pins: pinsFor(s.arch, owners),
    networks: AIRWAVES.map((n) => ({ ...n })),
  };
}

const backyard = toSeed({
  mac: "a4cf12345678",
  ip: "192.168.1.42",
  ver: "0.16.0",
  vid: 2510180,
  arch: "esp32",
  clock: 240,
  flash: 4,
  freeheap: 145408,
  fs: { u: 48, t: 983 },
  rssi: -52,
  uptimeSec: 4 * 86400 + 12 * 3600 + 17 * 60,
  fps: 42,
  extraPins: { 0: "Button" },
  presets: [
    { id: 1, name: "Warm White" },
    { id: 2, name: "Halloween" },
    { id: 3, name: "Christmas" },
    { id: 4, name: "Game Day" },
  ],
  state: { on: true, bri: 128 },
  config: {
    id: { name: "Backyard", mdns: "wled-backyard" },
    nw: { ins: [{ ssid: "HomeNet", pskl: 12, ...dhcp() }] },
    ap: ap(),
    def: { on: true, bri: 128, ps: 0 },
    light: { "scale-bri": 100 },
    hw: {
      led: {
        maxpwr: 5000,
        ins: [
          { type: 22, pin: [16], start: 0, len: 150, order: 0, rev: false, skip: 0, ledma: 55 },
          { type: 22, pin: [17], start: 150, len: 150, order: 0, rev: true, skip: 0, ledma: 55 },
        ],
      },
    },
    if: {
      sync: {
        recv: { bri: true, col: true, fx: false, pal: false, seg: false, sb: false, grp: 1 },
        send: { en: true, dir: true, btn: false, grp: 1 },
      },
    },
  },
});

// The design gives Front Roof the PIN 1234. Tests set it with `startFakeWled(seed, { pin })`.
const frontRoof = toSeed({
  mac: "bcddc2a1b2c3",
  ip: "192.168.1.43",
  ver: "0.15.1",
  vid: 2412100,
  arch: "esp8266",
  clock: 160,
  flash: 4,
  freeheap: 21504,
  fs: { u: 31, t: 1000 },
  rssi: -71,
  uptimeSec: 2 * 86400 + 3 * 3600 + 41 * 60,
  fps: 38,
  presets: [
    { id: 1, name: "Warm White" },
    { id: 2, name: "Christmas" },
  ],
  state: { on: true, bri: 191 },
  config: {
    id: { name: "Front Roof", mdns: "wled-front-roof" },
    nw: { ins: [{ ssid: "HomeNet", pskl: 12, ...dhcp() }] },
    ap: ap(),
    def: { on: true, bri: 191, ps: 1 },
    light: { "scale-bri": 100 },
    hw: { led: { maxpwr: 0, ins: [{ type: 30, pin: [2], start: 0, len: 300, order: 0, rev: false, skip: 0, ledma: 55 }] } },
    if: {
      sync: {
        recv: { bri: true, col: true, fx: true, pal: true, seg: false, sb: false, grp: 1 },
        send: { en: false, dir: false, btn: false, grp: 1 },
      },
    },
  },
});

const deskLamp = toSeed({
  mac: "84f703aabbcc",
  ip: "192.168.1.51",
  ver: "0.16.0",
  vid: 2510180,
  arch: "ESP32-C3",
  clock: 160,
  flash: 4,
  freeheap: 198656,
  fs: { u: 22, t: 983 },
  rssi: -63,
  uptimeSec: 9 * 3600,
  fps: 42,
  presets: [],
  state: { on: false, bri: 255 },
  config: {
    id: { name: "Desk Lamp", mdns: "wled-desk-lamp" },
    nw: { ins: [{ ssid: "HomeNet", pskl: 12, ...dhcp() }] },
    ap: ap(),
    def: { on: false, bri: 255, ps: 0 },
    light: { "scale-bri": 100 },
    hw: { led: { maxpwr: 0, ins: [{ type: 45, pin: [4, 5, 6, 7, 10], start: 0, len: 1, order: 0, rev: false, skip: 0, ledma: 55 }] } },
    if: {
      sync: {
        recv: { bri: true, col: true, fx: true, pal: true, seg: false, sb: false, grp: 2 },
        send: { en: false, dir: true, btn: false, grp: 2 },
      },
    },
  },
});

const garage = toSeed({
  mac: "c8c9a3112233",
  ip: "192.168.1.57",
  ver: "0.16.0",
  vid: 2510180,
  arch: "esp32",
  clock: 240,
  flash: 4,
  freeheap: 151552,
  psram: 4093000,
  fs: { u: 12, t: 983 },
  rssi: -60,
  uptimeSec: 26 * 3600,
  fps: 42,
  presets: [],
  state: { on: false, bri: 128 },
  config: {
    id: { name: "Garage", mdns: "wled-garage" },
    nw: { ins: [{ ssid: "HomeNet", pskl: 12, ...dhcp() }] },
    ap: ap(),
    def: { on: false, bri: 128, ps: 0 },
    light: { "scale-bri": 100 },
    hw: { led: { maxpwr: 850, ins: [{ type: 22, pin: [16], start: 0, len: 60, order: 0, rev: false, skip: 0, ledma: 55 }] } },
    if: { sync: defaultSync() },
  },
});

const wled = toSeed({
  mac: "e8db84778899",
  ip: "192.168.1.88",
  ver: "0.14.4",
  vid: 2405180,
  arch: "esp8266",
  clock: 80,
  flash: 4,
  freeheap: 24576,
  fs: { u: 8, t: 1000 },
  rssi: -66,
  uptimeSec: 41 * 60,
  fps: 40,
  presets: [],
  state: { on: true, bri: 128 },
  config: {
    id: { name: "WLED", mdns: "wled-778899" },
    nw: { ins: [{ ssid: "HomeNet", pskl: 12, ...dhcp() }] },
    ap: ap(),
    def: { on: true, bri: 128, ps: 0 },
    light: { "scale-bri": 100 },
    hw: { led: { maxpwr: 850, ins: [{ type: 22, pin: [2], start: 0, len: 30, order: 0, rev: false, skip: 0, ledma: 55 }] } },
    if: { sync: defaultSync() },
  },
});

/** The design's seeds, by name. A fake device copies its seed, so tests can share these. */
export const seeds = { backyard, frontRoof, deskLamp, garage, wled } satisfies Record<string, Seed>;
