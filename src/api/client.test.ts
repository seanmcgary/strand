import { afterEach, describe, expect, it, vi } from "vitest"
import { api, ApiError, request } from "./client"

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("api", () => {
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ["listDevices", () => api.listDevices(), "GET", "/api/devices", undefined],
    ["discover", () => api.discover(), "GET", "/api/discovery", undefined],
    ["probeHost", () => api.probeHost("wled.local"), "POST", "/api/devices/probe", { host: "wled.local" }],
    ["addDevice", () => api.addDevice("wled.local"), "POST", "/api/devices", { host: "wled.local" }],
    ["removeDevice", () => api.removeDevice("a/b"), "DELETE", "/api/devices/a%2Fb", undefined],
    ["getInfo", () => api.getInfo("a/b"), "GET", "/api/devices/a%2Fb/info", undefined],
    ["getState", () => api.getState("a/b"), "GET", "/api/devices/a%2Fb/state", undefined],
    ["patchState", () => api.patchState("a/b", { on: true, bri: 9 }), "PATCH", "/api/devices/a%2Fb/state", { on: true, bri: 9 }],
    ["getConfig", () => api.getConfig("a/b"), "GET", "/api/devices/a%2Fb/config", undefined],
    ["patchConfig", () => api.patchConfig("a/b", { def: { on: true } }), "PATCH", "/api/devices/a%2Fb/config", { def: { on: true } }],
    ["unlock", () => api.unlock("a/b", "1234"), "POST", "/api/devices/a%2Fb/unlock", { pin: "1234" }],
    ["getCapabilities", () => api.getCapabilities("a/b"), "GET", "/api/devices/a%2Fb/capabilities", undefined],
    ["getPins", () => api.getPins("a/b"), "GET", "/api/devices/a%2Fb/pins", undefined],
    ["scanNetworks", () => api.scanNetworks("a/b"), "POST", "/api/devices/a%2Fb/networks/scan", undefined],
    ["reboot", () => api.reboot("a/b"), "POST", "/api/devices/a%2Fb/reboot", undefined],
    ["getPendingReboot", () => api.getPendingReboot("a/b"), "GET", "/api/devices/a%2Fb/pending-reboot", undefined],
    ["getEffects", () => api.getEffects("a/b"), "GET", "/api/devices/a%2Fb/effects", undefined],
    ["getPalettes", () => api.getPalettes("a/b"), "GET", "/api/devices/a%2Fb/palettes", undefined],
    ["getPreferences", () => api.getPreferences(), "GET", "/api/preferences", undefined],
    ["putPreference", () => api.putPreference("k.1", { a: 1 }), "PUT", "/api/preferences/k.1", { value: { a: 1 } }],
  ]

  // Fails if a client function sends the wrong method, path or body, or leaves a path segment unencoded.
  it.each(cases)("%s", async (_name, call, method, path, body) => {
    const fetchMock = stubFetch(json({}))
    await call()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(path)
    expect(init?.method).toBe(method)
    expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body))
    const headers = init?.headers as Record<string, string>
    expect(headers["X-Strand-Request"]).toBe("1")
    expect(headers["Content-Type"]).toBe(body === undefined ? undefined : "application/json")
  })
})

describe("request", () => {
  // Fails if an error body's { error, message } is not carried onto ApiError.
  it("throws ApiError with the code and message of an error body", async () => {
    stubFetch(json({ error: "pin_required", message: "m" }, 401))

    const err = await request("GET", "/api/x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: "pin_required", message: "m" })
  })

  // Fails if a non-JSON error reply (a proxy's HTML page) is not turned into a generic device_error.
  it("throws a generic device_error for a non-JSON error reply", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }))

    const err = await request("GET", "/api/x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 502, code: "device_error" })
    expect((err as ApiError).message).not.toContain("<html>")
    expect((err as ApiError).message.length).toBeGreaterThan(0)
  })

  // Fails if a 204 reply is parsed as JSON instead of resolving to undefined.
  it("resolves to undefined on 204", async () => {
    stubFetch(new Response(null, { status: 204 }))

    await expect(request("DELETE", "/api/x")).resolves.toBeUndefined()
  })
})
