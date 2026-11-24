import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"

const meta = { title: "UI/Button", component: Button } satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { children: "Continue", leadingIcon: "plus" } }
export const Variants: Story = {
  args: { children: "Button" },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost →</Button>
      <Button variant="subtle">Subtle</Button>
    </div>
  ),
}
export const Sizes: Story = {
  args: { children: "Button" },
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
    </div>
  ),
}
