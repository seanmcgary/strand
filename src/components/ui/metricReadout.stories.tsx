import type { Meta, StoryObj } from "@storybook/react"
import { MetricReadout } from "@/components/ui/metricReadout"

const meta = { title: "UI/MetricReadout", component: MetricReadout } satisfies Meta<typeof MetricReadout>
export default meta
type Story = StoryObj<typeof meta>

export const Row: Story = {
  args: { label: "Metric", value: "1,234" },
  render: () => (
    <div className="flex gap-5">
      <MetricReadout label="Revenue" value="$12,400" />
      <MetricReadout label="Users" value="3,210" />
      <MetricReadout label="Active" value="88%" />
      <MetricReadout label="Delta" value="7.2" />
    </div>
  ),
}
