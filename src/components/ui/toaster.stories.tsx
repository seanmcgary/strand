import type { Meta, StoryObj } from "@storybook/react"
import { Toaster } from "@/components/ui/toaster"

const meta = { title: "UI/Toaster", component: Toaster, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Toaster>
export default meta
type Story = StoryObj<typeof meta>

export const Stack: Story = {
  args: {
    items: [
      { id: 1, kind: "success", title: "Saved", desc: "" },
      { id: 2, kind: "error", title: "Couldn't reach Desk", desc: "The device didn't answer." },
      { id: 3, kind: "info", title: "Rebooting", desc: "This takes about 20 seconds." },
    ],
  },
}
