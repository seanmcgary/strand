import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Checkbox } from "@/components/ui/checkbox"

const meta = { title: "UI/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>
export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  args: { id: "checkbox-unchecked", label: "I agree to the terms", checked: false, onChange: fn() },
}

export const Checked: Story = {
  args: { id: "checkbox-checked", label: "I agree to the terms", checked: true, onChange: fn() },
}
