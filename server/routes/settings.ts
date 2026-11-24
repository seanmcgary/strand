import type { FastifyInstance } from "fastify";
import type { PinInfo, WifiNetwork, WledConfig, WledConfigFull, WledInfo, Capabilities } from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import type { DeviceRow } from "../db/devices";
import { ApiError, messages } from "../errors";
import { parseCapabilities, pinsFromCapabilities } from "../wled/capabilities";
import { deviceRequest } from "../wled/deviceClient";
import { targetOf } from "./devices";

/** The most `/json/net` requests of one scan (spec §8.3). */
const SCAN_REQUESTS = 10;

/** The saved device, or `404 not_found`. */
export function loadDevice(deps: AppDeps, id: string): DeviceRow {
  const row = devices.get(deps.db, id);
  if (!row) throw new ApiError(404, "not_found", messages.notFound());
  return row;
}

/** Reads `/json/info` and records that the device answered (spec §7). */
export async function readInfo(deps: AppDeps, row: DeviceRow): Promise<WledInfo> {
  const info = await deviceRequest<WledInfo>(deps, targetOf(row), "/json/info");
  // A recovery during the request saved the new address, so read it back instead of writing the old one.
  const lastIp = devices.get(deps.db, row.id)?.lastIp ?? row.lastIp;
  const name = typeof info.name === "string" && info.name !== "" ? info.name : row.name;
  devices.recordSeen(deps.db, row.id, { name, lastIp }, deps.now());
  return info;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The subtrees of `/json/cfg` that `WledConfig` names, and no other key of them. */
export function toWledConfig(cfg: WledConfigFull): WledConfig {
  const sub = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
  const { on, bri } = sub(cfg.def);
  return {
    id: cfg.id,
    nw: cfg.nw,
    ap: cfg.ap,
    def: { on, bri },
    light: cfg.light,
    hw: { led: sub(cfg.hw).led },
    if: { sync: sub(cfg.if).sync },
  } as WledConfig;
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

export async function settingsRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/devices/:id/info", async (request) =>
    readInfo(deps, loadDevice(deps, request.params.id)),
  );

  app.get<{ Params: { id: string } }>("/api/devices/:id/config", async (request) => {
    const row = loadDevice(deps, request.params.id);
    return toWledConfig(await deviceRequest<WledConfigFull>(deps, targetOf(row), "/json/cfg"));
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
}
