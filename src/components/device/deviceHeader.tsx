import { Link } from "react-router-dom"
import type { Device } from "../../../shared/apiTypes"
import { Icon } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { relativeTime } from "@/lib/utils"
import type { DevicePower } from "@/store/slices/devicePage"

const BACK_LINK =
  "-ml-3 mb-2 inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-4"

/** "Online", or "Offline · last seen …", with a status dot. */
export function StatusText({ device, now }: { device: Device; now: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      <span
        aria-hidden="true"
        className={
          device.online
            ? "inline-block h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.18)]"
            : "inline-block h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60"
        }
      />
      {device.online ? "Online" : `Offline · last seen ${device.lastSeen ? relativeTime(device.lastSeen, now) : "never"}`}
    </span>
  )
}

export interface DeviceHeaderProps {
  device: Device
  /** Null while the state loads. */
  power: DevicePower | null
  rebooting: boolean
  now: number
  onPower: (on: boolean) => void
}

/** The back link, the device's name, status and host, and its power switch while it is online. */
export function DeviceHeader({ device, power, rebooting, now, onPower }: DeviceHeaderProps) {
  const online = device.online && !rebooting
  return (
    <>
      <Link to="/" className={BACK_LINK}>
        <Icon name="arrow-left" />
        Devices
      </Link>
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{device.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {rebooting ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                <Icon name="loader-circle" className="size-3.5 motion-safe:animate-spin" />
                Rebooting…
              </span>
            ) : (
              <StatusText device={device} now={now} />
            )}
            <span className="font-mono text-xs text-muted-foreground">{device.host}</span>
          </div>
        </div>
        {online ? (
          power ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="hidden text-[13px] text-muted-foreground sm:inline">{power.on ? "On" : "Off"}</span>
              <Switch
                checked={power.on}
                aria-label={`Turn ${device.name} ${power.on ? "off" : "on"}`}
                onCheckedChange={onPower}
              />
            </div>
          ) : (
            <Skeleton className="mt-1 h-6 w-11 rounded-full" />
          )
        ) : null}
      </div>
    </>
  )
}
