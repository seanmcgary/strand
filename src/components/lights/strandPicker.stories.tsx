import type { Meta, StoryObj } from "@storybook/react"
import { allRange, strand, view } from "../../../test/lightsView"
import { StrandPicker } from "@/components/lights/strandPicker"

const two = view([
  strand("o0", "Strand 1", 150, [allRange("Patio", 0, 150)]),
  strand("o1", "Strand 2", 150, [allRange("Fence", 0, 150)], { pins: [4], start: 150 }),
])

const meta = {
  title: "Lights/StrandPicker",
  component: StrandPicker,
  parameters: { layout: "padded" },
  args: { view: two, selected: "o0", onPick: () => {}, onCombine: () => {} },
} satisfies Meta<typeof StrandPicker>
export default meta
type Story = StoryObj<typeof meta>

export const TwoStrands: Story = {}
export const NotTouching: Story = {
  args: { view: { ...two, strands: [two.strands[0]!, { ...two.strands[1]!, start: 200 }] } },
}
