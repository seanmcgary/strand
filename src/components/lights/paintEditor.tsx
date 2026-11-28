import type { ChangeEvent, KeyboardEvent, PointerEvent } from "react"
import { compose, lifecycle, withHandlers, withState } from "recompose"
import type { StrandView } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { colorName } from "@/lights/model"
import { cn } from "@/lib/utils"

/** Cells on a narrow and on a wide screen (the design's 900 px desktop breakpoint, as the slot sheet uses). */
const CELLS = { narrow: 48, wide: 120 }
const WIDE = "(min-width: 900px)"
const BLACK = "#000000"
const HELP = "Tap or drag to paint. The lights change when you let go. With a keyboard: arrow keys move, Space paints."
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** The store actions the editor dispatches. */
export interface PaintActions {
  beginPaint: (a: { id: string; key: string }) => unknown
  paintCells: (a: { id: string; key: string; i: number; from: number; to: number; color: string }) => unknown
  endPaint: (a: { id: string; key: string }) => unknown
  editStrand: (a: { id: string; key: string; patch: { ranges: StrandView["ranges"] } }) => unknown
  pushRecentColor: (hex: string) => unknown
}

export interface PaintEditorProps {
  /** The device's id. */
  id: string
  strand: StrandView
  /** The index of the Individual range on the strand. */
  i: number
  brush: string
  recentColors: string[]
  onBrush: (hex: string) => void
  actions: PaintActions
}

interface LocalProps {
  /** The keyboard cursor, as a cell. */
  cursor: number
  setCursor: (c: number) => void
  wide: boolean
  setWide: (w: boolean) => void
  /** The stroke in progress: the last cell it painted. Only one pointer paints at a time. */
  stroke: { last: number } | null
  setStroke: (s: { last: number } | null) => void
}

interface HandlerProps {
  onDown: (e: PointerEvent<HTMLDivElement>) => void
  onMove: (e: PointerEvent<HTMLDivElement>) => void
  onEnd: () => void
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void
  onColor: (e: ChangeEvent<HTMLInputElement>) => void
  onFill: () => void
  onClear: () => void
}

type BaseProps = PaintEditorProps & LocalProps
type Props = BaseProps & HandlerProps

/** First LED of cell `c`. Integer math, so 192 LEDs in 96 cells never rounds a cell short. */
const cellStart = (len: number, cells: number, c: number): number => Math.floor((c * len) / cells)

function ctxOf(p: BaseProps) {
  const r = p.strand.ranges[p.i]
  if (!r) return null
  const cells = Math.min(r.len, p.wide ? CELLS.wide : CELLS.narrow)
  return { r, cells, cur: Math.min(cells - 1, p.cursor) }
}

/** Paints cells `from` to `to` (inclusive) with the brush. */
function paintSpan(p: BaseProps, from: number, to: number) {
  const c = ctxOf(p)
  if (!c) return
  const a = cellStart(c.r.len, c.cells, from)
  const b = Math.max(a + 1, cellStart(c.r.len, c.cells, to + 1))
  p.actions.paintCells({ id: p.id, key: p.strand.key, i: p.i, from: a, to: b - 1, color: p.brush })
  p.setCursor(to)
}

/** The cell under the pointer, held to the strip while the drag leaves it. */
function cellAt(e: PointerEvent<HTMLDivElement>, cells: number): number {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  return Number.isFinite(x) ? Math.max(0, Math.min(cells - 1, Math.floor(x * cells))) : 0
}

/** Sends a whole-range paint of `color`. */
function fillWith(p: BaseProps, color: string) {
  const c = ctxOf(p)
  if (!c) return
  p.actions.editStrand({ id: p.id, key: p.strand.key, patch: { ranges: p.strand.ranges.with(p.i, { ...c.r, paint: Array(c.r.len).fill(color) }) } })
}

function PaintEditorView(p: Props) {
  const c = ctxOf(p)
  if (!c) return null
  const { r, cells, cur } = c
  const paint = r.paint ?? []
  const curLed = cellStart(r.len, cells, cur)
  const uid = `${p.strand.key}-${p.i}`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`brush-${uid}`} className="flex items-center gap-2 text-sm font-medium">
          <Icon name="paintbrush" className="size-4 text-muted-foreground" />
          Brush
          <span className="relative h-8 w-8 overflow-hidden rounded-full border border-input shadow-sm focus-within:ring-2 focus-within:ring-ring" style={{ background: p.brush }}>
            <input
              type="color"
              id={`brush-${uid}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={p.brush.toLowerCase()}
              onChange={p.onColor}
            />
          </span>
          <span className="font-mono text-xs font-normal text-muted-foreground">{p.brush}</span>
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Recent colors">
          {p.recentColors.slice(0, 6).map((col) => (
            <button
              key={col}
              type="button"
              className={cn("h-6 w-6 rounded-full border border-foreground/15 shadow-sm", RING)}
              style={{ background: col }}
              aria-label={`Brush ${colorName(col)}`}
              aria-pressed={col.toUpperCase() === p.brush.toUpperCase()}
              onClick={() => p.onBrush(col.toUpperCase())}
            />
          ))}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button type="button" variant="outline" size="sm" leadingIcon="droplet" onClick={p.onFill}>
            Fill range
          </Button>
          <Button type="button" variant="outline" size="sm" leadingIcon="eraser" onClick={p.onClear}>
            Clear
          </Button>
        </div>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Paint ${r.name}`}
        aria-valuemin={r.start}
        aria-valuemax={r.start + r.len - 1}
        aria-valuenow={r.start + curLed}
        aria-valuetext={`LED ${r.start + curLed}, ${colorName(paint[curLed] ?? BLACK)}`}
        aria-describedby={`paint-help-${uid}`}
        className={cn("group flex h-11 cursor-crosshair touch-none gap-px overflow-hidden rounded-md border bg-black outline-none", RING)}
        onPointerDown={p.onDown}
        onPointerMove={p.onMove}
        onPointerUp={p.onEnd}
        onPointerCancel={p.onEnd}
        onKeyDown={p.onKey}
      >
        {Array.from({ length: cells }, (_, k) => {
          const a = cellStart(r.len, cells, k)
          const b = Math.max(a + 1, cellStart(r.len, cells, k + 1))
          return (
            <span
              key={k}
              className={cn("h-full min-w-0 flex-1 rounded-[2px]", k === cur && "group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-white")}
              style={{ background: paint[Math.floor((a + b - 1) / 2)] ?? BLACK }}
            />
          )
        })}
      </div>
      <p id={`paint-help-${uid}`} className="text-[13px] leading-snug text-muted-foreground">
        {HELP}
      </p>
    </div>
  )
}

export const PaintEditor = compose<Props, PaintEditorProps>(
  withState("cursor", "setCursor", 0),
  withState("wide", "setWide", () => !!globalThis.matchMedia?.(WIDE).matches),
  withState("stroke", "setStroke", null),
  lifecycle<BaseProps, object, { stop?: () => void }>({
    componentDidMount() {
      const mq = globalThis.matchMedia?.(WIDE)
      if (!mq) return
      const on = (e: MediaQueryListEvent) => this.props.setWide(e.matches)
      mq.addEventListener("change", on)
      this.stop = () => mq.removeEventListener("change", on)
    },
    componentWillUnmount() {
      this.stop?.()
      if (this.props.stroke) this.props.actions.endPaint({ id: this.props.id, key: this.props.strand.key })
    },
  }),
  withHandlers<BaseProps, HandlerProps>({
    onDown: (p) => (e: PointerEvent<HTMLDivElement>) => {
      const c = ctxOf(p)
      if (!c || e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      e.currentTarget.focus()
      const cell = cellAt(e, c.cells)
      p.setStroke({ last: cell })
      p.actions.beginPaint({ id: p.id, key: p.strand.key })
      paintSpan(p, cell, cell)
    },
    onMove: (p) => (e: PointerEvent<HTMLDivElement>) => {
      const c = ctxOf(p)
      if (!p.stroke || !c) return
      const cell = cellAt(e, c.cells)
      // Fill the cells a fast drag skipped over.
      paintSpan(p, Math.min(p.stroke.last, cell), Math.max(p.stroke.last, cell))
      p.setStroke({ last: cell })
      p.setCursor(cell)
    },
    onEnd: (p) => () => {
      if (!p.stroke) return
      p.setStroke(null)
      p.actions.endPaint({ id: p.id, key: p.strand.key })
      p.actions.pushRecentColor(p.brush)
    },
    onKey: (p) => (e: KeyboardEvent<HTMLDivElement>) => {
      const c = ctxOf(p)
      if (!c) return
      const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key as string]
      if (dir) {
        e.preventDefault()
        p.setCursor(Math.max(0, Math.min(c.cells - 1, c.cur + dir * (e.shiftKey ? 10 : 1))))
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        const key = p.strand.key
        p.actions.beginPaint({ id: p.id, key })
        paintSpan(p, c.cur, c.cur)
        p.actions.endPaint({ id: p.id, key })
        p.actions.pushRecentColor(p.brush)
      }
    },
    onColor: (p) => (e: ChangeEvent<HTMLInputElement>) => p.onBrush(e.target.value.toUpperCase()),
    onFill: (p) => () => {
      fillWith(p, p.brush)
      p.actions.pushRecentColor(p.brush)
    },
    onClear: (p) => () => fillWith(p, BLACK),
  }),
)(PaintEditorView)
