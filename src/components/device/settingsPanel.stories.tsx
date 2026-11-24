import type { Meta, StoryObj } from "@storybook/react"
import { SettingsPanel } from "@/components/device/settingsPanel"

const meta = { title: "Device/SettingsPanel", component: SettingsPanel, parameters: { layout: "padded" } } satisfies Meta<typeof SettingsPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    device: {
      id: "d1",
      name: "Backyard",
      host: "wled-backyard.local",
      lastIp: "192.168.1.40",
      mac: "aabbccddeeff",
      online: true,
      lastSeen: null,
      pinLocked: false,
    },
  },
}
