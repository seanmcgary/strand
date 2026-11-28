// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import type { RangeView, StrandPatch } from "../../../shared/apiTypes"
import { allRange, slot, strand, view } from "../../../test/lightsView"
import { renderTab } from "../../../test/renderTab"
import type { LightsActions } from "./lightsTab"

afterEach(cleanup)

/** The ranges of the last `editStrand` call. */
const lastRanges = (a: LightsActions): RangeView[] => {
  const calls = vi.mocked(a.editStrand).mock.calls
  return (calls.at(-1)![0] as { patch: StrandPatch }).patch.ranges!
}

const patio = (len: number): RangeView => ({ ...allRange("Patio", 0, len), pattern: { kind: "every", n: 2, group: 2 }, slots: [slot([255, 180, 107]), slot([255, 0, 0])] })
const patioKitchen = (at: number) => view([strand("o0", "Strand 1", 120, [patio(at), allRange("Kitchen", at, 120 - at)])])

// Fails if the boundary handle's keys (arrows 1 LED, Shift 10, Home to aria-valuemin) stop calling editStrand with moveBoundary.
it("moves a boundary with the arrow keys, Shift and Home", () => {
  const a = renderTab(patioKitchen(60))
  const handle = screen.getByRole("slider", { name: "Boundary between Patio and Kitchen" })
  expect(handle.getAttribute("aria-valuemin")).toBe("3")
  expect(handle.getAttribute("aria-valuemax")).toBe("119")
  fireEvent.keyDown(handle, { key: "ArrowRight" })
  expect(lastRanges(a)[0]!.len).toBe(61)
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
  expect(lastRanges(a)[0]!.len).toBe(70)
  fireEvent.keyDown(handle, { key: "Home" })
  expect(lastRanges(a)[0]!.len).toBe(3)
})

// Fails if a key press at the boundary's minimum still calls editStrand.
it("does nothing for ArrowLeft at the minimum", () => {
  const a = renderTab(patioKitchen(3))
  fireEvent.keyDown(screen.getByRole("slider", { name: "Boundary between Patio and Kitchen" }), { key: "ArrowLeft" })
  expect(a.editStrand).not.toHaveBeenCalled()
})

const halves = view([strand("o0", "Strand 1", 150, [allRange("Left", 0, 75), allRange("Right", 75, 75)])])

function stripRect() {
  const group = screen.getByRole("group", { name: "Strand 1 LEDs and range boundaries" })
  group.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 36, right: 300, bottom: 36, x: 0, y: 0, toJSON: () => ({}) })
}

// Fails if a pointer move during a drag stops mapping clientX over the strip's rect to an LED.
it("drags a boundary with the pointer", () => {
  const a = renderTab(halves)
  stripRect()
  const handle = screen.getByRole("slider", { name: "Boundary between Left and Right" })
  fireEvent.pointerDown(handle, { button: 0, clientX: 150, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 225, pointerId: 1 })
  expect([112, 113]).toContain(lastRanges(a)[1]!.start)
})

// Fails if pointercancel stops ending the drag.
it("ends the drag on pointercancel", () => {
  const a = renderTab(halves)
  stripRect()
  const handle = screen.getByRole("slider", { name: "Boundary between Left and Right" })
  fireEvent.pointerDown(handle, { button: 0, clientX: 150, pointerId: 1 })
  fireEvent.pointerCancel(handle, { pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 225, pointerId: 1 })
  expect(a.editStrand).not.toHaveBeenCalled()
})
