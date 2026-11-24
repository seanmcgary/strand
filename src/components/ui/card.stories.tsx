import type { Meta, StoryObj } from "@storybook/react"
import { Card } from "@/components/ui/card"

const meta = { title: "UI/Card", component: Card } satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>

export const Static: Story = {
  args: { children: null },
  render: () => (
    <Card className="w-72 p-5">
      <div className="font-semibold">Example card</div>
      <div className="mt-1 font-mono text-xs text-stone-500">A subtitle line</div>
    </Card>
  ),
}
export const Clickable: Story = {
  args: { children: null },
  render: () => (
    <Card as="button" onClick={() => {}} className="w-72 p-5">
      <div className="font-semibold">Tap me</div>
      <div className="mt-1 text-sm text-stone-500">Hover shows the border shift.</div>
    </Card>
  ),
}
