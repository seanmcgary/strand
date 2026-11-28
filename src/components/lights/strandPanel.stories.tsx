import type { Meta, StoryObj } from "@storybook/react"
import { allRange, strand, view } from "../../../test/lightsView"
import { StrandPanel } from "@/components/lights/strandPanel"

const st = strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90, [255, 160, 0])])
const v = view([st, strand("o1", "Strand 2", 150, [allRange("Fence", 0, 150)], { start: 150 })])
const noop = () => {}

const meta = {
  title: "Lights/StrandPanel",
  component: StrandPanel,
  parameters: { layout: "padded" },
  args: {
    view: v,
    strand: st,
    effects: [],
    palettes: [],
    selRange: 0,
    flashLed: null,
    onPower: noop,
    onBri: noop,
    onRanges: noop,
    onAddRange: noop,
    onResolve: noop,
    onRename: noop,
    onSeparate: noop,
  },
} satisfies Meta<typeof StrandPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Flashing: Story = { args: { flashLed: 75 } }
export const Shared: Story = { args: { strand: { ...st, shared: { with: ["o1"] } } } }
export const NoFreeSegments: Story = { args: { view: { ...v, segments: { used: 32, max: 32 } } } }
export const Combined: Story = { args: { strand: { ...st, key: "o0+o1", name: "Strand 1 + Strand 2" } } }
