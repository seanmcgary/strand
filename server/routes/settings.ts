import type { FastifyInstance } from "fastify";
import type {
  ApConfig,
  Capabilities,
  ConfigPatch,
  LedOutput,
  PinInfo,
  SyncConfig,
  WifiEntry,
  WifiNetwork,
  WledConfig,
  WledConfigFull,
  WledInfo,
} from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import type { DeviceRow } from "../db/devices";
import { ApiError, messages } from "../errors";
import { parseCapabilities, pinsFromCapabilities } from "../wled/capabilities";
import { classifyChanges, checkUnsupported, mergeConfigPatch, topLevelBody } from "../wled/configMerge";
import { deviceRequest } from "../wled/deviceClient";
import { lockCheck, targetOf } from "./devices";

/** The most `/json/net` requests of one scan (spec §8.3). */
const SCAN_REQUESTS = 10;

/** The saved device, or `404 not_found`. */
export function loadDevice(deps: AppDeps, id: string): DeviceRow {
  const row = devices.get(deps.db, id);
  if (!row) throw new ApiError(404, "not_found", messages.notFound());
  return row;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sub = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});

/** Reads `/json/info` and records that the device answered (spec §7). Returns the fields of `WledInfo` and no others. */
export async function readInfo(deps: AppDeps, row: DeviceRow): Promise<WledInfo> {
  const raw = await deviceRequest<WledInfo>(deps, targetOf(row), "/json/info");
  const { fs, wifi, leds } = { fs: sub(raw.fs), wifi: sub(raw.wifi), leds: sub(raw.leds) };
  if (typeof raw.ver !== "string" || typeof raw.mac !== "string" || typeof raw.uptime !== "number" || typeof leds.count !== "number") {
    throw new ApiError(502, "device_error", messages.firmwareUnsupported(row.name));
  }
  const info = {
    ver: raw.ver,
    vid: raw.vid,
    name: raw.name,
    mac: raw.mac,
    ip: raw.ip,
    arch: raw.arch,
    clock: raw.clock,
    flash: raw.flash,
    uptime: raw.uptime,
    freeheap: raw.freeheap,
    ...(raw.psram === undefined ? {} : { psram: raw.psram }),
    fs: { u: fs.u, t: fs.t },
    wifi: {
      rssi: wifi.rssi,
      signal: wifi.signal,
      channel: wifi.channel,
      band: wifi.band,
      ap: wifi.ap,
      ...(wifi.ssid === undefined ? {} : { ssid: wifi.ssid }),
    },
    leds: {
      count: leds.count,
      fps: leds.fps,
      pwr: leds.pwr,
      maxpwr: leds.maxpwr,
      maxseg: leds.maxseg,
      ...(isObject(leds.matrix) ? { matrix: { w: leds.matrix.w, h: leds.matrix.h } } : {}),
    },
    live: raw.live,
  } as WledInfo;
  // A recovery during the request saved the new address, so read it back instead of writing the old one.
  const lastIp = devices.get(deps.db, row.id)?.lastIp ?? row.lastIp;
  const name = typeof info.name === "string" && info.name !== "" ? info.name.slice(0, 64) : row.name;
  devices.recordSeen(deps.db, row.id, { name, lastIp }, deps.now());
  return info;
}

/** The subtrees of `/json/cfg` that `WledConfig` names, and no other key of them. */
export function toWledConfig(cfg: WledConfigFull, name: string): WledConfig {
  const { on, bri } = sub(cfg.def);
  if (
    !(isObject(cfg.id) && isObject(cfg.nw) && Array.isArray(cfg.nw.ins) && isObject(cfg.ap) && isObject(sub(cfg.hw).led) && isObject(sub(cfg.if).sync)) ||
    typeof on !== "boolean" ||
    typeof bri !== "number"
  ) {
    throw new ApiError(502, "device_error", messages.firmwareUnsupported(name));
  }
  return {
    id: cfg.id,
    nw: cfg.nw,
    ap: cfg.ap,
    def: { on, bri },
    light: cfg.light,
    hw: { led: sub(cfg.hw).led },
    if: { sync: sub(cfg.if).sync },
  } as unknown as WledConfig;
}

function isPinInfo(v: unknown): v is PinInfo {
  return (
    isObject(v) &&
    Number.isInteger(v.p) &&
    typeof v.c === "number" &&
    typeof v.a === "boolean" &&
    (v.n === undefined || typeof v.n === "string")
  );
}

const isNetwork = (v: unknown): v is WifiNetwork =>
  isObject(v) && typeof v.ssid === "string" && typeof v.rssi === "number" && typeof v.channel === "number" && typeof v.enc === "number";

async function readCapabilities(deps: AppDeps, row: DeviceRow): Promise<Capabilities & { maxGpio: number }> {
  const text = await deviceRequest<string>(deps, targetOf(row), "/settings/s.js?p=2", { parse: "text" });
  const caps = parseCapabilities(text);
  if (!caps) throw new ApiError(502, "device_error", messages.firmwareUnsupported(row.name));
  return caps;
}

type Schema = Record<string, unknown>;

/**
 * An object schema with one property per field of `T`, so the compiler flags a field the schema misses or adds.
 * Open by default: `GET /config` passes raw device subtrees, so a body sent back carries device keys `T` does not name.
 */
const fields = <T>(properties: { [K in keyof T]-?: Schema }, extra: Schema = {}): Schema => ({
  type: "object",
  properties,
  ...extra,
});
/** An array item: a whole entry, since a patch replaces an array whole (`DeepPartial`). */
const entry = <T>(properties: { [K in keyof T]-?: Schema }, optional: (keyof T)[] = []): Schema =>
  fields<T>(properties, { required: Object.keys(properties).filter((k) => !optional.includes(k as keyof T)) });
const closed = { additionalProperties: false };

const bool = { type: "boolean" };
const int = { type: "integer" };
const range = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
const text = (maxLength: number): Schema => ({ type: "string", maxLength });
const list = (items: Schema, extra: Schema = {}): Schema => ({ type: "array", items, ...extra });
// wifi-network.md:30-32: four 0-255 inputs per address.
const address = list(range(0, 255), { minItems: 4, maxItems: 4 });

const wifiEntry = entry<WifiEntry>(
  {
    ssid: text(32), // wifi-network.md:24
    pskl: int,
    psk: text(64), // wifi-network.md:28
    ip: address,
    gw: address,
    sn: address,
  },
  ["psk"],
);

const apConfig = fields<ApConfig>({
  ssid: text(32), // wifi-network.md:64
  pskl: int,
  // wifi-network.md:66: empty (open) or 8-63 characters; the device ignores 1-7.
  psk: { type: "string", anyOf: [{ maxLength: 0 }, { minLength: 8, maxLength: 63 }] },
  chan: range(1, 13), // wifi-network.md:67
  hide: bool,
  behav: range(0, 4), // wifi-network.md:68
});

const ledOutput = entry<LedOutput>({
  type: int,
  pin: list(int),
  start: range(0, 8191), // led-hardware.md:123
  len: int,
  order: int,
  rev: bool,
  skip: range(0, 255), // led-hardware.md:127
  ledma: range(0, 255), // led-hardware.md:132
});

// sync-interfaces.md:28-29: each group is a 0-255 bitmask.
const syncConfig = fields<SyncConfig>({
  recv: fields<SyncConfig["recv"]>({ bri: bool, col: bool, fx: bool, pal: bool, seg: bool, sb: bool, grp: range(0, 255) }),
  send: fields<SyncConfig["send"]>({ en: bool, dir: bool, btn: bool, grp: range(0, 255) }),
});

/** `ConfigPatch`. `def`, `hw` and `if` are closed: `toWledConfig` returns only the keys named here for them. */
const configBody = fields<WledConfig>(
  {
    id: fields<WledConfig["id"]>({ name: text(32), mdns: text(32) }), // ui.md:16, wifi-network.md:57
    nw: fields<WledConfig["nw"]>({ ins: list(wifiEntry) }),
    ap: apConfig,
    // Settings writes only `def.on` and `def.bri`; the boot preset belongs to Strand (plan decision 4).
    def: fields<WledConfig["def"]>({ on: bool, bri: range(0, 255) }, closed),
    light: fields<WledConfig["light"]>({ "scale-bri": range(1, 255) }), // led-hardware.md:92
    hw: fields<WledConfig["hw"]>(
      // led-hardware.md:94, :105: 250-65000, or 0 with the limiter off.
      { led: fields<WledConfig["hw"]["led"]>({ maxpwr: range(0, 65000), ins: list(ledOutput) }) },
      closed,
    ),
    if: fields<WledConfig["if"]>({ sync: syncConfig }, closed),
  },
  { minProperties: 1, ...closed },
);

const unlockBody = {
  type: "object",
  required: ["pin"],
  additionalProperties: false,
  properties: { pin: { type: "string", pattern: "^[0-9]{4}$" } },
} as const;

export async function settingsRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/devices/:id/info", async (request) =>
    readInfo(deps, loadDevice(deps, request.params.id)),
  );

  app.get<{ Params: { id: string } }>("/api/devices/:id/config", async (request) => {
    const row = loadDevice(deps, request.params.id);
    return toWledConfig(await deviceRequest<WledConfigFull>(deps, targetOf(row), "/json/cfg"), row.name);
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id/capabilities", async (request): Promise<Capabilities> => {
    const { maxGpio: _maxGpio, ...caps } = await readCapabilities(deps, loadDevice(deps, request.params.id));
    return caps;
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id/pins", async (request): Promise<{ pins: PinInfo[] }> => {
    const row = loadDevice(deps, request.params.id);
    // 0.15 has no `/json/pins`: the path answers with the full `/json` reply, which has no `pins` key.
    const reply = await deviceRequest<{ pins?: unknown }>(deps, targetOf(row), "/json/pins");
    if (Array.isArray(reply.pins)) return { pins: reply.pins.filter(isPinInfo) };
    const caps = await readCapabilities(deps, row);
    const cfg = await deviceRequest<WledConfigFull>(deps, targetOf(row), "/json/cfg");
    return { pins: pinsFromCapabilities(caps, cfg) };
  });

  app.post<{ Params: { id: string } }>("/api/devices/:id/networks/scan", async (request) => {
    const row = loadDevice(deps, request.params.id);
    for (let i = 0; i < SCAN_REQUESTS; i++) {
      // The first request starts the scan and returns an empty list.
      const reply = await deviceRequest<{ networks?: unknown }>(deps, targetOf(row), "/json/net");
      if (!isObject(reply) || !Array.isArray(reply.networks) || !reply.networks.every(isNetwork)) {
        throw new ApiError(502, "device_error", messages.deviceError(row.name, "the scan reply is not valid"));
      }
      if (reply.networks.length > 0) {
        return { networks: reply.networks.map(({ ssid, rssi, channel, enc }) => ({ ssid, rssi, channel, enc })) };
      }
      if (i < SCAN_REQUESTS - 1) await new Promise((resolve) => setTimeout(resolve, deps.scanDelayMs));
    }
    return { networks: [] as WifiNetwork[] };
  });

  app.patch<{ Params: { id: string }; Body: ConfigPatch }>(
    "/api/devices/:id/config",
    { schema: { body: configBody } },
    async (request) => {
      const row = loadDevice(deps, request.params.id);
      const target = targetOf(row);
      const patch = request.body;

      const before = await deviceRequest<WledConfigFull>(deps, target, "/json/cfg");
      const unsupported = checkUnsupported(before, patch);
      if (unsupported) throw new ApiError(422, "unsupported_change", unsupported);

      const merged = mergeConfigPatch(before, patch);
      await deviceRequest(deps, target, "/json/cfg", { method: "POST", body: topLevelBody(merged, patch) });
      const after = await deviceRequest<WledConfigFull>(deps, target, "/json/cfg");

      const { reconnect, reboot } = classifyChanges(before, after, patch);
      if (reconnect) {
        try {
          await deviceRequest(deps, target, "/json/state", { method: "POST", body: { rb: true } });
          devices.clearPendingReboot(deps.db, row.id, deps.now());
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          // The write is saved, so the config still returns; the new Wi-Fi waits for a reboot (plan decision 7).
          devices.addPendingReboot(deps.db, row.id, ["Wi-Fi", ...reboot], deps.now());
        }
      } else {
        devices.addPendingReboot(deps.db, row.id, reboot, deps.now());
      }
      return toWledConfig(after, row.name);
    },
  );

  app.post<{ Params: { id: string }; Body: { pin: string } }>(
    "/api/devices/:id/unlock",
    { schema: { body: unlockBody } },
    async (request, reply) => {
      const target = targetOf(loadDevice(deps, request.params.id));
      await deviceRequest(deps, target, "/json/state", { method: "POST", body: { pin: request.body.pin } });
      if (await lockCheck(deps, target, true, true)) throw new ApiError(401, "wrong_pin", messages.wrongPin());
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>("/api/devices/:id/reboot", async (request, reply) => {
    const row = loadDevice(deps, request.params.id);
    await deviceRequest(deps, targetOf(row), "/json/state", { method: "POST", body: { rb: true } });
    devices.clearPendingReboot(deps.db, row.id, deps.now());
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id/pending-reboot", async (request): Promise<string[]> => {
    const row = loadDevice(deps, request.params.id);
    if (row.pendingReboot.length === 0) return [];
    let info: WledInfo;
    try {
      info = await readInfo(deps, row);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "device_offline" || err.code === "device_busy")) return row.pendingReboot;
      throw err;
    }
    const since = row.pendingSince === null ? NaN : Date.parse(row.pendingSince);
    if (deps.now().getTime() - info.uptime * 1000 > since) {
      devices.clearPendingReboot(deps.db, row.id, deps.now());
      return [];
    }
    return row.pendingReboot;
  });
}
