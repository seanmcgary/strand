import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Select } from "@/components/ui/select"

const options = [
  { value: "option-a", label: "Option A" },
  { value: "option-b", label: "Option B" },
  { value: "option-c", label: "Option C" },
  { value: "none", label: "None" },
]

const meta = { title: "UI/Select", component: Select } satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { id: "select-default", label: "Category", options, value: "option-b", onChange: fn() },
}

export const WithError: Story = {
  args: {
    id: "select-with-error",
    label: "Category",
    options,
    value: "",
    onChange: fn(),
    error: "Select a category",
  },
}
