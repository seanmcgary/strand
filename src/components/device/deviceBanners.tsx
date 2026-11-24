import type { Device } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { relativeTime } from "@/lib/utils"

const BANNER = "flex flex-wrap items-center gap-3 rounded-lg border p-3"

export interface DeviceBannersProps {
  device: Device
  rebooting: boolean
  /** The device is streaming live data from another source (`info.live`). */
  live: boolean
  pending: string[]
  retrying: boolean
  rebootOpen: boolean
  now: number
  onRetry: () => void
  onRebootOpenChange: (open: boolean) => void
  onReboot: () => void
}

/** The offline, live-data and pending-reboot banners, and the reboot confirm dialog. */
export function DeviceBanners(props: DeviceBannersProps) {
  const { device, rebooting, live, pending } = props
  const online = device.online && !rebooting
  return (
    <div className="mt-4 flex flex-col gap-3 empty:hidden">
      {!device.online && !rebooting ? <OfflineBanner {...props} /> : null}
      {online && live ? (
        <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning-muted p-3 text-sm">
          <Icon name="radio" className="mt-0.5 size-4 text-warning" />
          <p>Receiving live data from another source. Changes may not be visible until it stops.</p>
        </div>
      ) : null}
      {online && pending.length > 0 ? <PendingRebootBanner {...props} /> : null}
    </div>
  )
}

function OfflineBanner({ device, retrying, now, onRetry }: DeviceBannersProps) {
  return (
    <div className={`${BANNER} bg-muted/50`}>
      <Icon name="wifi-off" className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{device.name} is offline</p>
        <p className="text-[13px] text-muted-foreground">
          Last seen {device.lastSeen ? relativeTime(device.lastSeen, now) : "never"} at <span className="font-mono">{device.lastIp}</span>.
          Settings are unavailable until it reconnects.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        <Icon name={retrying ? "loader-circle" : "rotate-cw"} className={retrying ? "motion-safe:animate-spin" : undefined} />
        Retry
      </Button>
    </div>
  )
}

function PendingRebootBanner({ device, pending, rebootOpen, onRebootOpenChange, onReboot }: DeviceBannersProps) {
  return (
    <div className={BANNER}>
      <Icon name="rotate-cw" className="size-4 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm">
        The new {pending.join(" and ")} {pending.length > 1 ? "take" : "takes"} effect after a reboot.
      </p>
      <Dialog open={rebootOpen} onOpenChange={onRebootOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Reboot now
          </Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reboot {device.name}?</DialogTitle>
            <DialogDescription>Lights will turn off for about 10 seconds while it restarts.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={onReboot}>
              Reboot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
