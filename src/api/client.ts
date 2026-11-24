import type {
  ApiErrorBody,
  ApplyResult,
  Capabilities,
  ConfigPatch,
  Device,
  DiscoveredDevice,
  Effect,
  ErrorCode,
  LightsPatch,
  LightsView,
  LookRecord,
  LookTarget,
  Palette,
  PinInfo,
  Scene,
  StrandPatch,
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

function isErrorBody(body: unknown): body is ApiErrorBody {
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
  const parsed: unknown = await response.json().catch(() => undefined)
  if (parsed === undefined) throw new ApiError(response.status, "device_error", "The server sent an unexpected reply.")
  return parsed as T
}

const device = (id: string) => `/api/devices/${encodeURIComponent(id)}`
const seg = encodeURIComponent

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
  getLights: (id: string) => request<LightsView>("GET", `${device(id)}/lights`),
  patchLights: (id: string, body: LightsPatch) => request<LightsView>("PATCH", `${device(id)}/lights`, body),
  patchStrand: (id: string, key: string, body: StrandPatch) =>
    request<LightsView>("PATCH", `${device(id)}/lights/strands/${seg(key)}`, body),
  resolveShared: (id: string, key: string, action: "split" | "combine") =>
    request<LightsView>("POST", `${device(id)}/lights/strands/${seg(key)}/resolve`, { action }),
  flash: (id: string, strandKey: string, led: number) =>
    request<void>("POST", `${device(id)}/lights/flash`, { strandKey, led }),
  getStrandGroups: (id: string) => request<string[]>("GET", `${device(id)}/strand-groups`),
  putStrandGroups: (id: string, keys: string[]) =>
    request<LightsView>("PUT", `${device(id)}/strand-groups`, { keys }),
  putStrandNames: (id: string, names: Record<string, string>) =>
    request<LightsView>("PUT", `${device(id)}/strand-names`, { names }),
  getScenes: (id: string) => request<Scene[]>("GET", `${device(id)}/scenes`),
  createScene: (id: string, body: { name: string; strandKey: string }) =>
    request<Scene>("POST", `${device(id)}/scenes`, body),
  renameScene: (id: string, sceneId: string, name: string) =>
    request<Scene>("PATCH", `${device(id)}/scenes/${seg(sceneId)}`, { name }),
  deleteScene: (id: string, sceneId: string) => request<void>("DELETE", `${device(id)}/scenes/${seg(sceneId)}`),
  applyScene: (id: string, sceneId: string) =>
    request<ApplyResult>("POST", `${device(id)}/scenes/${seg(sceneId)}/apply`),
  getLooks: (id: string) => request<LookRecord[]>("GET", `${device(id)}/looks`),
  createLook: (id: string, body: { name: string; strandKey: string; range: string }) =>
    request<LookRecord>("POST", `${device(id)}/looks`, body),
  renameLook: (id: string, lookId: string, name: string) =>
    request<LookRecord>("PATCH", `${device(id)}/looks/${seg(lookId)}`, { name }),
  deleteLook: (id: string, lookId: string) => request<void>("DELETE", `${device(id)}/looks/${seg(lookId)}`),
  applyLook: (id: string, lookId: string, targets: LookTarget[]) =>
    request<ApplyResult>("POST", `${device(id)}/looks/${seg(lookId)}/apply`, { targets }),
}
