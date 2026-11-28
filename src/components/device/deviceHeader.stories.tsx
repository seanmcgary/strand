import type { Meta, StoryObj } from "@storybook/react"
import type { Device } from "../../../shared/apiTypes"
import { DeviceHeader } from "@/components/device/deviceHeader"

const now = Date.parse("2026-11-24T12:00:00Z")
const device: Device = {
  id: "d1",
  name: "Backyard",
  host: "wled-backyard.local",
  port: 80,
  lastIp: "192.168.1.40",
  mac: "aabbccddeeff",
  online: true,
  lastSeen: "2026-11-24T12:00:00Z",
  pinLocked: false,
}

const meta = {
  title: "Device/DeviceHeader",
  component: DeviceHeader,
  parameters: { layout: "padded" },
  args: { device, power: { on: true, bri: 128 }, rebooting: false, now, onPower: () => {} },
} satisfies Meta<typeof DeviceHeader>
export default meta
type Story = StoryObj<typeof meta>

export const On: Story = {}
export const Off: Story = { args: { power: { on: false, bri: 128 } } }
export const Loading: Story = { args: { power: null } }
export const Offline: Story = { args: { device: { ...device, online: false, lastSeen: "2026-11-24T09:00:00Z" }, power: null } }
export const Rebooting: Story = { args: { rebooting: true } }
