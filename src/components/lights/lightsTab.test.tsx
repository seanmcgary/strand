// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import type { RangeView } from "../../../shared/apiTypes"
import { allRange, strand, view } from "../../../test/lightsView"
import { renderTab } from "../../../test/renderTab"

afterEach(cleanup)

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

// Fails if a slot row stops opening the slot sheet, or closing it stops returning focus to the row.
it("opens the slot sheet from a slot row and returns focus on Escape", async () => {
  renderTab(one)
  const row = screen.getByRole("button", { name: /Slot 1/ })
  fireEvent.click(row)
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("slider", { name: "Hue and saturation" })).toBeTruthy()
  fireEvent.keyDown(dialog, { key: "Escape" })
  expect(screen.queryByRole("dialog")).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(row))
})

// Fails if LightsTab stops passing the paint editor to the RangeCard of an Individual range.
it("shows the paint editor for an Individual range", () => {
  const painted: RangeView = { ...allRange("Peak", 0, 10), pattern: { kind: "individual" }, paint: Array(10).fill("#000000") }
  renderTab(view([strand("o0", "Strand 1", 10, [painted])]))
  expect(screen.getByRole("slider", { name: "Paint Peak" })).toBeTruthy()
})
