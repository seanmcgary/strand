import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"

const meta = { title: "UI/Button", component: Button } satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: "Continue", leadingIcon: "plus" } }
export const Variants: Story = {
  args: { children: "Button" },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive-outline">Remove device</Button>
      <Button variant="destructive-ghost">Delete</Button>
    </div>
  ),
}
export const Sizes: Story = {
  args: { children: "Button" },
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" variant="outline" aria-label="Add" leadingIcon="plus" />
      <Button size="icon-sm" variant="outline" aria-label="Add" leadingIcon="plus" />
      <Button size="inline" variant="link">Inline</Button>
    </div>
  ),
}
/** Focus it with Tab or hover it: the reason shows in a tooltip. A click shows it too and does nothing else. */
export const WithReason: Story = {
  args: { children: "Combine", variant: "outline", reason: "Combining needs two free segments." },
}
