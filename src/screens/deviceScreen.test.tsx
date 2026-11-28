// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Provider } from "react-redux"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { Device, LightsView, WledInfo } from "../../shared/apiTypes"
import { makeStore, reducers } from "@/store"
import { routes } from "@/router"
import { startFakeWled, type FakeWled } from "../../test/fakeWled"
import { seeds } from "../../test/fixtures/seeds"
import { psaves } from "../../test/lightsRuntime"
import { makeTestApp } from "../../test/testApp"

const realFetch = globalThis.fetch
// jsdom replaces AbortSignal, and Node's fetch rejects the replacement, so a device request gets its time limit from a race instead of a signal.
const withLimit = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))])

const backyard: Device = {
  id: "d1",
  name: "Backyard",
  host: "wled-backyard.local",
  port: 80,
  lastIp: "192.168.1.40",
  mac: "aabbccddeeff",
  online: true,
  lastSeen: "2026-11-24T10:00:00.000Z",
  pinLocked: false,
}
const view: LightsView = { on: true, bri: 128, strands: [], segments: { used: 0, max: 16 }, notices: [], matrix: false }
const info = (over: Partial<WledInfo> = {}) => ({ name: "Backyard", ip: "192.168.1.40", live: false, ...over })

type Reply = { status: number; body?: unknown }
type Route = (method: string, path: string, body: unknown) => Reply | undefined
interface Call {
  method: string
  path: string
  body: unknown
}

let calls: Call[]
let override: Route
let devices: Device[]
let gates: Record<string, Promise<void>>

/** The app server: the default replies, with `override` checked first. */
const server: Route = (method, path) => {
  if (method === "GET" && path === "/api/devices") return { status: 200, body: devices }
  if (method === "GET" && path === "/api/preferences") return { status: 200, body: {} }
  const m = path.match(/^\/api\/devices\/([^/]+)\/(.+)$/)
  if (!m) return undefined
  const [, , rest] = m
  if (method === "GET" && rest === "state") return { status: 200, body: { on: true, bri: 128, seg: [] } }
  if (method === "PATCH" && rest === "state") return { status: 200, body: { on: false, bri: 128, seg: [] } }
  if (method === "GET" && rest === "info") return { status: 200, body: info() }
  if (method === "GET" && rest === "pending-reboot") return { status: 200, body: [] }
  if (method === "GET" && rest === "lights") return { status: 200, body: view }
  if (method === "GET" && (rest === "effects" || rest === "palettes")) return { status: 200, body: [] }
  if (method === "POST" && rest === "reboot") return { status: 204 }
  return undefined
}

beforeEach(() => {
  calls = []
  override = () => undefined
  devices = [backyard]
  gates = {}
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    await gates[`${method} ${path}`]
    const r = override(method, path, body) ?? server(method, path, body) ?? { status: 404, body: { error: "not_found", message: "No route." } }
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flush = () => act(async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
})
const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length

// A plain MemoryRouter: a data router's navigations build a `Request` that rejects jsdom's AbortSignal.
async function open(path: string) {
  render(
    <Provider store={makeStore(reducers)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes.map((r, i) => (r.index ? <Route key={i} index element={r.element} /> : <Route key={i} path={r.path} element={r.element} />))}
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  await flush()
}

const tab = (name: string) => screen.getByRole("tab", { name })

// Fails if the device route, the header (name, status, host) or the tablist semantics are missing.
it("shows the device with three tabs and the Lights tab selected", async () => {
  await open("/devices/d1")
  expect(screen.getByRole("heading", { level: 1, name: "Backyard" })).toBeTruthy()
  expect(screen.getByText("Online")).toBeTruthy()
  expect(screen.getByText("wled-backyard.local")).toBeTruthy()
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Lights", "Presets", "Settings"])
  const lights = tab("Lights")
  expect(lights.getAttribute("aria-selected")).toBe("true")
  expect(lights.tabIndex).toBe(0)
  expect(tab("Presets").tabIndex).toBe(-1)
  const panel = screen.getByRole("tabpanel")
  expect(panel.id).toBe(lights.getAttribute("aria-controls"))
  expect(panel.getAttribute("aria-labelledby")).toBe(lights.id)
})

// Fails if the tablist's ArrowRight/End handling (with wrapping) does not open and focus the tab.
it("moves between tabs with the arrow keys, Home and End", async () => {
  await open("/devices/d1")
  tab("Lights").focus()
  fireEvent.keyDown(tab("Lights"), { key: "ArrowRight" })
  await flush()
  expect(tab("Presets").getAttribute("aria-selected")).toBe("true")
  expect(document.activeElement).toBe(tab("Presets"))
  fireEvent.keyDown(tab("Presets"), { key: "End" })
  await flush()
  expect(tab("Settings").getAttribute("aria-selected")).toBe("true")
  fireEvent.keyDown(tab("Settings"), { key: "ArrowRight" })
  await flush()
  expect(tab("Lights").getAttribute("aria-selected")).toBe("true")
  expect(document.activeElement).toBe(tab("Lights"))
})

// Fails if the tab is not read from `?tab=presets`.
it("selects Presets from the query", async () => {
  await open("/devices/d1?tab=presets")
  expect(tab("Presets").getAttribute("aria-selected")).toBe("true")
})

// Fails if the settings route or SettingsPanel's link to the device's own settings page is missing.
it("selects Settings on the settings path and links to the WLED settings page", async () => {
  await open("/devices/d1/settings")
  expect(tab("Settings").getAttribute("aria-selected")).toBe("true")
  const link = screen.getByRole("link", { name: "Open WLED Advanced UI" })
  expect(link.getAttribute("href")).toBe("http://wled-backyard.local/settings")
  expect(link.getAttribute("target")).toBe("_blank")
})

// Fails if an Advanced UI link drops a port other than 80 from the device's address.
it("keeps the device's port in both Advanced UI links", async () => {
  devices = [{ ...backyard, port: 8080 }]
  override = (method, path) => (method === "GET" && path === "/api/devices/d1/lights" ? { status: 200, body: { ...view, matrix: true } } : undefined)
  await open("/devices/d1")
  expect(screen.getByRole("link", { name: "Open WLED Advanced UI" }).getAttribute("href")).toBe("http://wled-backyard.local:8080/settings")
  cleanup()
  await open("/devices/d1/settings")
  expect(screen.getByRole("link", { name: "Open WLED Advanced UI" }).getAttribute("href")).toBe("http://wled-backyard.local:8080/settings")
  expect(screen.getByText("http://wled-backyard.local:8080/settings")).toBeTruthy()
})

// Fails if the Lights tab loads are not sent when it opens, or are not sent again when the user comes back to it.
it("loads the lights when the Lights tab opens and again on return", async () => {
  await open("/devices/d1")
  expect(count("GET", "/api/devices/d1/lights")).toBe(1)
  expect(count("GET", "/api/devices/d1/effects")).toBe(1)
  expect(count("GET", "/api/devices/d1/palettes")).toBe(1)
  expect(count("GET", "/api/preferences")).toBe(1)
  fireEvent.click(tab("Presets"))
  await flush()
  fireEvent.click(tab("Lights"))
  await flush()
  // One read each time a tab that shows the strands opens: Lights, Presets, Lights.
  expect(count("GET", "/api/devices/d1/lights")).toBe(3)
  expect(count("GET", "/api/preferences")).toBe(1)
})

// Fails if an ID missing from the device list does not show the not-found card.
it("shows a not-found card for an unknown device", async () => {
  await open("/devices/nope")
  expect(screen.getByText("This device isn't in Strand")).toBeTruthy()
  expect(screen.getByRole("link", { name: "Back to devices" }).getAttribute("href")).toBe("/")
})

// Fails if Retry does not re-read the device list, or the screen does not load the lights when the device comes online.
it("shows the offline banner, and Retry loads the lights once the device answers", async () => {
  devices = [{ ...backyard, online: false }]
  await open("/devices/d1")
  expect(screen.getByText("Backyard is offline")).toBeTruthy()
  expect(screen.queryByRole("switch")).toBeNull()
  expect(count("GET", "/api/devices/d1/lights")).toBe(0)
  devices = [backyard]
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await flush()
  expect(count("GET", "/api/devices/d1/lights")).toBe(1)
  expect(screen.queryByText("Backyard is offline")).toBeNull()
})

// Fails if `info.live` does not show the live-data banner.
it("shows the live-data banner", async () => {
  override = (method, path) => (method === "GET" && path === "/api/devices/d1/info" ? { status: 200, body: info({ live: true }) } : undefined)
  await open("/devices/d1")
  expect(screen.getByText("Receiving live data from another source. Changes may not be visible until it stops.")).toBeTruthy()
})

// Fails if "Reboot now" reboots without the confirm dialog, or the dialog's buttons do the wrong thing.
it("asks before rebooting for a pending change", async () => {
  override = (method, path) => (method === "GET" && path === "/api/devices/d1/pending-reboot" ? { status: 200, body: ["hostname"] } : undefined)
  await open("/devices/d1")
  expect(screen.getByText("The new hostname takes effect after a reboot.")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Reboot now" }))
  expect(screen.getByRole("dialog", { name: "Reboot Backyard?" })).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await flush()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(count("POST", "/api/devices/d1/reboot")).toBe(0)
  vi.useFakeTimers({ toFake: ["setTimeout"] })
  fireEvent.click(screen.getByRole("button", { name: "Reboot now" }))
  fireEvent.click(screen.getByRole("button", { name: "Reboot" }))
  await flush()
  expect(count("POST", "/api/devices/d1/reboot")).toBe(1)
})

// Fails if setPower is not optimistic, or a failed write does not roll the switch back and toast.
it("turns the lights off at once and rolls back with a toast on an error", async () => {
  let release!: () => void
  await open("/devices/d1")
  gates["PATCH /api/devices/d1/state"] = new Promise((r) => (release = r))
  override = (method, path) =>
    method === "PATCH" && path === "/api/devices/d1/state" ? { status: 504, body: { error: "device_offline", message: "Backyard didn't answer." } } : undefined
  const sw = screen.getByRole("switch", { name: "Turn Backyard off" })
  fireEvent.click(sw)
  await flush()
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ on: false })
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false")
  release()
  await flush()
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
  expect(screen.getByText("Couldn't change the lights")).toBeTruthy()
})

describe("seam", () => {
  let fake: FakeWled

  afterEach(async () => {
    await fake?.close()
  })

  type Seg = { n?: string; start: number; stop: number; grp?: number; spc?: number; frz?: boolean }
  const segs = () => fake.state.seg as Seg[]
  const o0 = () => segs().filter((s) => s.stop <= 150).map((s) => s.n)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const click = async (el: HTMLElement) => {
    fireEvent.click(el)
    await flush()
  }

  // Backyard on a real app server and a fake device; the browser's `/api` calls go to the server in process.
  async function boot() {
    const t = makeTestApp({ startupDelayMs: 50 })
    fake = await startFakeWled(seeds.backyard)
    const row = t.addFake(fake, seeds.backyard)
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
      // The server passes a (jsdom) URL object; Node's fetch takes its string.
      const url = String(input)
      if (!url.startsWith("/")) return withLimit(realFetch(url, { ...init, signal: undefined }), t.deps.config.deviceTimeoutMs)
      const res = await t.inject({ method: (init.method ?? "GET") as "GET", url, headers: init.headers as Record<string, string>, payload: init.body as string | undefined })
      return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: res.headers as Record<string, string> })
    })
    return row
  }
  const openRange = async (n: number) => {
    const header = screen.getByRole("button", { name: new RegExp(`^Range ${n} LEDs`) })
    if (header.getAttribute("aria-expanded") !== "true") await click(header)
  }
  const settle = (fn: () => void) => waitFor(fn, { timeout: 3000 })

  // Fails if a seam between the tabs, the store, the routes, the layout writer or the startup preset breaks.
  it("drives the lights and presets tabs against the server and a fake device", async () => {
    const row = await boot()
    render(
      <Provider store={makeStore(reducers)}>
        <MemoryRouter initialEntries={[`/devices/${row.id}`]}>
          <Routes>
            {routes.map((r, i) => (r.index ? <Route key={i} index element={r.element} /> : <Route key={i} path={r.path} element={r.element} />))}
          </Routes>
        </MemoryRouter>
      </Provider>,
    )
    await screen.findByText(/share one segment/)

    await click(screen.getByRole("button", { name: "Split by strand" }))
    await settle(() => expect(segs().map((s) => [s.start, s.stop])).toEqual([[0, 150], [150, 300]]))

    const far = JSON.stringify(segs().filter((s) => s.start >= 150))
    await click(screen.getByRole("button", { name: "Add range" }))
    await settle(() => expect(o0()).toContain("Range 2"))
    expect(segs().find((s) => s.n === "Range 2")!.stop).toBeLessThanOrEqual(150)
    expect(JSON.stringify(segs().filter((s) => s.start >= 150))).toBe(far)

    await openRange(1)
    await click(screen.getByRole("button", { name: "Every N" }))
    await settle(() => expect(o0().sort()).toEqual(["Range 1 1/2", "Range 1 2/2", "Range 2"]))
    for (const s of segs().filter((x) => x.n?.startsWith("Range 1 "))) expect([s.grp, s.spc]).toEqual([1, 1])

    await sleep(200)
    // A slow step can let the 50 ms timer fire between two writes, so the count is not pinned.
    await settle(() => expect(psaves(fake).length).toBeGreaterThan(0))
    expect((psaves(fake).at(-1)!.body as { bootps?: number }).bootps).toBe(250)
    expect(Object.keys(await (await realFetch(`http://127.0.0.1:${fake.port}/presets.json`)).json())).toContain("250")

    await click(screen.getByRole("tab", { name: "Presets" }))
    await click(await screen.findByRole("button", { name: /^Save scene/ }))
    const dlg = () => screen.getByRole("dialog")
    fireEvent.change(within(dlg()).getByLabelText("Name"), { target: { value: "Two" } })
    await click(within(dlg()).getByRole("button", { name: "Save scene" }))
    await screen.findByText("Saved Two")

    await click(screen.getByRole("tab", { name: "Lights" }))
    fireEvent.keyDown(screen.getByRole("button", { name: "Range 1 options" }), { key: "Enter" })
    await click(await screen.findByRole("menuitem", { name: "Merge with next" }))
    await settle(() => expect(segs().find((s) => s.n === "Range 1 1/2")?.stop).toBe(150))

    await click(screen.getByRole("tab", { name: "Presets" }))
    await click(await screen.findByRole("button", { name: "Apply" }))
    await screen.findByText("Applied Two")
    expect(o0().sort()).toEqual(["Range 1 1/2", "Range 1 2/2", "Range 2"])

    await click(screen.getByRole("tab", { name: "Lights" }))
    await openRange(2)
    await click(screen.getAllByRole("button", { name: "Individual" }).at(-1)!)
    await click(await screen.findByRole("button", { name: "Fill range" }))
    await settle(() => expect(segs().find((s) => s.n === "Range 2 paint")?.frz).toBe(true))
    const id = segs().findIndex((s) => s.n === "Range 2 paint")
    const px = fake.pixels(id)
    expect(px.length).toBeGreaterThan(0)
    expect(new Set(px.map((c) => c?.toUpperCase().replace("#", "")))).toEqual(new Set(["FF8800"]))

    fake.setMode("timeout")
    const handle = screen.getByRole("slider", { name: /^Boundary between/ })
    const before = handle.getAttribute("aria-valuenow")
    fireEvent.keyDown(handle, { key: "ArrowRight" })
    await screen.findByText("Couldn't change the lights", {}, { timeout: 3000 })
    await settle(() => expect(screen.getByRole("slider", { name: /^Boundary between/ }).getAttribute("aria-valuenow")).toBe(before))
  }, 30_000)
})
