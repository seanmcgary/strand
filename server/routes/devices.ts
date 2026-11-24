import { lookup } from "node:dns/promises";
import type { FastifyInstance } from "fastify";
import type { Device, DiscoveredDevice, WledInfo } from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import type { DeviceRow } from "../db/devices";
import { ApiError, messages } from "../errors";
import { deviceRequest, fetchInfo, RESOLVE_TIMEOUT_MS, type DeviceTarget } from "../wled/deviceClient";

/** The lock check: page 3 of `s.js` is the smallest PIN-gated script (plan, "Verified external API"). */
const LOCK_CHECK_PATH = "/settings/s.js?p=3";

const hostBody = {
  type: "object",
  required: ["host"],
  additionalProperties: false,
  properties: { host: { type: "string", maxLength: 300 } },
} as const;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Reads what a user typed as a device address: an optional `http://` or
 * `https://`, an IPv4 address or an RFC 1123 host name, an optional `:port`,
 * and an optional path, which is dropped. Returns `null` for anything else.
 * `defaultPort` is the port when none is typed.
 */
function normalizeHost(input: string, defaultPort: number): { host: string; port: number } | null {
  let value = input.trim().toLowerCase().replace(/^https?:\/\//, "");
  const slash = value.indexOf("/");
  if (slash !== -1) value = value.slice(0, slash);

  const parts = value.split(":");
  if (parts.length > 2) return null;
  const host = parts[0]!;
  let port = defaultPort;
  if (parts.length === 2) {
    if (!/^\d{1,5}$/.test(parts[1]!)) return null;
    port = Number(parts[1]);
    if (port < 1 || port > 65535) return null;
  }

  const ipv4 = IPV4.exec(host);
  if (ipv4) return ipv4.slice(1).every((octet) => Number(octet) <= 255) ? { host, port } : null;
  if (host === "" || host.length > 253 || /^[\d.]+$/.test(host)) return null;
  return host.split(".").every((label) => LABEL.test(label)) ? { host, port } : null;
}

export function targetOf(row: DeviceRow): DeviceTarget {
  return { id: row.id, name: row.name, host: row.host, port: row.port, lastIp: row.lastIp, mac: row.mac };
}

export function toDevice(row: DeviceRow, live: { online: boolean; locked: boolean }, now: Date): Device {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    lastIp: row.lastIp,
    mac: row.mac,
    online: live.online,
    lastSeen: live.online ? now.toISOString() : row.lastSeen,
    pinLocked: live.locked,
  };
}

/** Whether the device's settings are PIN-locked. Any other failure counts as not locked, unless `strict`, which passes it on. */
export async function lockCheck(deps: AppDeps, target: DeviceTarget, recover = true, strict = false): Promise<boolean> {
  try {
    await deviceRequest<string>(deps, target, LOCK_CHECK_PATH, { parse: "text", recover });
    return false;
  } catch (err) {
    if (err instanceof ApiError) {
      if (strict && err.code !== "pin_required") throw err;
      return err.code === "pin_required";
    }
    throw err;
  }
}

/** The IPv4 address of a name: `.local` names through mDNS, other names through the system resolver. */
async function resolveName(deps: AppDeps, name: string): Promise<string | null> {
  if (name.endsWith(".local")) return deps.mdns.resolveA(name, RESOLVE_TIMEOUT_MS).catch(() => null);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, deps.config.deviceTimeoutMs, null);
  });
  try {
    return await Promise.race([lookup(name, { family: 4 }).then((r) => r.address), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Finds the WLED device at what the user typed. Throws `400 invalid_request` or `404 no_device`. */
async function probeHost(
  deps: AppDeps,
  input: string,
): Promise<{ host: string; port: number; ip: string; info: WledInfo }> {
  const parsed = normalizeHost(input, deps.wledPort);
  if (!parsed) throw new ApiError(400, "invalid_request", messages.invalidRequest());
  const { port } = parsed;

  // A bare name with no dot tries `<name>.local` first.
  const candidates = IPV4.test(parsed.host)
    ? [{ host: parsed.host, ip: parsed.host }]
    : (parsed.host.includes(".") ? [parsed.host] : [`${parsed.host}.local`, parsed.host]).map((host) => ({ host }));
  for (const candidate of candidates) {
    const ip = "ip" in candidate ? candidate.ip : await resolveName(deps, candidate.host);
    if (!ip) continue;
    const info = await fetchInfo(deps, ip, port);
    if (info) return { host: candidate.host, port, ip, info };
  }
  throw new ApiError(404, "no_device", messages.noDevice(input.trim()));
}

export function toDiscovered(found: { ip: string; host: string; info: WledInfo }, alreadyAdded: boolean): DiscoveredDevice {
  const { info } = found;
  return {
    mac: info.mac,
    name: info.name,
    ip: found.ip,
    host: found.host,
    ver: info.ver,
    ledCount: info.leds.count,
    arch: info.arch,
    alreadyAdded,
  };
}

export async function devicesRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get("/api/devices", async () => {
    const rows = devices.list(deps.db);
    const now = deps.now();
    return Promise.all(
      rows.map(async (row): Promise<Device> => {
        // Recovery is off so that one moved device does not slow the list.
        const info = await fetchInfo(deps, row.lastIp, row.port);
        if (info?.mac !== row.mac) return toDevice(row, { online: false, locked: false }, now);
        devices.recordSeen(deps.db, row.id, { name: info.name || row.name, lastIp: row.lastIp }, now);
        const locked = await lockCheck(deps, targetOf(row), false);
        return toDevice({ ...row, name: info.name || row.name }, { online: true, locked }, now);
      }),
    );
  });

  app.post<{ Body: { host: string } }>("/api/devices/probe", { schema: { body: hostBody } }, async (request) => {
    const found = await probeHost(deps, request.body.host);
    return toDiscovered(found, devices.getByMac(deps.db, found.info.mac) !== undefined);
  });

  app.post<{ Body: { host: string } }>("/api/devices", { schema: { body: hostBody } }, async (request, reply) => {
    const found = await probeHost(deps, request.body.host);
    const name = found.info.name || found.host;
    if (devices.getByMac(deps.db, found.info.mac)) {
      throw new ApiError(409, "already_added", messages.alreadyAdded(name));
    }
    const now = deps.now();
    const row = devices.insert(
      deps.db,
      { mac: found.info.mac, name, host: found.host, port: found.port, lastIp: found.ip },
      now,
    );
    devices.recordSeen(deps.db, row.id, { name, lastIp: found.ip }, now);
    const locked = await lockCheck(deps, targetOf(row), false);
    return reply.code(201).send(toDevice(row, { online: true, locked }, now));
  });

  app.delete<{ Params: { id: string } }>("/api/devices/:id", async (request, reply) => {
    if (!devices.remove(deps.db, request.params.id)) throw new ApiError(404, "not_found", messages.notFound());
    return reply.code(204).send();
  });
}
