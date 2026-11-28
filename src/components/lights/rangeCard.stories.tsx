import type { Meta, StoryObj } from "@storybook/react"
import type { RangeView } from "../../../shared/apiTypes"
import { allRange, slot, strand } from "../../../test/lightsView"
import { RangeCard } from "@/components/lights/rangeCard"

const every: RangeView = {
  ...allRange("Kitchen", 60, 90),
  pattern: { kind: "every", n: 3, group: 2 },
  slots: [slot([255, 0, 0]), slot([0, 200, 80]), slot([255, 255, 255])],
}
const painted: RangeView = { ...allRange("Eaves", 150, 10), pattern: { kind: "individual" }, paint: Array.from({ length: 10 }, (_, k) => (k % 2 ? "#FFFFFF" : "#FF0000")) }
const st = strand("o0", "Strand 1", 160, [allRange("Patio", 0, 60), every, painted])
const noop = () => {}

const meta = {
  title: "Lights/RangeCard",
  component: RangeCard,
  parameters: { layout: "padded" },
  decorators: [(Story) => <ul className="flex flex-col gap-2"><Story /></ul>],
  args: {
    strand: st,
    i: 0,
    free: 20,
    effects: [],
    palettes: [],
    onSelect: noop,
    onFlash: noop,
    onRename: noop,
    onMergeNext: noop,
    onDelete: noop,
    onRange: noop,
    onOpenSlot: noop,
  },
} satisfies Meta<typeof RangeCard>
export default meta
type Story = StoryObj<typeof meta>

export const All: Story = {}
export const Collapsed: Story = { args: { i: 1 } }
export const NoFreeSegments: Story = { args: { free: 0 } }
export const Shared: Story = { args: { strand: { ...st, shared: { with: ["o1"] } } } }
export const Individual: Story = {
  args: { strand: { ...st, ranges: [painted] }, paintEditor: <p className="text-sm text-muted-foreground">The paint editor goes here.</p> },
}
