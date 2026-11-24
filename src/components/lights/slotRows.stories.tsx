import type { Meta, StoryObj } from "@storybook/react"
import { allRange, slot } from "../../../test/lightsView"
import { SlotRows } from "@/components/lights/slotRows"

const meta = {
  title: "Lights/SlotRows",
  component: SlotRows,
  parameters: { layout: "padded" },
  args: { strandKey: "o0", i: 0, range: allRange("Patio", 0, 60), effects: [], palettes: [], onOpenSlot: () => {} },
} satisfies Meta<typeof SlotRows>
export default meta
type Story = StoryObj<typeof meta>

export const OneSlot: Story = {}
export const ThreeSlots: Story = {
  args: {
    range: {
      ...allRange("Kitchen", 0, 90),
      pattern: { kind: "every", n: 3, group: 1 },
      slots: [slot([255, 0, 0]), slot([0, 200, 80], { on: false }), slot([255, 255, 255])],
    },
  },
}
