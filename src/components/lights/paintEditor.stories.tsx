import type { Meta, StoryObj } from "@storybook/react"
import type { RangeView } from "../../../shared/apiTypes"
import { allRange, strand } from "../../../test/lightsView"
import { PaintEditor } from "@/components/lights/paintEditor"

const peak: RangeView = {
  ...allRange("Peak", 0, 100),
  pattern: { kind: "individual" },
  paint: Array.from({ length: 100 }, (_, k) => ["#FF0000", "#00C850", "#FFFFFF", "#0050FF"][Math.floor(k / 5) % 4]!),
}

const noop = () => {}

const meta: Meta<typeof PaintEditor> = {
  title: "Lights/PaintEditor",
  component: PaintEditor,
  args: {
    id: "d1",
    strand: strand("o0", "Strand 1", 100, [peak]),
    i: 0,
    brush: "#FF8800",
    recentColors: ["#FF0000", "#00C850", "#0050FF"],
    onBrush: noop,
    actions: { beginPaint: noop, paintCells: noop, endPaint: noop, editStrand: noop, pushRecentColor: noop },
  },
}
export default meta
type Story = StoryObj<typeof PaintEditor>

export const Default: Story = {}
export const NoRecentColors: Story = { args: { recentColors: [] } }
