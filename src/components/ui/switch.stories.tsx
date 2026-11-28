import type { Meta, StoryObj } from "@storybook/react"
import { Switch } from "@/components/ui/switch"

const meta = { title: "UI/Switch", component: Switch } satisfies Meta<typeof Switch>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { args: { "aria-label": "Power", checked: false } }
export const On: Story = { args: { "aria-label": "Power", checked: true } }
export const Disabled: Story = { args: { "aria-label": "Power", checked: true, disabled: true } }
