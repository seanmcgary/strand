import type { KeyboardEvent, PointerEvent } from "react"
import { compose, withState } from "recompose"
import type { Effect, Palette, RangeView, StrandView } from "../../../shared/apiTypes"
import { handleId, ledColors, minLen, moveBoundary } from "@/lights/model"
import { cn } from "@/lib/utils"

const MAX_CELLS = 120
const KEY_STEP: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }

export interface StripProps {
  strand: StrandView
  effects: Effect[] | null
  palettes: Palette[] | null
  /** The LED the strip marks as flashing, or null. */
  flashLed: number | null
  /** A boundary moved: the strand's new range list. */
  onRanges: (ranges: RangeView[]) => void
}

interface DragState {
  /** The handle being dragged, or null. */
  dragging: number | null
  setDragging: (i: number | null) => void
}

type Props = StripProps & DragState

const pct = (x: number, len: number) => `${((x / len) * 100).toFixed(3)}%`

/** The strip: one cell per LED (scaled to fit), range boundaries as draggable sliders. */
function StripView({ strand: st, effects, palettes, flashLed, onRanges, dragging, setDragging }: Props) {
  const cells = Math.min(st.len, MAX_CELLS)
  const per = st.len / cells
  const colors = ledColors(effects, palettes, st)
  const locked = !!st.shared

  const move = (i: number, led: number) => {
    const next = moveBoundary(st.ranges, i, led)
    if (next) onRanges(next)
  }
  const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return
    const el = e.currentTarget
    const now = Number(el.getAttribute("aria-valuenow"))
    let to: number
    if (e.key in KEY_STEP) to = now + KEY_STEP[e.key]! * (e.shiftKey ? 10 : 1)
    else if (e.key === "Home") to = Number(el.getAttribute("aria-valuemin"))
    else if (e.key === "End") to = Number(el.getAttribute("aria-valuemax"))
    else return
    e.preventDefault()
    move(i, to)
  }
  const onDown = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    if ("setPointerCapture" in el) el.setPointerCapture(e.pointerId)
    el.focus()
    setDragging(i)
  }
  const onMove = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (dragging !== i) return
    const rect = e.currentTarget.parentElement!.getBoundingClientRect()
    move(i, ((e.clientX - rect.left) / rect.width) * st.len)
  }
  const onEnd = () => setDragging(null)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">
        <span>0</span>
        <span>{st.len - 1}</span>
      </div>
      <div role="group" aria-label={`${st.name} LEDs and range boundaries`} className="relative">
        <div className={cn("flex h-9 gap-0 overflow-hidden rounded-md border bg-black sm:gap-px", !st.on && "opacity-40")} aria-hidden="true">
          {Array.from({ length: cells }, (_, c) => {
            const a = Math.floor(c * per)
            const b = Math.max(a + 1, Math.floor((c + 1) * per))
            const lit = flashLed !== null && flashLed >= a && flashLed < b
            return (
              <span
                key={c}
                className={cn("h-full min-w-0 flex-1 sm:rounded-[2px]", lit && "motion-safe:animate-pulse")}
                style={{ background: lit ? "#FFFFFF" : colors[Math.min(st.len - 1, Math.floor((a + b - 1) / 2))] }}
              />
            )
          })}
        </div>
        {st.ranges.map((r, i) => {
          const nx = st.ranges[i + 1]
          if (!nx || r.start + r.len !== nx.start) return null
          const pos = nx.start
          return (
            <div
              key={i}
              role="slider"
              id={handleId(st.key, i)}
              tabIndex={locked ? -1 : 0}
              aria-label={`Boundary between ${r.name} and ${nx.name}`}
              aria-valuemin={r.start + minLen(r)}
              aria-valuemax={nx.start + nx.len - minLen(nx)}
              aria-valuenow={pos}
              aria-valuetext={`LED ${pos}`}
              aria-disabled={locked ? true : undefined}
              onKeyDown={onKey(i)}
              onPointerDown={onDown(i)}
              onPointerMove={onMove(i)}
              onPointerUp={onEnd}
              onPointerCancel={onEnd}
              className="group absolute -bottom-2 -top-2 z-20 flex w-7 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none aria-disabled:cursor-not-allowed"
              style={{ left: pct(pos, st.len) }}
            >
              <span className="h-full w-1.5 rounded-full border border-background bg-foreground shadow transition-transform group-hover:scale-x-125 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background group-aria-disabled:opacity-40" />
              <span
                className={cn(
                  "pointer-events-none absolute -top-7 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums text-background shadow",
                  dragging === i ? "block" : "hidden group-focus-visible:block",
                )}
              >
                LED {pos}
              </span>
            </div>
          )
        })}
      </div>
      <div className="relative h-5 text-xs text-muted-foreground" aria-hidden="true">
        {st.ranges.map((r, i) => (
          <span key={i} className="absolute top-0 truncate px-1 text-center" style={{ left: pct(r.start, st.len), width: pct(r.len, st.len) }} title={r.name}>
            {r.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export const Strip = compose<Props, StripProps>(withState("dragging", "setDragging", null))(StripView)
