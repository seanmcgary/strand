import type { Meta, StoryObj } from "@storybook/react"
import type { Effect, Palette, RangeView } from "../../../shared/apiTypes"
import { allRange, slot, strand } from "../../../test/lightsView"
import { SlotSheet } from "@/components/lights/slotSheet"

const fx = (id: number, name: string, over: Partial<Effect> = {}): Effect => ({ id, name, pal: false, sliders: [], checks: [], colors: ["Fx"], ...over })
const effects: Effect[] = [
  fx(0, "Solid"),
  fx(1, "Blink", { colors: ["Fx", "Bg"], sliders: ["Speed", "Duty cycle"] }),
  fx(2, "Breathe", { colors: ["Fx", "Bg"], sliders: ["Speed"] }),
  fx(8, "Colorloop", { pal: true, colors: [], sliders: ["Speed", "Saturation"] }),
  fx(9, "Rainbow", { pal: true, colors: [], sliders: ["Speed", "Size"] }),
  fx(10, "Scan", { colors: ["Fx", "Bg"], sliders: ["Speed", "# of dots"], checks: ["Overlay", "Dual"] }),
  fx(11, "Fade", { colors: ["Fx", "Bg"], sliders: ["Speed"] }),
  fx(12, "Sparkle", { colors: ["Fx", "Bg"], sliders: ["Speed"] }),
  fx(13, "Strobe", { colors: ["Fx", "Bg"], sliders: ["Speed"] }),
  fx(14, "Twinkle", { colors: ["Fx", "Bg"], sliders: ["Speed", "Intensity"] }),
]
const palettes: Palette[] = [
  { id: 0, name: "Default", stops: [] },
  { id: 1, name: "Sunset", stops: ["#FF5E00", "#FF0080", "#2A0080"] },
  { id: 2, name: "Ocean", stops: ["#00C6FF", "#0072FF", "#001F54"] },
]
const range: RangeView = {
  ...allRange("Kitchen", 0, 90),
  pattern: { kind: "every", n: 2, group: 1 },
  slots: [slot([255, 120, 0], { fx: 1, fxName: "Blink", col: [[255, 120, 0], [0, 0, 80], [0, 0, 0]] }), slot([0, 200, 80], { fx: 8, fxName: "Colorloop", pal: 1, palName: "Sunset" })],
}
const st = strand("o0", "Strand 1", 90, [range])
const noop = () => {}

const meta = {
  title: "Lights/SlotSheet",
  component: SlotSheet,
  parameters: { layout: "fullscreen" },
  args: {
    target: { key: "o0", r: 0, s: 0 },
    strand: st,
    effects,
    palettes,
    fxStatus: "ok",
    fxError: null,
    onRetryFx: noop,
    recentColors: ["#FF7800", "#00C850", "#0050FF"],
    favoriteEffects: ["Breathe"],
    onEdit: () => true,
    onPushRecent: noop,
    onToggleFavorite: noop,
    onToast: noop,
    onClose: noop,
  },
} satisfies Meta<typeof SlotSheet>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const PaletteEffect: Story = { args: { target: { key: "o0", r: 0, s: 1 } } }
export const Loading: Story = { args: { fxStatus: "loading", effects: null, palettes: null } }
export const ListsFailed: Story = { args: { fxStatus: "error", effects: null, palettes: null, fxError: { message: "The device did not answer." } as never } }
