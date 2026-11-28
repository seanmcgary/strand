import type { Meta, StoryObj } from "@storybook/react"
import type { Device } from "../../../shared/apiTypes"
import { DeviceBanners } from "@/components/device/deviceBanners"

const now = Date.parse("2026-11-24T12:00:00Z")
const device: Device = {
  id: "d1",
  name: "Backyard",
  host: "wled-backyard.local",
  port: 80,
  lastIp: "192.168.1.40",
  mac: "aabbccddeeff",
  online: true,
  lastSeen: "2026-11-24T11:40:00Z",
  pinLocked: false,
}

const meta = {
  title: "Device/DeviceBanners",
  component: DeviceBanners,
  parameters: { layout: "padded" },
  args: {
    device,
    rebooting: false,
    live: false,
    pending: [],
    retrying: false,
    rebootOpen: false,
    now,
    onRetry: () => {},
    onRebootOpenChange: () => {},
    onReboot: () => {},
  },
} satisfies Meta<typeof DeviceBanners>
export default meta
type Story = StoryObj<typeof meta>

export const Offline: Story = { args: { device: { ...device, online: false } } }
export const Retrying: Story = { args: { device: { ...device, online: false }, retrying: true } }
export const LiveData: Story = { args: { live: true } }
export const PendingReboot: Story = { args: { pending: ["hostname", "IP address"] } }
export const RebootConfirm: Story = { args: { pending: ["hostname"], rebootOpen: true } }
