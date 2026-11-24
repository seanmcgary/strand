import { compose, withHandlers, withState } from "recompose"
import type { Device, RangeView, StrandPatch, StrandView } from "../../../shared/apiTypes"
import { StrandPanel } from "@/components/lights/strandPanel"
import { StrandPicker } from "@/components/lights/strandPicker"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"
import { handleId, nextRangeName, splitRange } from "@/lights/model"
import { cn } from "@/lib/utils"
import type { DeviceLights } from "@/store/slices/lights"
import type { PreferencesState } from "@/store/slices/preferences"
import type { ToastKind } from "@/store/slices/toasts"

const CARD = "rounded-lg border bg-card text-card-foreground"
const PANEL_CENTER = "flex flex-col items-center gap-3 px-6 py-14 text-center"
const BANNER = "flex flex-wrap items-center gap-3 rounded-lg border p-3"
const LINK_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-4"

/** The store actions the Lights tab dispatches, bound by the device screen. */
export interface LightsActions {
  editStrand: (a: { id: string; key: string; patch: StrandPatch }) => boolean
  selectStrand: (a: { id: string; key: string }) => unknown
  selectRange: (a: { id: string; key: string; i: number }) => unknown
  resolveShared: (a: { id: string; key: string; action: "split" | "combine" }) => unknown
  loadLights: (id: string, opts?: { quiet?: boolean }) => unknown
  toast: (kind: ToastKind, title: string, desc?: string) => unknown
}

/** A dialog the strand menu or the picker opened. */
type LightsDialog = { kind: "rename" | "separate"; key: string } | { kind: "combine" }

/** The slot the slot sheet edits. */
type SlotTarget = { key: string; i: number; s: number }

export interface LightsTabProps {
  device: Device
  /** Offline or rebooting: the tab shows the offline panel. */
  offline: boolean
  lights: DeviceLights
  /** The selected strand, else the first one. */
  strand: StrandView | null
  prefs: PreferencesState
  actions: LightsActions
}

interface LocalProps {
  slotTarget: SlotTarget | null
  setSlotTarget: (t: SlotTarget | null) => void
  dialog: LightsDialog | null
  setDialog: (d: LightsDialog | null) => void
}

interface HandlerProps {
  onRetry: () => void
  onPick: (key: string) => void
  onCombine: () => void
  onPower: (on: boolean) => void
  onBri: (bri: number) => void
  onRanges: (ranges: RangeView[]) => void
  onAddRange: () => void
  onResolve: (action: "split" | "combine") => void
  onRename: () => void
  onSeparate: () => void
}

type BaseProps = LightsTabProps & LocalProps
type Props = BaseProps & HandlerProps

function LightsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="flex gap-2">
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-11 w-36" />
      </div>
      <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-4 w-48" />
      </div>
      {[0, 1, 2].map((k) => (
        <div key={k} className={cn(CARD, "flex items-center gap-3 p-4")}>
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A message in place of the strands, with the link to the device's own UI. */
function Unsupported({ device, title }: { device: Device; title: string }) {
  return (
    <div className={cn(CARD, PANEL_CENTER)}>
      <Icon name="info" className="size-5 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <a href={`http://${device.host}/settings`} target="_blank" rel="noreferrer" className={LINK_BUTTON}>
        <Icon name="external-link" />
        Open WLED Advanced UI
      </a>
    </div>
  )
}

function LightsTabView(props: Props) {
  const { device, lights, strand: st } = props
  if (props.offline) {
    return (
      <div className={cn(CARD, PANEL_CENTER, "border-dashed py-12")}>
        <Icon name="wifi-off" className="size-5 text-muted-foreground" />
        <p className="font-medium">The lights are unavailable while the device is offline</p>
        <p className="max-w-sm text-sm text-muted-foreground">They&apos;ll load again as soon as it reconnects.</p>
      </div>
    )
  }
  const v = lights.view
  if (!v) {
    if (lights.status !== "error") return <LightsSkeleton />
    return (
      <div className={cn(CARD, PANEL_CENTER, "py-12")}>
        <Icon name="triangle-alert" className="size-5 text-danger" />
        <p className="font-medium">Couldn&apos;t read the lights</p>
        <p className="max-w-sm text-sm text-muted-foreground">{lights.error?.message ?? ""}</p>
        <Button type="button" variant="outline" size="sm" leadingIcon="rotate-cw" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {v.notices.map((n) => (
        <div key={n} className={cn(BANNER, "bg-muted/50")}>
          <Icon name="info" className="size-4 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-sm">{n}</p>
        </div>
      ))}
      {v.matrix ? (
        <Unsupported device={device} title="2D matrix layouts aren't supported yet." />
      ) : !st ? (
        <Unsupported device={device} title="This device has no LED outputs set up." />
      ) : (
        <>
          <StrandPicker view={v} selected={st.key} onPick={props.onPick} onCombine={props.onCombine} />
          <StrandPanel
            view={v}
            strand={st}
            effects={lights.effects}
            palettes={lights.palettes}
            selRange={lights.selRange[st.key] ?? 0}
            flashLed={lights.flash?.key === st.key ? lights.flash.led : null}
            onPower={props.onPower}
            onBri={props.onBri}
            onRanges={props.onRanges}
            onAddRange={props.onAddRange}
            onResolve={props.onResolve}
            onRename={props.onRename}
            onSeparate={props.onSeparate}
          />
        </>
      )}
    </div>
  )
}

/** Sends a strand edit for the selected strand. */
const edit = (p: BaseProps, patch: StrandPatch): boolean =>
  !!p.strand && p.actions.editStrand({ id: p.device.id, key: p.strand.key, patch })

export const LightsTab = compose<Props, LightsTabProps>(
  withState("slotTarget", "setSlotTarget", null),
  withState("dialog", "setDialog", null),
  withHandlers<BaseProps, HandlerProps>({
    onRetry: (p) => () => {
      p.actions.loadLights(p.device.id)
    },
    onPick: (p) => (key: string) => {
      p.actions.selectStrand({ id: p.device.id, key })
    },
    onCombine: (p) => () => p.setDialog({ kind: "combine" }),
    onPower: (p) => (on: boolean) => {
      edit(p, { on })
    },
    onBri: (p) => (bri: number) => {
      edit(p, { bri })
    },
    onRanges: (p) => (ranges: RangeView[]) => {
      edit(p, { ranges })
    },
    onAddRange: (p) => () => {
      const st = p.strand
      if (!st) return
      const i = Math.min(p.lights.selRange[st.key] ?? 0, st.ranges.length - 1)
      const name = nextRangeName(st.ranges)
      const next = splitRange(st.ranges, i, name)
      if (!next || !edit(p, { ranges: next })) return
      p.actions.selectRange({ id: p.device.id, key: st.key, i: i + 1 })
      p.actions.toast("info", `Added ${name}`, "Drag the new boundary on the strip to move it.")
      // The new handle renders after the store update; focus it once it is there.
      setTimeout(() => document.getElementById(handleId(st.key, i))?.focus())
    },
    onResolve: (p) => (action: "split" | "combine") => {
      if (p.strand) p.actions.resolveShared({ id: p.device.id, key: p.strand.key, action })
    },
    onRename: (p) => () => {
      if (p.strand) p.setDialog({ kind: "rename", key: p.strand.key })
    },
    onSeparate: (p) => () => {
      if (p.strand) p.setDialog({ kind: "separate", key: p.strand.key })
    },
  }),
)(LightsTabView)
