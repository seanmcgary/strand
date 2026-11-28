import { afterEach, describe, expect, it, vi } from "vitest"
import { makeTestApp } from "../../test/testApp"
import { api, ApiError, request } from "./client"

function stubFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (typeof response === "function" ? response() : response))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("api", () => {
  // Fails if a client function calls a path or method the server does not serve.
  it("calls only routes the server serves", async () => {
    const t = makeTestApp()
    await t.app.ready()
    const fetchMock = stubFetch(() => json({}))
    const calls: Promise<unknown>[] = [
      api.listDevices(),
      api.discover(),
      api.probeHost("wled.local"),
      api.addDevice("wled.local"),
      api.removeDevice("dev1"),
      api.getInfo("dev1"),
      api.getState("dev1"),
      api.patchState("dev1", { on: true }),
      api.getConfig("dev1"),
      api.patchConfig("dev1", { def: { on: true } }),
      api.unlock("dev1", "1234"),
      api.getCapabilities("dev1"),
      api.getPins("dev1"),
      api.scanNetworks("dev1"),
      api.reboot("dev1"),
      api.getPendingReboot("dev1"),
      api.getEffects("dev1"),
      api.getPalettes("dev1"),
      api.getPreferences(),
      api.putPreference("k.1", { a: 1 }),
      api.getLights("dev1"),
      api.patchLights("dev1", { on: true }),
      api.patchStrand("dev1", "o0+o1", { on: true }),
      api.resolveShared("dev1", "o0+o1", "split"),
      api.flash("dev1", "o1", 5),
      api.getStrandGroups("dev1"),
      api.putStrandGroups("dev1", ["o0+o1"]),
      api.putStrandNames("dev1", { o0: "Desk" }),
      api.getScenes("dev1"),
      api.createScene("dev1", { name: "n", strandKey: "o0" }),
      api.renameScene("dev1", "s/1", "n"),
      api.deleteScene("dev1", "s/1"),
      api.applyScene("dev1", "s/1"),
      api.getLooks("dev1"),
      api.createLook("dev1", { name: "n", strandKey: "o0", range: "r" }),
      api.renameLook("dev1", "l/1", "n"),
      api.deleteLook("dev1", "l/1"),
      api.applyLook("dev1", "l/1", [{ strandKey: "o0" }]),
    ]
    await Promise.all(calls)

    expect(fetchMock.mock.calls).toHaveLength(Object.keys(api).length)
    for (const [url, init] of fetchMock.mock.calls) {
      const route = url
      .replace("/api/devices/dev1", "/api/devices/:id")
      .replace("/api/preferences/k.1", "/api/preferences/:key")
      .replace("/strands/o0%2Bo1", "/strands/:key")
      .replace("/scenes/s%2F1", "/scenes/:sceneId")
      .replace("/looks/l%2F1", "/looks/:lookId")
      const method = init?.method as "GET"
      expect(t.app.hasRoute({ method, url: route }), `${method} ${route}`).toBe(true)
    }
  })

  // Fails if a write drops the X-Strand-Request header or the JSON Content-Type.
  it("sends the request-guard and content-type headers on a write", async () => {
    const fetchMock = stubFetch(json({}))
    await api.addDevice("wled.local")

    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.headers).toEqual({ "X-Strand-Request": "1", "Content-Type": "application/json" })
    expect(init?.body).toBe(JSON.stringify({ host: "wled.local" }))
  })

  // Fails if a path segment is sent unencoded.
  it("encodes the device id in the path", async () => {
    const fetchMock = stubFetch(json({}))
    await api.getInfo("a/b")

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/devices/a%2Fb/info")
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

  // Fails if a 2xx reply that is not JSON throws a raw parser error instead of an ApiError.
  it("throws device_error for a non-JSON success reply", async () => {
    stubFetch(new Response("<html>", { status: 200 }))

    const err = await request("GET", "/api/x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 200, code: "device_error" })
  })

  // Fails if a 204 reply is parsed as JSON instead of resolving to undefined.
  it("resolves to undefined on 204", async () => {
    stubFetch(new Response(null, { status: 204 }))

    await expect(request("DELETE", "/api/x")).resolves.toBeUndefined()
  })
})
