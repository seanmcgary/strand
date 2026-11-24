// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { LightsView } from "../../../shared/apiTypes"
import { allRange, device, lights, strand, view } from "../../../test/lightsView"
import { LightsTab, type LightsActions } from "./lightsTab"

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
  }
  render(<LightsTab device={device} offline={false} lights={lights(v)} strand={v.strands[0] ?? null} prefs={prefs} actions={actions} />)
  return actions
}

const one = view([strand("o0", "Strand 1", 120, [allRange("Patio", 0, 120)])], { segments: { used: 7, max: 32 } })

// Fails if the strand picker shows for a device with one strand.
it("hides the strand picker on a single-strand device", () => {
  renderTab(one)
  expect(screen.queryByRole("group", { name: "Strands" })).toBeNull()
})

// Fails if the segment count stops reading the view's segments.
it("shows the view's segment count", () => {
  renderTab(one)
  expect(screen.getByText("Segments used 7 of 32")).toBeTruthy()
})

// Fails if the brightness slider stops calling editStrand on every input event.
it("sends the strand brightness on every input while dragging", () => {
  const a = renderTab(one)
  const slider = screen.getByRole("slider", { name: "Strand 1 brightness" })
  for (const v of [100, 120, 140]) fireEvent.input(slider, { target: { value: String(v) } })
  expect(vi.mocked(a.editStrand).mock.calls.map(([c]) => c.patch.bri)).toEqual([100, 120, 140])
})

// Fails if a shared strand loses its banner, the banner's split action, or Add range's lock reason.
it("locks a shared strand behind Split by strand or Combine strands", () => {
  const v = view([
    strand("o0", "Strand 1", 60, [allRange("Patio", 0, 30), allRange("Porch", 30, 30)], { shared: { with: ["o1"] } }),
    strand("o1", "Strand 2", 60, [allRange("Fence", 0, 60)], { start: 60, shared: { with: ["o0"] } }),
  ])
  const a = renderTab(v)
  expect(screen.getByText("Strand 1 and Strand 2 share one segment.")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Combine strands" })).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Split by strand" }))
  expect(a.resolveShared).toHaveBeenCalledWith({ id: "d1", key: "o0", action: "split" })
  const add = screen.getByRole("button", { name: "Add range" })
  expect(add.getAttribute("aria-disabled")).toBe("true")
  expect(document.getElementById(add.getAttribute("aria-describedby")!)?.textContent).toBe("Choose Split by strand or Combine strands first.")
  const handle = screen.getByRole("slider", { name: "Boundary between Patio and Porch" })
  expect(handle.getAttribute("aria-disabled")).toBe("true")
  expect(handle.tabIndex).toBe(-1)
})
