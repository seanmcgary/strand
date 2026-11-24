import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Textarea } from "@/components/ui/textarea"

const meta = { title: "UI/Textarea", component: Textarea } satisfies Meta<typeof Textarea>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { id: "textarea-default", label: "Notes", value: "", onChange: fn() },
}

export const WithError: Story = {
  args: {
    id: "textarea-with-error",
    label: "Notes",
    value: "",
    onChange: fn(),
    error: "Notes are required",
  },
}
