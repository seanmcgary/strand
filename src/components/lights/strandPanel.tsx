import type { Effect, LightsView, Palette, RangeView, StrandView } from "../../../shared/apiTypes"
import { Strip } from "@/components/lights/strip"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu"
import { Icon } from "@/components/ui/icon"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { briToPct, freeSegs, LOCKED, needMsg, pinLabel, strandMenuId } from "@/lights/model"
import { cn } from "@/lib/utils"

const CARD = "rounded-lg border bg-card text-card-foreground"

const listText = (xs: string[]): string => (xs.length > 2 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs.join(" and "))

/** Why Add range can't split range `r`, or undefined. */
function addReason(view: LightsView, st: StrandView, r: RangeView | undefined): string | undefined {
  if (st.shared) return LOCKED
  if (!r) return "This strand has no range to split."
  if (r.len < 2) return `${r.name} has only one LED.`
  const need = r.pattern.kind === "every" ? r.pattern.n : 1
  const free = freeSegs(view)
  return need > free ? needMsg(need, free) : undefined
}

export interface StrandPanelProps {
  view: LightsView
  strand: StrandView
  effects: Effect[] | null
  palettes: Palette[] | null
  /** The range Add range splits. */
  selRange: number
  /** The LED of this strand that is flashing, or null. */
  flashLed: number | null
  onPower: (on: boolean) => void
  onBri: (bri: number) => void
  onRanges: (ranges: RangeView[]) => void
  onAddRange: () => void
  onResolve: (action: "split" | "combine") => void
  onRename: () => void
  onSeparate: () => void
}

function SharedBanner({ view, strand: st, onResolve }: Pick<StrandPanelProps, "view" | "strand" | "onResolve">) {
  const names = [st.name, ...(st.shared?.with ?? []).map((k) => view.strands.find((s) => s.key === k)?.name ?? k)]
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-muted p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon name="triangle-alert" className="mt-0.5 size-4 text-warning" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{listText(names)} share one segment.</p>
          <p className="text-[13px] text-muted-foreground">Pick how to control them. Ranges can&apos;t change until you do.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" leadingIcon="split" onClick={() => onResolve("split")}>
          Split by strand
        </Button>
        <Button type="button" size="sm" leadingIcon="link" onClick={() => onResolve("combine")}>
          Combine strands
        </Button>
      </div>
    </div>
  )
}

/** The selected strand: name and menu, power, brightness, the strip, Add range and the segment count. */
export function StrandPanel(props: StrandPanelProps) {
  const { view, strand: st, selRange, flashLed } = props
  const sel = Math.min(selRange, st.ranges.length - 1)
  const r = st.ranges[sel]
  const reason = addReason(view, st, r)
  const onBri = (bri: number) => {
    if (bri !== st.bri) props.onBri(bri)
  }
  return (
    <section className={cn(CARD, "p-4 sm:p-5")} aria-labelledby="strand-h">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="strand-h" className="truncate text-base font-semibold tracking-tight">
              {st.name}
            </h2>
            <p className="text-[13px] tabular-nums text-muted-foreground">
              {pinLabel(st.pins)} · {st.len} LEDs
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" id={strandMenuId(st.key)} variant="ghost" size="icon-sm" aria-label={`${st.name} options`}>
                <Icon name="ellipsis" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={props.onRename}>
                <Icon name="pencil" />
                Rename strand
              </DropdownMenuItem>
              {st.key.includes("+") ? (
                <DropdownMenuItem onSelect={props.onSeparate}>
                  <Icon name="unlink" />
                  Separate
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto sm:min-w-[340px]">
          <Switch checked={st.on} aria-label={`Turn ${st.name} ${st.on ? "off" : "on"}`} onCheckedChange={props.onPower} />
          <Icon name="sun" className={cn("ml-1 size-4 shrink-0", st.on ? "text-foreground" : "text-muted-foreground")} />
          <Slider value={st.bri} aria-label={`${st.name} brightness`} onValueChange={onBri} onValueCommit={onBri} />
          <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{briToPct(st.bri)}%</span>
        </div>
      </div>
      {st.shared ? <SharedBanner view={view} strand={st} onResolve={props.onResolve} /> : null}
      <div className="mt-5">
        <Strip strand={st} effects={props.effects} palettes={props.palettes} flashLed={flashLed} onRanges={props.onRanges} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" variant="outline" size="sm" leadingIcon="plus" reason={reason} onClick={props.onAddRange}>
          Add range
        </Button>
        {r && !reason ? <span className="text-[13px] text-muted-foreground">Splits {r.name} in two</span> : null}
        <p className="ml-auto text-[13px] tabular-nums text-muted-foreground">
          Segments used {view.segments.used} of {view.segments.max}
        </p>
      </div>
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        {flashLed !== null ? (
          <>
            <Icon name="zap" className="mr-1 inline size-3.5 align-[-2px] text-primary" />
            LED {flashLed} is lit white for 3 seconds.
          </>
        ) : null}
      </p>
    </section>
  )
}
