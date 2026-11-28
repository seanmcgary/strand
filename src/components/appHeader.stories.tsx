import type { Meta, StoryObj } from "@storybook/react"
import { AppHeader } from "@/components/appHeader"

const meta = { title: "App/AppHeader", component: AppHeader, parameters: { layout: "fullscreen" } } satisfies Meta<typeof AppHeader>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { toasts: [] } }
export const WithToast: Story = {
  args: { toasts: [{ id: 1, kind: "error", title: "Couldn't change the lights", desc: "Backyard didn't answer." }] },
}
