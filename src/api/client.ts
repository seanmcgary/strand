import type {
  Capabilities,
  ConfigPatch,
  Device,
  DiscoveredDevice,
  Effect,
  ErrorCode,
  Palette,
  PinInfo,
  StatePatch,
  WifiNetwork,
  WledConfig,
  WledInfo,
} from "../../shared/apiTypes"

/** A failed API call. `code` is the server's error code; `message` is a sentence for the user. */
export class ApiError extends Error {
  status: number
  code: ErrorCode

  constructor(status: number, code: ErrorCode, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

function isErrorBody(body: unknown): body is { error: ErrorCode; message: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { error?: unknown }).error === "string" &&
    typeof (body as { message?: unknown }).message === "string"
  )
}

/** Sends one request to the app server with a root-relative path. Resolves to the JSON body, or `undefined` on 204. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Strand-Request": "1" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return undefined as T
  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => null)
    if (isErrorBody(parsed)) throw new ApiError(response.status, parsed.error, parsed.message)
    throw new ApiError(response.status, "device_error", "The server sent an unexpected reply.")
  }
  return (await response.json()) as T
}

const device = (id: string) => `/api/devices/${encodeURIComponent(id)}`

export const api = {
  listDevices: () => request<Device[]>("GET", "/api/devices"),
  discover: () => request<DiscoveredDevice[]>("GET", "/api/discovery"),
  probeHost: (host: string) => request<DiscoveredDevice>("POST", "/api/devices/probe", { host }),
  addDevice: (host: string) => request<Device>("POST", "/api/devices", { host }),
  removeDevice: (id: string) => request<void>("DELETE", device(id)),
  getInfo: (id: string) => request<WledInfo>("GET", `${device(id)}/info`),
  getState: (id: string) => request<unknown>("GET", `${device(id)}/state`),
  patchState: (id: string, patch: StatePatch) => request<unknown>("PATCH", `${device(id)}/state`, patch),
  getConfig: (id: string) => request<WledConfig>("GET", `${device(id)}/config`),
  patchConfig: (id: string, patch: ConfigPatch) => request<WledConfig>("PATCH", `${device(id)}/config`, patch),
  unlock: (id: string, pin: string) => request<void>("POST", `${device(id)}/unlock`, { pin }),
  getCapabilities: (id: string) => request<Capabilities>("GET", `${device(id)}/capabilities`),
  getPins: (id: string) => request<{ pins: PinInfo[] }>("GET", `${device(id)}/pins`),
  scanNetworks: (id: string) => request<{ networks: WifiNetwork[] }>("POST", `${device(id)}/networks/scan`),
  reboot: (id: string) => request<void>("POST", `${device(id)}/reboot`),
  getPendingReboot: (id: string) => request<string[]>("GET", `${device(id)}/pending-reboot`),
  getEffects: (id: string) => request<Effect[]>("GET", `${device(id)}/effects`),
  getPalettes: (id: string) => request<Palette[]>("GET", `${device(id)}/palettes`),
  getPreferences: () => request<Record<string, unknown>>("GET", "/api/preferences"),
  putPreference: (key: string, value: unknown) =>
    request<void>("PUT", `/api/preferences/${encodeURIComponent(key)}`, { value }),
}
