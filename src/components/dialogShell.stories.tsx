import type { Meta, StoryObj } from "@storybook/react"
import { CancelButton, DialogShell } from "@/components/dialogShell"

const meta = {
  title: "Components/DialogShell",
  component: DialogShell,
  args: {
    title: "Rename range",
    description: "Pick a name that is unique on this strand.",
    returnFocus: () => null,
    onClose: () => {},
    children: <CancelButton />,
  },
} satisfies Meta<typeof DialogShell>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Confirm: Story = { args: { title: "Reboot Backyard?", showCloseButton: false } }
