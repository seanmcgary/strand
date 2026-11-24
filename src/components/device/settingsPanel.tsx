import type { Device } from "../../../shared/apiTypes"
import { Icon } from "@/components/ui/icon"

const ADVANCED_ONLY = [
  "Time, sunrise and schedules",
  "Buttons and IR remotes",
  "2D matrices",
  "Usermods",
  "MQTT",
  "Home Assistant and other integrations",
  "Firmware updates",
  "Security and the settings PIN",
]

const LINK_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 self-start whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-4"

/** The Settings tab: until Strand has its own settings screens, a link to the device's WLED settings pages. */
export function SettingsPanel({ device }: { device: Device }) {
  const url = `http://${device.host}/settings`
  return (
    <div>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Advanced</h2>
        <p className="text-sm text-muted-foreground">Some WLED settings aren&apos;t in Strand yet. You can change them in WLED&apos;s own settings pages.</p>
      </div>
      <div className="flex flex-col gap-5 rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Only in the WLED settings for now</h3>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
            {ADVANCED_ONLY.map((x) => (
              <li key={x} className="flex gap-2">
                <span aria-hidden="true">·</span>
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 border-t pt-5">
          <a href={url} target="_blank" rel="noreferrer" className={LINK_BUTTON}>
            <Icon name="external-link" />
            Open WLED Advanced UI
          </a>
          <p className="text-[13px] text-muted-foreground">
            Opens <span className="break-all font-mono text-foreground">{url}</span>
          </p>
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <Icon name="info" className="mt-0.5 size-4" />
            This opens the device directly, so it only works from your home network. Over Tailscale or a remote proxy, WLED may refuse to save changes.
          </p>
        </div>
      </div>
    </div>
  )
}
