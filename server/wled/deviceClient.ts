import type { WledInfo } from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import { ApiError, messages } from "../errors";

/**
 * Every request to a WLED device goes through this module (spec §9). It maps
 * each device result to an `ApiError`, and finds a `.local` device again
 * through mDNS when its saved address stops answering.
 */

export type DeviceTarget = { id?: string; name: string; host: string; port: number; lastIp: string; mac?: string };

type DeviceRequestInit = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  parse?: "json" | "text";
  recover?: boolean;
};

/** The largest device reply the server reads. */
const MAX_REPLY_BYTES = 1024 * 1024;
/** The time limit of the mDNS lookup during address recovery. */
export const RESOLVE_TIMEOUT_MS = 1000;

// Node fetch (undici) puts the network error code on `err.cause.code`. A
// dropped connection means the device is busy. Every other failure (a timeout,
// ECONNREFUSED, EHOSTUNREACH, ENETUNREACH, ENOTFOUND, EAI_AGAIN,
// EADDRNOTAVAIL, UND_ERR_CONNECT_TIMEOUT, or anything else) means offline.
const BUSY_CODES = new Set(["ECONNRESET", "UND_ERR_SOCKET"]);

/** Maps a rejected fetch, or a failed body read, to device_busy or device_offline. */
function networkError(err: unknown, name: string): ApiError {
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === "string" && BUSY_CODES.has(code)) {
    return new ApiError(503, "device_busy", messages.deviceBusy(name));
  }
  return new ApiError(504, "device_offline", messages.deviceOffline(name));
}

/** Maps a non-2xx status (redirects are not followed) to an `ApiError`. */
function statusError(status: number, name: string): ApiError {
  if (status === 401) return new ApiError(401, "pin_required", messages.pinRequired());
  if (status === 503) return new ApiError(503, "device_busy", messages.deviceBusy(name));
  return new ApiError(502, "device_error", messages.deviceError(name, `HTTP ${status}`));
}

/** Reads the body as text, and stops with device_error past `MAX_REPLY_BYTES`. */
async function readBody(res: Response, name: string): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPLY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ApiError(502, "device_error", messages.deviceError(name, "reply too large"));
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One request to one address, with every device result mapped to a value or an `ApiError`. */
async function send<T>(deps: AppDeps, target: DeviceTarget, ip: string, path: string, init: DeviceRequestInit): Promise<T> {
  const { name } = target;
  const url = new URL(path, `http://${ip}:${target.port}`);
  // `path` is one of the server's fixed paths. `//host` or `/\host` would make the URL name another host.
  if (url.hostname !== ip || url.port !== (target.port === 80 ? "" : String(target.port))) {
    throw new Error(`deviceRequest: path must stay on the device: ${path}`);
  }
  const hasBody = init.body !== undefined;
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? deps.config.deviceTimeoutMs),
      redirect: "manual",
    });
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => {});
      throw statusError(res.status, name);
    }
    const text = await readBody(res, name);
    if (init.parse === "text") return text as T;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(502, "device_error", messages.deviceError(name, "the reply is not JSON"));
    }
    const code = (data as { error?: unknown } | null)?.error;
    if (typeof code === "number") {
      throw new ApiError(502, "device_error", messages.deviceError(name, `error ${code}`));
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw networkError(err, name);
  }
}

/**
 * Sends one request to a device at its saved address. When the device does
 * not answer, its host is a `.local` name, and the target is a saved device
 * (`id` and `mac`), it looks the name up through mDNS once. If the new
 * address answers `/json/info` with the same MAC, it saves that address and
 * sends the request there.
 *
 * `path` is one of the server's fixed device paths, so a path that does not
 * start with `/`, or that names another host, is a programming error and throws a plain `Error`.
 */
export async function deviceRequest<T>(
  deps: AppDeps,
  target: DeviceTarget,
  path: string,
  init: DeviceRequestInit = {},
): Promise<T> {
  if (!path.startsWith("/")) {
    throw new Error(`deviceRequest: path must start with "/": ${path}`);
  }
  try {
    return await send<T>(deps, target, target.lastIp, path, init);
  } catch (err) {
    const { id, mac } = target;
    const canRecover =
      err instanceof ApiError &&
      err.code === "device_offline" &&
      (init.recover ?? true) &&
      target.host.toLowerCase().endsWith(".local") &&
      id !== undefined &&
      mac !== undefined;
    if (!canRecover) throw err;

    const ip = await deps.mdns.resolveA(target.host, RESOLVE_TIMEOUT_MS).catch(() => null);
    if (!ip || ip === target.lastIp) throw err;
    const info = await fetchInfo(deps, ip, target.port);
    if (info?.mac !== mac) throw err;
    devices.setLastIp(deps.db, id, ip, deps.now());
    return send<T>(deps, target, ip, path, init);
  }
}

/**
 * Reads `/json/info` at an address. Returns `null` when nothing answers, or
 * when the reply is not from WLED (`brand`, `mac`, `ver` and `leds.count` are checked).
 */
export async function fetchInfo(deps: AppDeps, ip: string, port: number): Promise<WledInfo | null> {
  let info: Partial<WledInfo> & { brand?: unknown };
  try {
    info = await deviceRequest(deps, { name: ip, host: ip, port, lastIp: ip }, "/json/info", { recover: false });
  } catch {
    return null;
  }
  if (typeof info !== "object" || info === null) return null;
  if (info.brand !== "WLED") return null;
  if (typeof info.mac !== "string" || !/^[0-9a-f]{12}$/.test(info.mac)) return null;
  if (typeof info.ver !== "string" || info.ver === "") return null;
  const leds: unknown = info.leds;
  if (typeof leds !== "object" || leds === null || typeof (leds as { count?: unknown }).count !== "number") return null;
  const name = typeof info.name === "string" ? info.name.slice(0, 64) : "";
  const arch = typeof info.arch === "string" ? info.arch : "";
  return { ...(info as WledInfo), name, arch };
}

/** Whether `ip` is a dotted IPv4 address in 10/8, 172.16/12, 192.168/16, 169.254/16 or 127/8. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
