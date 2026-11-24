import type { ReactNode } from "react"
import { compose, withState } from "recompose"
import type { Effect, Palette, RangeView, StrandView } from "../../../shared/apiTypes"
import { PatternControls } from "@/components/lights/patternControls"
import { SlotRows, Swatch } from "@/components/lights/slotRows"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu"
import { Icon } from "@/components/ui/icon"
import { LOCKED, rangeHeaderId, rangeLabel, rangeMenuId, rangeSummary } from "@/lights/model"
import { cn } from "@/lib/utils"

const CARD = "rounded-lg border bg-card text-card-foreground"
const FLASH_REASON = "Flashing needs one free segment. Remove a range first."

export interface RangeCardProps {
  strand: StrandView
  /** The range's index on the strand. */
  i: number
  /** The device's free segments. */
  free: number
  effects: Effect[] | null
  palettes: Palette[] | null
  /** The card was opened or closed: the range becomes the one Add range splits. */
  onSelect: (i: number) => void
  onFlash: (led: number) => void
  onRename: (i: number) => void
  onMergeNext: (i: number) => void
  onDelete: (i: number) => void
  onRange: (i: number, next: RangeView) => void
  onOpenSlot: (s: number) => void
  /** Shown in place of the slot rows for an Individual range. */
  paintEditor?: ReactNode
}

interface LocalProps {
  open: boolean
  setOpen: (open: boolean) => void
}

function FlashButtons({ r, free, onFlash }: { r: RangeView; free: number; onFlash: (led: number) => void }) {
  const reason = free < 1 ? FLASH_REASON : undefined
  return (
    <>
      {(["start", "end"] as const).map((w) => (
        <Button
          key={w}
          type="button"
          variant="ghost"
          size="sm"
          className="px-2.5"
          leadingIcon="zap"
          aria-label={`Flash the ${w === "start" ? "first" : "last"} LED of ${r.name}`}
          reason={reason}
          onClick={() => onFlash(w === "start" ? r.start : r.start + r.len - 1)}
        >
          Flash {w}
        </Button>
      ))}
    </>
  )
}

function RangeSwatches({ r, effects, palettes }: { r: RangeView; effects: Effect[] | null; palettes: Palette[] | null }) {
  if (r.pattern.kind === "individual") {
    const painted = [...new Set(r.paint ?? [])].slice(0, 6)
    const bg = painted.length > 1 ? `conic-gradient(${painted.join(",")})` : (painted[0] ?? "#000000")
    return <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-full border border-foreground/15" style={{ background: bg }} />
  }
  return (
    <>
      {r.slots.slice(0, 4).map((s, k) => (
        <Swatch key={k} fxs={effects} pals={palettes} slot={s} className="ring-2 ring-card" />
      ))}
    </>
  )
}

/** One range of the strand: a header that opens it, Flash start and end, its menu, and its pattern and slots. */
function RangeCardView(props: RangeCardProps & LocalProps) {
  const { strand: st, i, free, open } = props
  const r = st.ranges[i]!
  const body = `range-${st.key}-${i}-body`
  const locked = !!st.shared
  const nx = st.ranges[i + 1]
  const pv = st.ranges[i - 1]
  const touchNext = !!nx && r.start + r.len === nx.start
  const touchPrev = !!pv && pv.start + pv.len === r.start
  const mergeReason = locked ? LOCKED : !touchNext ? "There's no range right after this one." : undefined
  const deleteReason = locked ? LOCKED : !(touchNext || touchPrev) ? "A range needs a neighbor to take its LEDs." : undefined
  return (
    <li className={cn(CARD, open && "border-foreground/25")}>
      <div className="flex items-center gap-1 p-2 sm:p-2.5">
        <button
          type="button"
          id={rangeHeaderId(st.key, i)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => {
            props.setOpen(!open)
            props.onSelect(i)
          }}
        >
          <Icon name="chevron-down" className={cn("size-4 shrink-0 text-muted-foreground motion-safe:transition-transform", !open && "-rotate-90")} />
          <span className="flex shrink-0 items-center -space-x-2">
            <RangeSwatches r={r} effects={props.effects} palettes={props.palettes} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{r.name}</span>{" "}
            <span className="truncate text-[13px] tabular-nums text-muted-foreground">
              {rangeLabel(r)} · {rangeSummary(r)}
            </span>
          </span>
        </button>
        <div className="hidden shrink-0 items-center md:flex">
          <FlashButtons r={r} free={free} onFlash={props.onFlash} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" id={rangeMenuId(st.key, i)} variant="ghost" size="icon-sm" className="shrink-0" aria-label={`${r.name} options`}>
              <Icon name="ellipsis" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem reason={locked ? LOCKED : undefined} onSelect={() => props.onRename(i)}>
              <Icon name="pencil" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem reason={mergeReason} onSelect={() => props.onMergeNext(i)}>
              <Icon name="merge" />
              Merge with next
            </DropdownMenuItem>
            <DropdownMenuItem className="text-danger" reason={deleteReason} onSelect={() => props.onDelete(i)}>
              <Icon name="trash-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open ? (
        <div id={body} className="flex flex-col gap-5 border-t p-4 sm:p-5">
          <div className="-ml-2.5 -mt-2 flex flex-wrap md:hidden">
            <FlashButtons r={r} free={free} onFlash={props.onFlash} />
          </div>
          <PatternControls
            uid={`${st.key}-${i}`}
            range={r}
            free={free}
            locked={locked}
            effects={props.effects}
            palettes={props.palettes}
            onRange={(next) => props.onRange(i, next)}
          />
          {r.pattern.kind === "individual" ? (
            props.paintEditor
          ) : (
            <SlotRows strandKey={st.key} i={i} range={r} effects={props.effects} palettes={props.palettes} onOpenSlot={props.onOpenSlot} />
          )}
        </div>
      ) : null}
    </li>
  )
}

export const RangeCard = compose<RangeCardProps & LocalProps, RangeCardProps>(
  // The first card starts open.
  withState("open", "setOpen", (p: RangeCardProps) => p.i === 0),
)(RangeCardView)
