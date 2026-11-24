import type { Meta, StoryObj } from "@storybook/react"
import { StatusPill } from "@/components/ui/statusPill"

const meta = { title: "UI/StatusPill", component: StatusPill } satisfies Meta<typeof StatusPill>
export default meta
type Story = StoryObj<typeof meta>

export const All: Story = {
  args: { tone: "excellent", children: "Excellent" },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusPill tone="excellent" withDot>Excellent</StatusPill>
      <StatusPill tone="good">Good</StatusPill>
      <StatusPill tone="watch">Watch</StatusPill>
      <StatusPill tone="poor">Poor</StatusPill>
      <StatusPill tone="neutral">Neutral</StatusPill>
      <StatusPill tone="info">Info</StatusPill>
    </div>
  ),
}
