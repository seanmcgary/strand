import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Toggle } from "@/components/ui/toggle"

const meta = { title: "UI/Toggle", component: Toggle } satisfies Meta<typeof Toggle>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = {
  args: { checked: false, onChange: fn(), "aria-label": "Feature enabled" },
}

export const On: Story = {
  args: { checked: true, onChange: fn(), "aria-label": "Feature enabled" },
}
