import type { Meta, StoryObj } from "@storybook/react"
import { Stepper } from "@/components/ui/stepper"

const meta = { title: "UI/Stepper", component: Stepper } satisfies Meta<typeof Stepper>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { id: "n", label: "N", value: 3, unit: "slots", onStep: () => {} },
}
/** Both buttons are focusable and show their reason on hover, focus and tap. */
export const AtLimits: Story = {
  args: {
    id: "g",
    label: "Group",
    value: 1,
    unit: "LEDs per group",
    decReason: "A group needs at least 1 LED.",
    incReason: "The range has no more LEDs to group.",
    onStep: () => {},
  },
}
