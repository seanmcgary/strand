// @vitest-environment jsdom
import "@/lib/reactCompat"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import type { LightsView, RangeView, StrandPatch } from "../../../shared/apiTypes"
import { LOCKED, needMsg } from "@/lights/model"
import { allRange, device, lights, slot, strand, view } from "../../../test/lightsView"
import { LightsTab, type LightsActions } from "./lightsTab"

beforeAll(() => {
  // jsdom has no ResizeObserver, which Radix's popper needs to open the menu.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(cleanup)

const prefs = { recentColors: [], favoriteEffects: [], loaded: true }

function renderTab(v: LightsView) {
  const actions: LightsActions = {
    editStrand: vi.fn(() => true),
    selectStrand: vi.fn(),
    selectRange: vi.fn(),
    resolveShared: vi.fn(),
    loadLights: vi.fn(),
    toast: vi.fn(),
    flashLed: vi.fn(),
    setStrandGroups: vi.fn(() => ({ unwrap: () => Promise.resolve() })),
    setStrandName: vi.fn(() => ({ unwrap: () => Promise.resolve() })),
    loadOutputs: vi.fn(),
    loadFxLists: vi.fn(),
    pushRecentColor: vi.fn(),
    toggleFavoriteEffect: vi.fn(),
    beginPaint: vi.fn(),
    paintCells: vi.fn(),
    endPaint: vi.fn(),
  }
  render(<LightsTab device={device} offline={false} lights={lights(v)} strand={v.strands[0] ?? null} prefs={prefs} actions={actions} />)
  return actions
}

/** The text of the element that describes `el`. */
const desc = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent

const every = (n: number, group: number, len: number): RangeView => ({
  ...allRange("Patio", 0, len),
  pattern: { kind: "every", n, group },
  slots: Array.from({ length: n }, (_, k) => slot([k * 10, 0, 0])),
})

const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name: `${name} options` }), { key: "Enter" })

// Fails if the N stepper stops taking its reason from stepReasons' 16-slot limit.
it("explains why N can't go above 16", () => {
  renderTab(view([strand("o0", "Strand 1", 120, [every(16, 1, 120)])]))
  const up = screen.getAllByRole("button", { name: "More slots" })[0]!
  expect(up.getAttribute("aria-disabled")).toBe("true")
  expect(desc(up)).toBe("A range can have at most 16 slots.")
})

// Fails if the N stepper ignores the range length (Review Focus 1).
it("explains why a short range can't take another slot", () => {
  renderTab(view([strand("o0", "Strand 1", 4, [every(2, 2, 4)])]))
  expect(desc(screen.getByRole("button", { name: "More slots" }))).toBe("This range is too short for another slot.")
})

// Fails if the pattern buttons stop taking their reason from kindReason.
it("disables Every N when no segment is free", () => {
  renderTab(view([strand("o0", "Strand 1", 120, [allRange("Patio", 0, 120)])], { segments: { used: 32, max: 32 } }))
  const btn = screen.getByRole("button", { name: "Every N" })
  expect(btn.getAttribute("aria-disabled")).toBe("true")
  expect(desc(btn)).toBe(needMsg(1, 0))
})

// Fails if Delete stops merging into the previous range, drops its toast, or leaves focus in the closed menu.
it("deletes a range into the previous one and focuses that range's header", async () => {
  const a = renderTab(view([strand("o0", "Strand 1", 120, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 60)])]))
  openMenu("Kitchen")
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
  const patch = vi.mocked(a.editStrand).mock.calls[0]![0].patch as StrandPatch
  expect(patch.ranges!.map((r) => [r.name, r.start, r.len])).toEqual([["Patio", 0, 120]])
  expect(a.toast).toHaveBeenCalledWith("info", "Deleted Kitchen", "Its LEDs are part of Patio now.")
  await act(() => new Promise((r) => setTimeout(() => setTimeout(r))))
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Patio LEDs/ }))
})

// Fails if Rename on a shared strand loses its lock reason or still opens the dialog.
it("locks Rename on a shared strand", () => {
  renderTab(view([strand("o0", "Strand 1", 60, [allRange("Patio", 0, 60)], { shared: { with: ["o1"] } })]))
  openMenu("Patio")
  const item = screen.getByRole("menuitem", { name: /Rename/ })
  expect(desc(item)).toBe(LOCKED)
  fireEvent.click(item)
  expect(screen.queryByRole("dialog")).toBeNull()
})

// Fails if Flash end sends the range's first LED, or one past its last.
it("flashes the first and the last LED of a range", () => {
  const a = renderTab(view([strand("o0", "Strand 1", 120, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 60)])]))
  fireEvent.click(screen.getAllByRole("button", { name: "Flash the first LED of Kitchen" })[0]!)
  fireEvent.click(screen.getAllByRole("button", { name: "Flash the last LED of Patio" })[0]!)
  expect(vi.mocked(a.flashLed).mock.calls.map((c) => c[0])).toEqual([
    { id: "d1", key: "o0", led: 60 },
    { id: "d1", key: "o0", led: 59 },
  ])
})
