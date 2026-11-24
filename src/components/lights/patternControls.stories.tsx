import type { Meta, StoryObj } from "@storybook/react"
import type { RangeView } from "../../../shared/apiTypes"
import { allRange, slot } from "../../../test/lightsView"
import { PatternControls } from "@/components/lights/patternControls"

const every = (n: number, group: number, len: number): RangeView => ({
  ...allRange("Kitchen", 0, len),
  pattern: { kind: "every", n, group },
  slots: Array.from({ length: n }, (_, k) => slot([k * 15, 80, 200])),
})

const meta = {
  title: "Lights/PatternControls",
  component: PatternControls,
  parameters: { layout: "padded" },
  args: { uid: "o0-0", range: allRange("Patio", 0, 60), free: 20, locked: false, effects: [], palettes: [], onRange: () => {} },
} satisfies Meta<typeof PatternControls>
export default meta
type Story = StoryObj<typeof meta>

export const All: Story = {}
export const EveryN: Story = { args: { range: every(3, 2, 90) } }
export const AtSixteenSlots: Story = { args: { range: every(16, 1, 120) } }
export const TooShort: Story = { args: { range: every(2, 2, 4) } }
export const NoFreeSegments: Story = { args: { free: 0 } }
export const Locked: Story = { args: { range: every(3, 2, 90), locked: true } }
