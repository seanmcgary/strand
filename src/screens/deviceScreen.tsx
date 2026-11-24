// `compose(...)` runs at module-eval and touches `React.createFactory` under
// React 19 -- this shim must run first.
import "@/lib/reactCompat"
import type { KeyboardEvent } from "react"
import { connect } from "react-redux"
import { Link } from "react-router-dom"
import { compose, lifecycle, withHandlers, withState } from "recompose"
import type { Device, StrandView } from "../../shared/apiTypes"
import { AppHeader, GUTTER } from "@/components/appHeader"
import { DeviceBanners } from "@/components/device/deviceBanners"
import { DeviceHeader } from "@/components/device/deviceHeader"
import { SettingsPanel } from "@/components/device/settingsPanel"
import { LightsTab } from "@/components/lights/lightsTab"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import type { IconName } from "@/components/ui/iconPaths"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { withActions } from "@/lib/withActions"
import { withRouter, type RouterProps } from "@/lib/withRouter"
import type { RootState } from "@/store"
import type { ThunkError } from "@/store/createApiThunk"
import {
  loadDeviceState,
  loadInfo,
  loadPending,
  rebootNow,
  retryDevice,
  selectDevicePage,
  setPower,
  type DevicePageEntry,
} from "@/store/slices/devicePage"
import { fetchDevices } from "@/store/slices/devices"
import {
  editStrand,
  flashLed,
  loadFxLists,
  loadLights,
  loadOutputs,
  resolveShared,
  selectLights,
  selectRange,
  selectStrand,
  selectedStrand,
  setStrandGroups,
  setStrandName,
  type DeviceLights,
} from "@/store/slices/lights"
import { loadPreferences, type PreferencesState } from "@/store/slices/preferences"
import { toast, type ToastItem } from "@/store/slices/toasts"

type Tab = "lights" | "presets" | "settings"

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: "lights", icon: "lightbulb", label: "Lights" },
  { id: "presets", icon: "bookmark", label: "Presets" },
  { id: "settings", icon: "settings-2", label: "Settings" },
]

const TABS_LIST = "grid h-10 w-full grid-cols-3 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground sm:inline-flex sm:w-auto"
const TABS_TRIGGER =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow [&_svg]:hidden sm:[&_svg]:block"
const CARD = "rounded-lg border bg-card text-card-foreground"
const OUTLINE_LINK =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** The design's page container. */
const page = (pt: string, extra = "") => cn("mx-auto w-full max-w-6xl pb-28", pt, GUTTER, extra)

const tabId = (tab: Tab) => `device-tab-${tab}`
const panelId = (tab: Tab) => `device-panel-${tab}`

function tabPath(id: string, tab: Tab): string {
  const base = `/devices/${encodeURIComponent(id)}`
  if (tab === "presets") return `${base}?tab=presets`
  if (tab === "settings") return `${base}/settings`
  return base
}

/** The open tab: Settings under `/settings`, Presets for `?tab=presets`, else Lights. */
function tabOf(location: { pathname: string; search: string }): Tab {
  if (/\/devices\/[^/]+\/settings(\/|$)/.test(location.pathname)) return "settings"
  return new URLSearchParams(location.search).get("tab") === "presets" ? "presets" : "lights"
}

interface StateProps {
  id: string
  device: Device | null
  devicesStatus: RootState["devices"]["status"]
  devicesError: ThunkError | null
  entry: DevicePageEntry
  prefs: PreferencesState
  lights: DeviceLights
  strand: StrandView | null
  toasts: ToastItem[]
}

const actions = {
  fetchDevices,
  loadDeviceState,
  loadInfo,
  loadPending,
  loadLights,
  loadFxLists,
  loadPreferences,
  setPower,
  rebootNow,
  retryDevice,
  editStrand,
  selectStrand,
  selectRange,
  resolveShared,
  flashLed,
  setStrandGroups,
  setStrandName,
  loadOutputs,
  toast,
}
/** What dispatching each action returns: a thunk's own result, else the action. */
type Dispatched<R> = R extends (...args: never[]) => infer T ? T : R
type ActionProps = { [K in keyof typeof actions]: (...args: Parameters<(typeof actions)[K]>) => Dispatched<ReturnType<(typeof actions)[K]>> }

interface LocalProps {
  /** The time "last seen" is measured from: when the device list last changed. */
  now: number
  setNow: (v: number) => void
  retrying: boolean
  setRetrying: (v: boolean) => void
  rebootOpen: boolean
  setRebootOpen: (v: boolean) => void
}

interface HandlerProps {
  onPower: (on: boolean) => void
  onRetry: () => void
  onReboot: () => void
  onTabKey: (e: KeyboardEvent<HTMLElement>) => void
}

type BaseProps = RouterProps & StateProps & ActionProps & LocalProps
type Props = BaseProps & HandlerProps

const isOnline = (p: Pick<StateProps, "device" | "entry">) => !!p.device?.online && !p.entry.rebooting

/**
 * Sends the loads that a change of device, of online state, or of tab calls for:
 * the device's state, info and pending reboot when it comes online, and the
 * lights, effect lists and preferences when the Lights tab opens.
 */
function syncLoads(p: Props, prev: Props | null) {
  const online = isOnline(p)
  const wasOnline = !!prev && prev.id === p.id && isOnline(prev)
  if (online && !wasOnline) {
    p.loadDeviceState(p.id)
    p.loadInfo(p.id)
    p.loadPending(p.id)
  }
  const lightsOpen = online && tabOf(p.location) === "lights"
  const wasOpen = wasOnline && !!prev && tabOf(prev.location) === "lights"
  if (lightsOpen && !wasOpen) {
    p.loadLights(p.id, { quiet: !!p.lights.view })
    p.loadFxLists(p.id)
    if (!p.prefs.loaded) p.loadPreferences()
  }
}

export function DeviceScreenView(props: Props) {
  const { device, entry, toasts } = props
  let body
  if (!device && props.devicesStatus === "error") {
    body = (
      <main className={page("pt-10")}>
        <div className={`${CARD} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
          <Icon name="triangle-alert" className="size-5 text-danger" />
          <p className="font-medium">Couldn&apos;t load your devices</p>
          <p className="max-w-sm text-sm text-muted-foreground">{props.devicesError?.message ?? ""}</p>
          <Button type="button" variant="outline" size="sm" leadingIcon="rotate-cw" onClick={() => props.fetchDevices()}>
            Try again
          </Button>
        </div>
      </main>
    )
  } else if (!device && props.devicesStatus !== "ok") {
    body = (
      <main className={page("pt-6", "flex flex-col gap-2")} aria-busy="true">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-40" />
      </main>
    )
  } else if (!device) {
    body = (
      <main className={page("pt-10")}>
        <div className={`${CARD} flex flex-col items-start gap-3 p-6`}>
          <h1 className="text-lg font-semibold">This device isn&apos;t in Strand</h1>
          <p className="text-sm text-muted-foreground">It may have been removed. Add it again from the device list.</p>
          <Link to="/" className={OUTLINE_LINK}>
            Back to devices
          </Link>
        </div>
      </main>
    )
  } else {
    const tab = tabOf(props.location)
    body = (
      <main className={page("pt-3")}>
        <DeviceHeader device={device} power={entry.state} rebooting={entry.rebooting} now={props.now} onPower={props.onPower} />
        <DeviceBanners
          device={device}
          rebooting={entry.rebooting}
          live={!!entry.info?.live}
          pending={entry.pending}
          retrying={props.retrying}
          rebootOpen={props.rebootOpen}
          now={props.now}
          onRetry={props.onRetry}
          onRebootOpenChange={props.setRebootOpen}
          onReboot={props.onReboot}
        />
        <div role="tablist" aria-label="Device views" className={`${TABS_LIST} mt-5`} onKeyDown={props.onTabKey}>
          {TABS.map((t) => (
            <Link
              key={t.id}
              to={tabPath(props.id, t.id)}
              role="tab"
              id={tabId(t.id)}
              aria-selected={tab === t.id}
              aria-controls={panelId(t.id)}
              tabIndex={tab === t.id ? 0 : -1}
              className={TABS_TRIGGER}
            >
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ))}
        </div>
        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={panelId(t.id)} aria-labelledby={tabId(t.id)} hidden={tab !== t.id} className="mt-5">
            {tab === t.id && t.id === "lights" ? (
              <LightsTab device={device} offline={!isOnline(props)} lights={props.lights} strand={props.strand} prefs={props.prefs} actions={props} />
            ) : null}
            {tab === t.id && t.id === "settings" ? <SettingsPanel device={device} /> : null}
          </div>
        ))}
      </main>
    )
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader toasts={toasts} />
      {body}
    </div>
  )
}

const mapState = (state: RootState, own: RouterProps): StateProps => {
  const id = own.params.id ?? ""
  return {
    id,
    device: state.devices.list.find((d) => d.id === id) ?? null,
    devicesStatus: state.devices.status,
    devicesError: state.devices.error,
    entry: selectDevicePage(state, id),
    prefs: state.preferences,
    lights: selectLights(state, id),
    strand: selectedStrand(state, id),
    toasts: state.toasts.items,
  }
}

export default compose<Props, Record<string, never>>(
  withRouter,
  connect(mapState),
  withActions(actions),
  withState("now", "setNow", () => Date.now()),
  withState("retrying", "setRetrying", false),
  withState("rebootOpen", "setRebootOpen", false),
  withHandlers<BaseProps, HandlerProps>({
    onPower: (p) => (on: boolean) => {
      p.setPower({ id: p.id, on })
    },
    onRetry: (p) => async () => {
      p.setRetrying(true)
      await p.retryDevice(p.id)
      p.setRetrying(false)
    },
    onReboot: (p) => () => {
      p.setRebootOpen(false)
      p.rebootNow(p.id)
    },
    onTabKey: (p) => (e: KeyboardEvent<HTMLElement>) => {
      const i = TABS.findIndex((t) => t.id === tabOf(p.location))
      const to = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key]
      if (to === undefined) return
      e.preventDefault()
      const next = TABS[to]!.id
      p.navigate(tabPath(p.id, next))
      document.getElementById(tabId(next))?.focus()
    },
  }),
  lifecycle<Props, Record<string, never>>({
    componentDidMount() {
      this.props.fetchDevices()
      syncLoads(this.props, null)
    },
    componentDidUpdate(prev) {
      if (prev.device !== this.props.device) this.props.setNow(Date.now())
      syncLoads(this.props, prev)
    },
  }),
)(DeviceScreenView)
