import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Input } from "@/components/ui/input"

const meta = { title: "UI/Input", component: Input } satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { id: "input-default", placeholder: "Example placeholder", value: "", onChange: fn() },
}

export const WithLabel: Story = {
  args: { id: "input-with-label", label: "Field name", value: "A value", onChange: fn() },
}

export const WithError: Story = {
  args: {
    id: "input-with-error",
    label: "Field name",
    value: "",
    onChange: fn(),
    error: "This field is required",
  },
}

export const Disabled: Story = {
  args: {
    id: "input-disabled",
    label: "Field name",
    value: "A value",
    onChange: fn(),
    disabled: true,
  },
}
