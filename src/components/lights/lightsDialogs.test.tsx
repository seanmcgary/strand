// @vitest-environment jsdom
import "@/lib/reactCompat"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Provider } from "react-redux"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
import type { LightsView } from "../../../shared/apiTypes"
import { routes } from "@/router"
import { makeStore, reducers } from "@/store"
import { allRange, device, strand, view } from "../../../test/lightsView"
import { stubResizeObserver } from "../../../test/renderTab"

/** The dialogs run against the whole device screen and its store, with `fetch` as the app server. */

type Reply = { status: number; body?: unknown }
interface Call {
  method: string
  path: string
  body: unknown
}

let calls: Call[]
let lv: LightsView
let replies: Record<string, Reply>
let gates: Record<string, Promise<void>>

beforeAll(stubResizeObserver)

beforeEach(() => {
  calls = []
  replies = {}
  gates = {}
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    await gates[`${method} ${path}`]
    const r = replies[`${method} ${path}`] ?? reply(method, path)
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function reply(method: string, path: string): Reply {
  if (path === "/api/devices") return { status: 200, body: [device] }
  if (path === "/api/preferences") return { status: 200, body: {} }
  const rest = path.replace("/api/devices/d1/", "")
  if (method === "GET" && rest === "state") return { status: 200, body: { on: true, bri: 128, seg: [] } }
  if (method === "GET" && rest === "info") return { status: 200, body: { name: "Backyard", ip: "192.168.1.40", live: false } }
  if (method === "GET" && rest === "pending-reboot") return { status: 200, body: [] }
  if (method === "GET" && rest === "lights") return { status: 200, body: lv }
  if (method === "GET" && (rest === "effects" || rest === "palettes")) return { status: 200, body: [] }
  return { status: 404, body: { error: "not_found", message: "No route." } }
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

async function open(v: LightsView) {
  lv = v
  render(
    <Provider store={makeStore(reducers)}>
      <MemoryRouter initialEntries={["/devices/d1"]}>
        <Routes>
          {routes.map((r, i) => (r.index ? <Route key={i} index element={r.element} /> : <Route key={i} path={r.path} element={r.element} />))}
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  await flush()
}

const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name: `${name} options` }), { key: "Enter" })
const writes = () => calls.filter((c) => c.method !== "GET")

const patioKitchen = view([strand("o0", "Strand 1", 120, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 60)])])

// Fails if the range rename dialog stops checking names against the strand's other ranges, or stops returning focus to the range's menu button.
it("refuses a range name another range has, and returns focus to the menu button", async () => {
  await open(patioKitchen)
  openMenu("Kitchen")
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
  const dialog = screen.getByRole("dialog", { name: "Rename range" })
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Patio" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
  expect(within(dialog).getByRole("alert").textContent).toBe("Another range on this strand has that name.")
  expect(writes()).toEqual([])
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await flush()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kitchen options" }))
})

// Fails if a rejected strand rename closes the dialog or hides the server's message.
it("shows the server's message when a strand rename is refused", async () => {
  await open(patioKitchen)
  replies["PUT /api/devices/d1/strand-names"] = { status: 400, body: { error: "invalid_name", message: "Names need 1 to 64 characters." } }
  openMenu("Strand 1")
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename strand" }))
  const dialog = screen.getByRole("dialog", { name: "Rename strand" })
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Eaves" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
  await flush()
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ names: { o0: "Eaves" } })
  expect(within(screen.getByRole("dialog", { name: "Rename strand" })).getByRole("alert").textContent).toBe("Names need 1 to 64 characters.")
})

// Fails if the pair radios lose their roving focus, or Combine stops sending the new group or its toast.
it("combines the pair picked with the arrow keys", async () => {
  const three = view([
    strand("o0", "Strand 1", 50, [allRange("A", 0, 50)]),
    strand("o1", "Strand 2", 50, [allRange("B", 50, 50)], { start: 50, pins: [4] }),
    strand("o2", "Strand 3", 50, [allRange("C", 100, 50)], { start: 100, pins: [5] }),
  ])
  await open(three)
  replies["PUT /api/devices/d1/strand-groups"] = {
    status: 200,
    body: view([three.strands[0]!, strand("o1+o2", "Strand 2 + Strand 3", 100, [allRange("B", 50, 50), allRange("C", 100, 50)], { start: 50 })]),
  }
  fireEvent.click(screen.getByRole("button", { name: "Combine…" }))
  const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio")
  expect(radios).toHaveLength(2)
  fireEvent.keyDown(radios[0]!, { key: "ArrowDown" })
  expect(radios[1]!.getAttribute("aria-checked")).toBe("true")
  expect(document.activeElement).toBe(radios[1])
  expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0])
  fireEvent.click(screen.getByRole("button", { name: "Combine" }))
  await flush()
  expect(calls.find((c) => c.method === "PUT")).toEqual({ method: "PUT", path: "/api/devices/d1/strand-groups", body: { keys: ["o1+o2"] } })
  expect(screen.getByText("Combined Strand 2 and Strand 3")).toBeTruthy()
})

const joined = view([
  strand("o0+o1", "Strand 1 + Strand 2", 300, [allRange("Left", 0, 100), allRange("Middle", 100, 100), allRange("Right", 200, 100)], { pins: [2, 4] }),
])
const config = { hw: { led: { ins: [0, 150].map((start, k) => ({ type: 22, pin: [2 + 2 * k], start, len: 150, order: 0, rev: false, skip: 0, ledma: 55 })) } } }

const openSeparate = () => {
  openMenu("Strand 1 + Strand 2")
  fireEvent.click(screen.getByRole("menuitem", { name: "Separate" }))
  return screen.getByRole("dialog", { name: "Separate Strand 1 + Strand 2?" })
}

// Fails if the separate dialog stops loading the outputs on open, or stops listing the ranges cutRanges finds.
it("loads the outputs, then lists the range the join cuts", async () => {
  await open(joined)
  replies["GET /api/devices/d1/config"] = { status: 200, body: config }
  let release = () => {}
  gates["GET /api/devices/d1/config"] = new Promise((r) => (release = r))
  const dialog = openSeparate()
  await flush()
  expect(dialog.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  expect((within(dialog).getByRole("button", { name: "Separate" }) as HTMLButtonElement).disabled).toBe(true)
  release()
  await flush()
  expect(within(dialog).getByText("This range crosses the join and will be cut in two:")).toBeTruthy()
  expect(within(dialog).getByText("Middle")).toBeTruthy()
  expect((within(dialog).getByRole("button", { name: "Separate" }) as HTMLButtonElement).disabled).toBe(false)
})

// Fails if a failed outputs load hides its message, drops Try again, or leaves Separate enabled.
it("shows the outputs error with Try again", async () => {
  await open(joined)
  replies["GET /api/devices/d1/config"] = { status: 502, body: { error: "device_offline", message: "The device didn't answer." } }
  const dialog = openSeparate()
  await flush()
  expect(within(dialog).getByRole("alert").textContent).toBe("The device didn't answer.")
  expect((within(dialog).getByRole("button", { name: "Separate" }) as HTMLButtonElement).disabled).toBe(true)
  replies["GET /api/devices/d1/config"] = { status: 200, body: config }
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }))
  await flush()
  expect(within(dialog).getByText("Middle")).toBeTruthy()
})

// Fails if a strand whose outputs are missing from the device's config crashes the Separate dialog instead of showing Try again.
it("shows the changed-outputs error when the device has fewer outputs than the strand", async () => {
  await open(joined)
  replies["GET /api/devices/d1/config"] = { status: 200, body: { hw: { led: { ins: [config.hw.led.ins[0]] } } } }
  const dialog = openSeparate()
  await flush()
  expect(within(dialog).getByRole("alert").textContent).toBe("The LED outputs changed. Try again.")
  expect((within(dialog).getByRole("button", { name: "Separate" }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).getByRole("button", { name: "Try again" })).toBeTruthy()
})

// Fails if confirming Separate stops sending the group list without the key, closing the dialog, or toasting.
it("separates the strand and toasts", async () => {
  await open(joined)
  const two = view([
    strand("o0", "Strand 1", 150, [allRange("Left", 0, 150)]),
    strand("o1", "Strand 2", 150, [allRange("Right", 150, 150)], { start: 150, pins: [4] }),
  ])
  replies["GET /api/devices/d1/config"] = { status: 200, body: config }
  replies["PUT /api/devices/d1/strand-groups"] = { status: 200, body: two }
  const dialog = openSeparate()
  await flush()
  fireEvent.click(within(dialog).getByRole("button", { name: "Separate" }))
  await flush()
  expect(calls.find((c) => c.method === "PUT")).toEqual({ method: "PUT", path: "/api/devices/d1/strand-groups", body: { keys: [] } })
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByText("Strands separated")).toBeTruthy()
})
