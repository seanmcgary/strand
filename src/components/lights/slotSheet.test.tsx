// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { Effect, RangeView, StrandView } from "../../../shared/apiTypes"
import { allRange, slot, strand } from "../../../test/lightsView"
import { SlotSheet, type SlotSheetProps } from "./slotSheet"

afterEach(cleanup)

const fx = (id: number, name: string, over: Partial<Effect> = {}): Effect => ({ id, name, pal: false, sliders: [], checks: [], colors: ["Fx"], ...over })
const effects: Effect[] = [
  fx(9, "Breathe"),
  fx(1, "Blink", { colors: ["Fx", "Bg"] }),
  fx(7, "RSVD"),
  fx(0, "Solid"),
  fx(8, "Colorloop", { pal: true, colors: [] }),
  fx(3, "Wave", { sliders: ["Speed", "", "", "", "Size"], checks: ["Reverse", "", ""] }),
]

const everyRange: RangeView = {
  ...allRange("Eaves", 0, 90),
  pattern: { kind: "every", n: 3, group: 1 },
  slots: [slot([255, 0, 0]), slot([0, 255, 0], { fx: 1, fxName: "Blink", sx: 10 }), slot([0, 0, 255], { fx: 9, fxName: "Breathe" })],
}

function mount(st: StrandView, over: Partial<SlotSheetProps> = {}, s = 0) {
  const props: SlotSheetProps = {
    target: { key: st.key, r: 0, s },
    strand: st,
    effects,
    palettes: [],
    fxStatus: "ok",
    fxError: null,
    onRetryFx: vi.fn(),
    recentColors: [],
    favoriteEffects: [],
    onEdit: vi.fn(() => true),
    onPushRecent: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToast: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  const view = render(<SlotSheet {...props} />)
  return { props, rerender: (next: StrandView) => view.rerender(<SlotSheet {...props} strand={next} />) }
}

const one = strand("o0", "Strand 1", 90, [allRange("Patio", 0, 90)])
/** The slot of range 0 in the last `onEdit` call. */
const sent = (m: ReturnType<typeof mount>, s = 0) => vi.mocked(m.props.onEdit).mock.lastCall![0][0]!.slots[s]!
const withRanges = (m: ReturnType<typeof mount>): StrandView => ({ ...m.props.strand!, ranges: vi.mocked(m.props.onEdit).mock.lastCall![0] })

// Fails if the effect list stops sorting by name with Solid first, or stops dropping RSVD.
it("lists Solid first, then effects by name, without RSVD", () => {
  mount(one)
  const names = within(document.getElementById("fx-all-0")!.closest("ul")!).getAllByRole("button", { name: /^(?!Favorite)/ }).map((b) => b.textContent)
  expect(names).toEqual(["Solid", "Blink", "Breathe", "Colorloop", "Wave"])
})

// Fails if the color slot group stops following the picked effect's color labels.
it("shows the picked effect's color slots", () => {
  const m = mount(one)
  expect(screen.queryByRole("group", { name: "Color slot" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Blink" }))
  m.rerender(withRanges(m))
  const group = screen.getByRole("group", { name: "Color slot" })
  expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Main", "Background"])
})

// Fails if an effect with no colors still shows the color controls, or the palette section stops appearing for a palette effect.
it("says a palette effect takes its colors from the palette and shows the palette", () => {
  const m = mount(one)
  expect(screen.queryByRole("heading", { name: "Palette" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Colorloop" }))
  m.rerender(withRanges(m))
  expect(screen.getByText("Colorloop takes its colors from the palette.")).toBeTruthy()
  expect(screen.queryByRole("slider", { name: "Hue and saturation" })).toBeNull()
  expect(screen.getByRole("heading", { name: "Palette" })).toBeTruthy()
})

// Fails if a bad hex is sent, the error text changes, or a valid hex stops reaching editStrand as an RGB color.
it("rejects a bad hex and sends a good one", () => {
  const m = mount(one)
  const hex = screen.getByLabelText("Hex")
  fireEvent.change(hex, { target: { value: "GG0000" } })
  expect(screen.getByText("Enter 6 hex digits, like FF8800.")).toBeTruthy()
  expect(m.props.onEdit).not.toHaveBeenCalled()
  fireEvent.change(hex, { target: { value: "00FF00" } })
  expect(sent(m).col[0]).toEqual([0, 255, 0])
  expect(m.props.onPushRecent).toHaveBeenCalledWith("#00FF00")
})

// Fails if the c3 slider's maximum stops being 31.
it("caps the c3 slider at 31", () => {
  const m = mount(one)
  fireEvent.click(screen.getByRole("button", { name: "Wave" }))
  m.rerender(withRanges(m))
  expect(screen.getByRole("slider", { name: "Size" }).getAttribute("max")).toBe("31")
  expect(screen.getAllByRole("slider").map((s) => s.getAttribute("aria-label"))).toContain("Speed")
  expect(screen.getByRole("checkbox", { name: "Reverse" })).toBeTruthy()
})

// Fails if an arrow key on the hue area stops sending a new color.
it("moves the hue with the arrow keys", () => {
  const m = mount(one)
  fireEvent.keyDown(screen.getByRole("slider", { name: "Hue and saturation" }), { key: "ArrowRight" })
  expect(sent(m).col[0]).not.toEqual([255, 180, 107])
})

/** The hue area with a 100 x 100 box. */
function area() {
  const el = screen.getByRole("slider", { name: "Hue and saturation" })
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
  return el
}

// Fails if a drag on the hue area sends before it ends, or the drag's end stops sending the last color once.
it.each(["pointerUp", "pointerCancel"] as const)("sends once, with the last color, when a hue drag ends by %s", (end) => {
  const m = mount(one)
  const el = area()
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0 })
  for (const x of [20, 40, 60]) fireEvent.pointerMove(el, { clientX: x, clientY: 0 })
  expect(m.props.onEdit).not.toHaveBeenCalled()
  fireEvent[end](el)
  expect(m.props.onEdit).toHaveBeenCalledTimes(1)
  // Hue 216 degrees at full saturation and brightness.
  expect(sent(m).col[0]).toEqual([0, 102, 255])
})

// Fails if a failed effect list hides the message, loses its retry, or takes the color controls down with it.
it("shows the effect list error with a retry and keeps the color part working", () => {
  const m = mount(one, { fxStatus: "error", fxError: { message: "m" } as SlotSheetProps["fxError"], effects: null })
  expect(screen.getByRole("alert").textContent).toBe("m")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(m.props.onRetryFx).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText("Hex"), { target: { value: "00FF00" } })
  expect(m.props.onEdit).toHaveBeenCalledTimes(1)
})

// Fails if Apply to all slots stops copying the effect and its parameters, or starts copying colors.
it("copies the effect and parameters to the other slots, not the colors", () => {
  const m = mount(strand("o0", "Strand 1", 90, [everyRange]), {}, 1)
  fireEvent.click(screen.getByRole("button", { name: "Apply to all slots" }))
  expect(m.props.onEdit).toHaveBeenCalledTimes(1)
  const slots = vi.mocked(m.props.onEdit).mock.lastCall![0][0]!.slots
  expect(slots.map((s) => [s.fxName, s.sx])).toEqual([["Blink", 10], ["Blink", 10], ["Blink", 10]])
  expect(slots.map((s) => s.col[0])).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])
  expect(m.props.onToast).toHaveBeenCalledWith("success", "Blink is on 2 other slots too", "Their colors stay as they were.")
})
