import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { RadioCard, RadioGroup } from "@/components/ui/radioCard"

const meta = { title: "UI/RadioCard", component: RadioCard } satisfies Meta<typeof RadioCard>
export default meta
type Story = StoryObj<typeof meta>

const handleChange = fn()

export const Group: Story = {
  args: {
    id: "plan-basic",
    name: "plan",
    value: "basic",
    checked: true,
    onChange: handleChange,
    label: "Basic plan",
  },
  render: () => (
    <RadioGroup aria-label="Choose a plan" className="max-w-xs">
      <RadioCard
        id="plan-free"
        name="plan"
        value="free"
        checked={false}
        onChange={handleChange}
        label="Free"
        description="For occasional use"
      />
      <RadioCard
        id="plan-basic"
        name="plan"
        value="basic"
        checked={true}
        onChange={handleChange}
        label="Basic"
        description="For everyday use"
      />
      <RadioCard
        id="plan-pro"
        name="plan"
        value="pro"
        checked={false}
        onChange={handleChange}
        label="Pro"
        description="For power users"
      />
    </RadioGroup>
  ),
}
