// @vitest-environment jsdom
import "@/lib/reactCompat"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { connect, Provider } from "react-redux"
import { compose, withState } from "recompose"
import { afterEach, expect, it, vi } from "vitest"
import type { RangeView, StrandView } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { makeStore } from "@/store"
import { adoptView, beginPaint, editStrand, endPaint, lightsSlice, paintCells, selectLights } from "@/store/slices/lights"
import { toastsSlice } from "@/store/slices/toasts"
import { allRange, slot, strand, view } from "../../../test/lightsView"
import { PaintEditor } from "./paintEditor"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const BLACK = "#000000"
const painted = (len: number): RangeView => ({ ...allRange("Peak", 20, len), pattern: { kind: "individual" }, slots: [slot([255, 0, 0])], paint: Array(len).fill(BLACK) })

const mkStore = () => makeStore({ lights: lightsSlice.reducer, toasts: toastsSlice.reducer })
type Store = ReturnType<typeof mkStore>

type HarnessProps = { recent: string[]; st: StrandView; dispatch: Store["dispatch"]; brush: string; setBrush: (hex: string) => void }

const HarnessView = ({ recent, st, dispatch, brush, setBrush }: HarnessProps) => {
  const actions = {
    beginPaint: (a: { id: string; key: string }) => dispatch(beginPaint(a)),
    paintCells: (a: Parameters<typeof paintCells>[0]) => dispatch(paintCells(a)),
    endPaint: (a: { id: string; key: string }) => dispatch(endPaint(a)),
    editStrand: (a: Parameters<typeof editStrand>[0]) => dispatch(editStrand(a)),
    pushRecentColor: vi.fn(),
  }
  return <PaintEditor id="d1" strand={st} i={1} brush={brush} recentColors={recent} onBrush={setBrush} actions={actions} />
}
const Harness = compose<HarnessProps, { recent: string[] }>(
  connect((s: ReturnType<Store["getState"]>) => ({ st: selectLights(s, "d1").view!.strands[0]! })),
  withState("brush", "setBrush", "#FF8800"),
)(HarnessView)

function mount(len = 10, recent: string[] = []) {
  const store = mkStore()
  const v = view([strand("o0", "Strand 1", 40, [allRange("Gutter", 0, 20), painted(len)])])
  store.dispatch(adoptView({ id: "d1", view: v }))
  const patch = vi.spyOn(api, "patchStrand").mockReturnValue(new Promise(() => {}))
  render(
    <Provider store={store}>
      <Harness recent={recent} />
    </Provider>,
  )
  const strip = screen.getByRole("slider", { name: "Paint Peak" })
  // 100 px wide: one cell is 100 / cells px.
  strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 44, right: 100, bottom: 44, x: 0, y: 0, toJSON: () => ({}) })
  const paint = () => selectLights(store.getState(), "d1").view!.strands[0]!.ranges[1]!.paint!
  return { store, patch, strip, paint }
}

/** A drag over the first five of ten cells. */
function drag(strip: HTMLElement, end: "pointerUp" | "pointerCancel") {
  fireEvent.pointerDown(strip, { clientX: 5, button: 0 })
  for (const x of [15, 25, 35, 45]) fireEvent.pointerMove(strip, { clientX: x })
  return () => fireEvent[end](strip)
}

// Fails if painting sends to the device before the release, or paints the wrong LEDs of the range.
it("paints LEDs 0-4 on a drag and sends once on release", () => {
  const m = mount()
  const release = drag(m.strip, "pointerUp")
  expect(m.patch).not.toHaveBeenCalled()
  release()
  expect(m.patch).toHaveBeenCalledTimes(1)
  expect(m.patch.mock.calls[0]![2].ranges![1]!.paint).toEqual([...Array(5).fill("#FF8800"), ...Array(5).fill(BLACK)])
})

// Fails if a drag that skips cells leaves them unpainted.
it("fills the cells a fast drag skips", () => {
  const m = mount()
  fireEvent.pointerDown(m.strip, { clientX: 5, button: 0 })
  fireEvent.pointerMove(m.strip, { clientX: 75 })
  expect(m.paint().slice(0, 8)).toEqual(Array(8).fill("#FF8800"))
  fireEvent.pointerUp(m.strip)
})

// Fails if pointercancel does not end the stroke, so the hold stays and the paint is never sent.
it("ends the stroke on pointercancel", () => {
  const m = mount()
  drag(m.strip, "pointerCancel")()
  expect(m.patch).toHaveBeenCalledTimes(1)
  expect(m.store.getState().lights.writes["d1|o0"]?.hold).toBeFalsy()
})

// Fails if the keyboard stops moving the cursor or Space stops being one begin, paint, end.
it("moves with the arrow keys and paints the cursor LED on Space", () => {
  const m = mount()
  fireEvent.keyDown(m.strip, { key: "ArrowRight" })
  fireEvent.keyDown(m.strip, { key: "ArrowRight" })
  fireEvent.keyDown(m.strip, { key: " " })
  expect(m.patch).toHaveBeenCalledTimes(1)
  expect(m.paint().map((c, k) => (c === "#FF8800" ? k : -1)).filter((k) => k >= 0)).toEqual([2])
  expect(m.strip.getAttribute("aria-valuenow")).toBe("22")
})

// Fails if Fill range or Clear stop writing the brush color, or black, to every LED.
it("fills the range with the brush and clears it to black", () => {
  const m = mount()
  fireEvent.click(screen.getByRole("button", { name: "Fill range" }))
  expect(m.patch.mock.calls.at(-1)![2].ranges![1]!.paint).toEqual(Array(10).fill("#FF8800"))
  fireEvent.click(screen.getByRole("button", { name: "Clear" }))
  expect(m.paint()).toEqual(Array(10).fill(BLACK))
})

// Fails if the cell count stops following the screen width (48 narrow, 120 wide), or a cell paints other than the LEDs it covers.
it.each([
  { wide: false, cells: 48, painted: 4 },
  { wide: true, cells: 120, painted: 1 },
])("paints the LEDs a cell covers on a long range (wide: $wide)", ({ wide, cells, painted: n }) => {
  vi.stubGlobal("matchMedia", () => ({ matches: wide, addEventListener: () => {}, removeEventListener: () => {} }))
  const m = mount(192)
  expect(m.strip.querySelectorAll(":scope > span")).toHaveLength(cells)
  fireEvent.pointerDown(m.strip, { clientX: 0.5, button: 0 })
  fireEvent.pointerUp(m.strip)
  expect(m.paint().filter((c) => c === "#FF8800")).toHaveLength(n)
  expect(m.paint().slice(0, n)).toEqual(Array(n).fill("#FF8800"))
})

// Fails if the recent colors stop setting the brush.
it("picks a recent color as the brush", () => {
  const m = mount(10, ["#00C850"])
  fireEvent.click(screen.getByRole("button", { name: "Brush Green" }))
  fireEvent.click(screen.getByRole("button", { name: "Fill range" }))
  expect(m.paint()).toEqual(Array(10).fill("#00C850"))
})
