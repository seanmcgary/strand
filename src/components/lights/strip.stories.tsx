import type { Meta, StoryObj } from "@storybook/react"
import { allRange, slot, strand } from "../../../test/lightsView"
import { Strip } from "@/components/lights/strip"

const st = strand("o0", "Strand 1", 150, [
  { ...allRange("Patio", 0, 60), pattern: { kind: "every", n: 2, group: 2 }, slots: [slot([255, 180, 107]), slot([255, 0, 0])] },
  allRange("Kitchen", 60, 60, [255, 160, 0]),
  allRange("Rest", 120, 30),
])

const meta = {
  title: "Lights/Strip",
  component: Strip,
  parameters: { layout: "padded" },
  args: { strand: st, effects: [], palettes: [], flashLed: null, onRanges: () => {} },
} satisfies Meta<typeof Strip>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Flashing: Story = { args: { flashLed: 60 } }
export const Off: Story = { args: { strand: { ...st, on: false } } }
export const Shared: Story = { args: { strand: { ...st, shared: { with: ["o1"] } } } }
