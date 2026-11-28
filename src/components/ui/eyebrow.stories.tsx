import type { Meta, StoryObj } from "@storybook/react"
import { Eyebrow } from "@/components/ui/eyebrow"

const meta = { title: "UI/Eyebrow", component: Eyebrow } satisfies Meta<typeof Eyebrow>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: "Section label" } }
export const Brand: Story = {
  args: { children: "Highlighted", className: "text-brand" },
}
