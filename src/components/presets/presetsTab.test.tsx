// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Provider } from "react-redux"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { LightsView, LookRecord, Scene } from "../../../shared/apiTypes"
import { allRange, device, slot, strand, view } from "../../../test/lightsView"
import { routes } from "@/router"
import { makeStore, reducers } from "@/store"

type Reply = { status: number; body?: unknown }
interface Call {
  method: string
  path: string
  body: unknown
}

const NOW = "2026-11-24T10:00:00.000Z"
const scene = (id: string, name: string, over: Partial<Scene> = {}): Scene => ({
  id,
  name,
  strandKey: "o0",
  ledCount: 150,
  summary: "2 ranges · 50%",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})
const look = (id: string, name: string): LookRecord => ({
  id,
  name,
  look: { pattern: { kind: "all" }, slots: [slot([255, 0, 0], { fxName: "Chase" })] },
  createdAt: NOW,
  updatedAt: NOW,
})
const two = view([strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90)]), strand("o1", "Strand 2", 100, [allRange("Fence", 0, 100)], { start: 150 })])

let calls: Call[]
let lightsView: LightsView
let scenes: Scene[]
let looks: LookRecord[]
let override: (method: string, path: string) => Reply | undefined

beforeAll(() => {
  // jsdom has no ResizeObserver, which Radix's popper needs to open a menu.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
beforeEach(() => {
  calls = []
  lightsView = two
  scenes = []
  looks = []
  override = () => undefined
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const r = override(method, path) ?? serve(method, path)
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function serve(method: string, path: string): Reply {
  if (path === "/api/devices") return { status: 200, body: [device] }
  if (path === "/api/preferences") return { status: 200, body: {} }
  const rest = path.replace("/api/devices/d1/", "")
  if (method === "GET" && rest === "lights") return { status: 200, body: lightsView }
  if (method === "GET" && rest === "scenes") return { status: 200, body: scenes }
  if (method === "GET" && rest === "looks") return { status: 200, body: looks }
  if (method === "GET" && rest === "state") return { status: 200, body: { on: true, bri: 128, seg: [] } }
  if (method === "GET" && rest === "info") return { status: 200, body: { name: "Backyard", ip: "192.168.1.40", live: false } }
  if (method === "GET" && rest === "pending-reboot") return { status: 200, body: [] }
  if (method === "GET") return { status: 200, body: [] }
  if (method === "DELETE") return { status: 204 }
  if (method === "POST" && rest === "scenes") return { status: 201, body: scene("s9", "Party") }
  if (method === "PATCH") return { status: 200, body: { ...scenes[0], ...looks[0], name: "Renamed" } }
  if (method === "POST" && rest.endsWith("/apply")) return { status: 200, body: { view: lightsView, warnings: [] } }
  return { status: 404, body: { error: "not_found", message: "No route." } }
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length
const last = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.path.endsWith(suffix)).at(-1)
const busy = (status: number, error: string, message: string) => () => ({ status, body: { error, message } })

async function open(path = "/devices/d1?tab=presets") {
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
const click = async (el: HTMLElement) => {
  fireEvent.click(el)
  await flush()
}
const type = async (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
  await flush()
}
const menu = async (name: string, item: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: `${name} options` }), { key: "Enter" })
  await click(screen.getByRole("menuitem", { name: item }))
}
const desc = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent
const dialog = () => screen.getByRole("dialog")

// Fails if the tab stops loading on open, or a switch back to it stops reloading.
it("loads scenes and looks when the tab opens and again on switching back", async () => {
  await open()
  expect([count("GET", "/api/devices/d1/scenes"), count("GET", "/api/devices/d1/looks")]).toEqual([1, 1])
  await click(screen.getByRole("tab", { name: "Lights" }))
  await click(screen.getByRole("tab", { name: "Presets" }))
  expect(count("GET", "/api/devices/d1/scenes")).toBe(2)
})

// Fails if either empty state loses its text.
it("explains an empty scenes list and an empty looks list", async () => {
  await open()
  expect(screen.getByText("No scenes yet. Save the current strand setup to come back to it.")).toBeTruthy()
  expect(screen.getByText("No looks yet. Save a range's colors and effects to use them on any strand.")).toBeTruthy()
})

// Fails if Save scene or Save look stays usable on a device with no strands.
it("locks both save buttons on a device with no strands", async () => {
  lightsView = view([], { matrix: true })
  await open()
  for (const name of [/^Save scene/, /^Save look/]) {
    const b = screen.getByRole("button", { name })
    expect(b.getAttribute("aria-disabled")).toBe("true")
    expect(desc(b)).toBe("There are no strands on this device.")
  }
})

// Fails if an empty name sends a request, or the save stops sending the selected strand and toasting.
it("saves a scene from the selected strand and toasts", async () => {
  await open()
  await click(screen.getByRole("button", { name: /^Save scene/ }))
  await click(within(dialog()).getByRole("button", { name: "Save scene" }))
  expect(within(dialog()).getByText("Give the scene a name.")).toBeTruthy()
  expect(calls.some((c) => c.method === "POST")).toBe(false)
  await type("Name", "Party")
  await click(within(dialog()).getByRole("button", { name: "Save scene" }))
  expect(last("POST", "/scenes")?.body).toEqual({ name: "Party", strandKey: "o0" })
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByText("Saved Party")).toBeTruthy()
})

// Fails if a server refusal stops showing under the name field as an alert, or closes the dialog.
it("shows the server's refusal of a name in the save dialog", async () => {
  override = (m, p) => (m === "POST" && p.endsWith("/scenes") ? busy(422, "invalid_name", "Names need 1 to 64 characters.")() : undefined)
  await open()
  await click(screen.getByRole("button", { name: /^Save scene/ }))
  await type("Name", "x")
  await click(within(dialog()).getByRole("button", { name: "Save scene" }))
  expect(within(dialog()).getByRole("alert").textContent).toBe("Names need 1 to 64 characters.")
})

// Fails if the look range select stops offering painted ranges as disabled with the reason.
it("disables a painted range in the save look dialog", async () => {
  lightsView = view([strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), { ...allRange("Paint", 60, 90), pattern: { kind: "individual" } }])])
  await open()
  await click(screen.getByRole("button", { name: /^Save look/ }))
  const painted = within(dialog()).getByRole("option", { name: /Paint · .* \(painted LEDs can't be a look\)/ }) as HTMLOptionElement
  expect(painted.disabled).toBe(true)
  await type("Name", "Candy")
  await click(within(dialog()).getByRole("button", { name: "Save look" }))
  expect(last("POST", "/looks")?.body).toEqual({ name: "Candy", strandKey: "o0", range: "Patio" })
})

// Fails if the warnings stop joining into the toast description, or a 504 stops toasting and re-reading the lights.
it("toasts a scene apply's warnings, and its failure with a lights re-read", async () => {
  scenes = [scene("s1", "Evening")]
  override = (m, p) => (m === "POST" && p.endsWith("/apply") ? { status: 200, body: { view: lightsView, warnings: ["W1", "W2"] } } : undefined)
  await open()
  await click(screen.getByRole("button", { name: "Apply" }))
  expect(screen.getByText("Applied Evening")).toBeTruthy()
  expect(screen.getByText("W1 W2")).toBeTruthy()

  override = (m, p) => (m === "POST" && p.endsWith("/apply") ? busy(504, "device_offline", "The controller didn't answer.")() : undefined)
  const before = count("GET", "/api/devices/d1/lights")
  await click(screen.getByRole("button", { name: "Apply" }))
  expect(screen.getByText("Couldn't change the lights")).toBeTruthy()
  expect(screen.getByText("The controller didn't answer.")).toBeTruthy()
  expect(count("GET", "/api/devices/d1/lights")).toBe(before + 1)
})

// Fails if a scene saved at another LED count applies without the warning, or "Apply anyway" does not send it.
it("asks before applying a scene saved at another LED count", async () => {
  scenes = [scene("s1", "Evening", { ledCount: 200 })]
  await open()
  expect(screen.getByText("LED count changed")).toBeTruthy()
  await click(screen.getByRole("button", { name: "Apply" }))
  expect(dialog().textContent).toContain("Apply Evening?")
  expect(dialog().textContent).toContain("Strand fits its ranges to the new length: ranges past the end are cut.")
  expect(calls.some((c) => c.method === "POST")).toBe(false)
  await click(within(dialog()).getByRole("button", { name: "Apply anyway" }))
  expect(last("POST", "/scenes/s1/apply")).toBeTruthy()
})

// Fails if a scene whose strand is gone stays applicable, or loses its badge and reason.
it("locks Apply on a scene whose strand is not on the controller", async () => {
  scenes = [scene("s1", "Evening", { strandKey: "o5" })]
  await open()
  expect(screen.getByText("Strand not found")).toBeTruthy()
  const b = screen.getByRole("button", { name: "Apply" })
  expect(b.getAttribute("aria-disabled")).toBe("true")
  expect(desc(b)).toBe("This scene's strand isn't on the controller any more, or those strands aren't combined now.")
  fireEvent.click(b)
  expect(calls.some((c) => c.method === "POST")).toBe(false)
})

// Fails if the strand checkbox stops mixing, or the targets, toast, or failure path of Apply to... change.
it("applies a look to one range, and keeps the dialog open on a failure", async () => {
  looks = [look("l1", "Candy")]
  await open()
  await click(screen.getByRole("button", { name: "Apply to…" }))
  const strandBox = within(dialog()).getByRole("checkbox", { name: /Strand 1/ })
  expect(strandBox.getAttribute("aria-checked")).toBe("false")
  await click(within(dialog()).getByRole("checkbox", { name: /Patio/ }))
  expect(strandBox.getAttribute("aria-checked")).toBe("mixed")

  override = (m, p) => (m === "POST" && p.endsWith("/apply") ? busy(404, "not_found", "That range was deleted.")() : undefined)
  const before = count("GET", "/api/devices/d1/lights")
  await click(within(dialog()).getByRole("button", { name: "Apply to 1 range" }))
  expect(last("POST", "/looks/l1/apply")?.body).toEqual({ targets: [{ strandKey: "o0", range: "Patio" }] })
  expect(within(dialog()).getByRole("alert").textContent).toBe("That range was deleted.")
  expect(count("GET", "/api/devices/d1/lights")).toBe(before + 1)

  override = () => undefined
  await click(within(dialog()).getByRole("button", { name: "Apply to 1 range" }))
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByText("Applied Candy")).toBeTruthy()
  expect(screen.getByText("Changed 1 range.")).toBeTruthy()
})

// Fails if a shared strand stops being locked in the Apply to... tree.
it("disables a shared strand in the apply tree with its explanation", async () => {
  lightsView = view([strand("o0", "Strand 1", 150, [allRange("Patio", 0, 150)], { shared: { with: ["o1"] } }), strand("o1", "Strand 2", 100, [allRange("Fence", 0, 100)], { start: 150 })])
  looks = [look("l1", "Candy")]
  await open()
  await click(screen.getByRole("button", { name: "Apply to…" }))
  const box = within(dialog()).getByRole("checkbox", { name: /Strand 1/ }) as HTMLButtonElement
  expect(box.disabled).toBe(true)
  expect(within(dialog()).getByText(/Shares a segment with another strand/)).toBeTruthy()
})

// Fails if a rename refusal stops showing under the field or closes the dialog.
it("keeps the rename dialog open with the server's message", async () => {
  looks = [look("l1", "Candy")]
  override = (m) => (m === "PATCH" ? busy(422, "invalid_name", "Names need 1 to 64 characters.")() : undefined)
  await open()
  await menu("Candy", "Rename")
  await type("Name", "Rave")
  await click(within(dialog()).getByRole("button", { name: "Save" }))
  expect(within(dialog()).getByRole("alert").textContent).toBe("Names need 1 to 64 characters.")
})

// Fails if Delete skips the confirmation, starts focus anywhere but Cancel, deletes on Cancel, or drops the failure toast.
it("confirms a delete, with Cancel focused first, and toasts the outcome", async () => {
  scenes = [scene("s1", "Evening")]
  await open()
  await menu("Evening", "Delete")
  expect(dialog().textContent).toContain("Delete Evening?")
  expect(dialog().textContent).toContain("The scene is removed from Strand. The lights don't change.")
  expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Cancel" }))
  await click(within(dialog()).getByRole("button", { name: "Cancel" }))
  expect(calls.some((c) => c.method === "DELETE")).toBe(false)

  override = (m) => (m === "DELETE" ? busy(504, "device_offline", "No answer.")() : undefined)
  await menu("Evening", "Delete")
  await click(within(dialog()).getByRole("button", { name: "Delete" }))
  expect(screen.getByText("Couldn't delete Evening")).toBeTruthy()

  override = () => undefined
  await click(within(dialog()).getByRole("button", { name: "Delete" }))
  expect(last("DELETE", "/scenes/s1")).toBeTruthy()
  expect(screen.getByText("Deleted Evening")).toBeTruthy()
  expect(screen.queryByText("Evening", { selector: "span.truncate" })).toBeNull()
})
