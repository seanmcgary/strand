import type { Meta, StoryObj } from "@storybook/react"
import { Label } from "@/components/ui/label"

const meta = { title: "UI/Label", component: Label } satisfies Meta<typeof Label>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { htmlFor: "example-field", children: "Field label" },
}
