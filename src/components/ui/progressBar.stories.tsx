import type { Meta, StoryObj } from "@storybook/react"
import { ProgressBar } from "@/components/ui/progressBar"

const meta = { title: "UI/ProgressBar", component: ProgressBar } satisfies Meta<typeof ProgressBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { pct: 70 }, render: (a) => <div className="w-64"><ProgressBar {...a} /></div> }
export const Over: Story = {
  args: { pct: 107, fillClass: "bg-yellow-500" },
  render: (a) => <div className="w-64"><ProgressBar {...a} /></div>,
}
