import type { KeyboardEvent, PointerEvent } from "react"
import { compose, withHandlers, withState } from "recompose"
import type { Effect, Palette, RangeView, SlotView, StrandView } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import {
  COLOR_SLOT_LABELS,
  colorName,
  hexOf,
  hexToHsv,
  hsvToHex,
  isHex,
  normHex,
  patternText,
  plural,
  rangeLabel,
  rgbOf,
  type Hsv,
} from "@/lights/model"
import { FORM_DESCRIPTION, FORM_MESSAGE, INPUT, LABEL, PRESSED } from "@/lib/dialogStyles"
import { cn } from "@/lib/utils"
import type { ThunkError } from "@/store/createApiThunk"
import type { Status } from "@/store/slices/lights"
import type { ToastKind } from "@/store/slices/toasts"

const HEADING = "text-sm font-semibold"
const LIST_ROW =
  "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:font-medium"
const GROUP_LABEL = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground"
const SLIDER_KEYS = ["sx", "ix", "c1", "c2", "c3"] as const
const CHECK_KEYS = ["o1", "o2", "o3"] as const
type SliderKey = (typeof SLIDER_KEYS)[number]
type CheckKey = (typeof CHECK_KEYS)[number]
/** What Apply to all slots copies: the effect and its parameters, not the colors. */
const SHARED_KEYS = ["fx", "fxName", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "pal", "palName"] as const

/** The slot the sheet edits: range `r` of strand `key`, slot `s`. */
export type SlotSheetTarget = { key: string; r: number; s: number }

export interface SlotSheetProps {
  /** Null while the sheet is closed. */
  target: SlotSheetTarget | null
  /** The strand `target` names. */
  strand: StrandView | null
  effects: Effect[] | null
  palettes: Palette[] | null
  fxStatus: Status
  fxError: ThunkError | null
  onRetryFx: () => void
  recentColors: string[]
  favoriteEffects: string[]
  /** Sends the strand's new ranges. */
  onEdit: (ranges: RangeView[]) => unknown
  onPushRecent: (hex: string) => unknown
  onToggleFavorite: (name: string) => unknown
  onToast: (kind: ToastKind, title: string, desc?: string) => unknown
  onClose: () => void
}

interface LocalProps {
  colorIdx: number
  setColorIdx: (k: number) => void
  hsv: Hsv
  setHsv: (h: Hsv) => void
  hexDraft: string | null
  setHexDraft: (v: string | null) => void
  fxQuery: string
  setFxQuery: (v: string) => void
  palQuery: string
  setPalQuery: (v: string) => void
  /** Slider values while a drag is in progress. */
  params: Partial<Record<SliderKey, number>>
  setParams: (p: Partial<Record<SliderKey, number>>) => void
  /** The color area drag in progress. Only one pointer drags at a time. */
  areaDrag: { hsv: Hsv } | null
  setAreaDrag: (d: { hsv: Hsv } | null) => void
}

interface HandlerProps {
  onOpenChange: (open: boolean) => void
  onColorSlot: (k: number) => void
  onAreaDown: (e: PointerEvent<HTMLDivElement>) => void
  onAreaMove: (e: PointerEvent<HTMLDivElement>) => void
  onAreaEnd: () => void
  onAreaKey: (e: KeyboardEvent<HTMLDivElement>) => void
  onBriDrag: (pct: number) => void
  onBriCommit: (pct: number) => void
  onHex: (value: string) => void
  onRecent: (hex: string) => void
  onPickFx: (e: Effect) => void
  onPickPal: (p: Palette) => void
  onParamDrag: (f: SliderKey, v: number) => void
  onParamCommit: (f: SliderKey, v: number) => void
  onCheck: (f: CheckKey) => void
  onApplyAll: () => void
}

type BaseProps = SlotSheetProps & LocalProps
type Props = BaseProps & HandlerProps

interface Ctx {
  st: StrandView
  range: RangeView
  slot: SlotView
  target: SlotSheetTarget
}

function ctxOf(p: SlotSheetProps): Ctx | null {
  const { target, strand: st } = p
  const range = target && st?.key === target.key ? st.ranges[target.r] : undefined
  const slot = range?.slots[target!.s]
  return target && st && range && slot ? { st, range, slot, target } : null
}

const metaOf = (fxs: Effect[] | null, slot: SlotView): Effect | undefined => fxs?.find((e) => e.id === slot.fx)
/** The labels of the colors the slot's effect takes; one unnamed color until the effects load. */
const colorLabelsOf = (fxs: Effect[] | null, slot: SlotView): string[] => metaOf(fxs, slot)?.colors ?? ["Fx"]

/** The hue and saturation under the pointer, keeping the brightness. */
function hsvAt(e: PointerEvent<HTMLDivElement>, v: number): Hsv {
  const rect = e.currentTarget.getBoundingClientRect()
  const clamp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)
  const x = clamp((e.clientX - rect.left) / rect.width)
  const y = clamp((e.clientY - rect.top) / rect.height)
  return { h: Math.min(359.9, x * 360), s: 1 - y, v: v || 1 }
}

/** Sends `fn`'s version of the slot. */
function editSlot(p: BaseProps, fn: (s: SlotView) => SlotView) {
  const c = ctxOf(p)
  if (!c) return
  p.onEdit(c.st.ranges.with(c.target.r, { ...c.range, slots: c.range.slots.with(c.target.s, fn(c.slot)) }))
}

/** Sends color `hex` for the selected color slot and remembers it, unless the slot already has it. */
function commitColor(p: BaseProps, hex: string) {
  const c = ctxOf(p)
  if (!c || hexOf(c.slot.col[p.colorIdx] ?? [0, 0, 0]) === hex) return
  editSlot(p, (s) => ({ ...s, col: s.col.with(p.colorIdx, rgbOf(hex)) }))
  p.onPushRecent(hex)
}

function Search({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        type="search"
        className={cn(INPUT, "pl-9")}
        placeholder={label}
        aria-label={label}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** The Effect and Palette parts while the lists are loading. */
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function ColorPart(p: Props & { c: Ctx }) {
  const { slot } = p.c
  const labels = colorLabelsOf(p.effects, slot)
  if (labels.length === 0) return <p className={FORM_DESCRIPTION}>{slot.fxName} takes its colors from the palette.</p>
  const hex = hsvToHex(p.hsv)
  const bad = p.hexDraft !== null && !isHex(p.hexDraft)
  const pct = Math.round(p.hsv.v * 100)
  return (
    <>
      {labels.length > 1 ? (
        <div role="group" aria-label="Color slot" className="flex flex-wrap gap-1.5">
          {labels.map((l, k) => (
            <Button key={k} type="button" variant="outline" size="sm" className={cn(PRESSED, "h-9 gap-2 px-3")} aria-pressed={p.colorIdx === k} onClick={() => p.onColorSlot(k)}>
              <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border border-foreground/20" style={{ background: hexOf(slot.col[k] ?? [0, 0, 0]) }} />
              {COLOR_SLOT_LABELS[l as keyof typeof COLOR_SLOT_LABELS] ?? l}
            </Button>
          ))}
        </div>
      ) : null}
      <div
        id="slot-area"
        role="slider"
        tabIndex={0}
        aria-label="Hue and saturation"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(p.hsv.h)}
        aria-valuetext={`Hue ${Math.round(p.hsv.h)} degrees, saturation ${Math.round(p.hsv.s * 100)}%`}
        className="relative h-36 w-full shrink-0 cursor-crosshair touch-none rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{ background: "linear-gradient(to top,#fff,rgba(255,255,255,0)),linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
        onPointerDown={p.onAreaDown}
        onPointerMove={p.onAreaMove}
        onPointerUp={p.onAreaEnd}
        onPointerCancel={p.onAreaEnd}
        onKeyDown={p.onAreaKey}
      >
        <span
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.55)]"
          style={{ left: `${(p.hsv.h / 360) * 100}%`, top: `${(1 - p.hsv.s) * 100}%`, background: hsvToHex({ ...p.hsv, v: 1 }) }}
        />
      </div>
      <div className="flex items-center gap-3">
        <Icon name="sun" className="size-4 shrink-0 text-muted-foreground" />
        <Slider id="slot-v" aria-label="Color brightness" min={0} max={100} value={pct} onValueChange={p.onBriDrag} onValueCommit={p.onBriCommit} />
        <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-[26px] h-10 w-10 shrink-0 rounded-md border" style={{ background: hex }} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="slot-hex" className={LABEL}>
            Hex
          </label>
          <input
            id="slot-hex"
            className={cn(INPUT, "font-mono uppercase")}
            value={p.hexDraft ?? hex}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-invalid={bad ? true : undefined}
            aria-describedby={bad ? "slot-hex-msg" : undefined}
            onChange={(e) => p.onHex(e.target.value)}
          />
          {bad ? (
            <p id="slot-hex-msg" role="alert" className={FORM_MESSAGE}>
              Enter 6 hex digits, like FF8800.
            </p>
          ) : null}
        </div>
      </div>
      {p.recentColors.length ? (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Recent colors</span>
          <div className="flex flex-wrap gap-2">
            {p.recentColors.map((c) => (
              <button
                key={c}
                type="button"
                className="h-8 w-8 rounded-full border border-foreground/15 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{ background: c }}
                aria-label={`Use ${colorName(c)}`}
                onClick={() => p.onRecent(c)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

function FxRow({ e, grp, p, c }: { e: Effect; grp: string; p: Props; c: Ctx }) {
  const fav = p.favoriteEffects.includes(e.name)
  const on = e.id === c.slot.fx
  return (
    <li className="flex items-center gap-1">
      <button type="button" id={`fx-${grp}-${e.id}`} className={cn(LIST_ROW, "flex-1")} aria-pressed={on} onClick={() => p.onPickFx(e)}>
        <span className="flex w-4 shrink-0 justify-center">{on ? <Icon name="check" /> : null}</span>
        <span className="truncate">{e.name}</span>
        {e.pal ? (
          <span className="ml-auto" title="Uses a palette">
            <Icon name="palette" className="size-3.5 text-muted-foreground" />
          </span>
        ) : null}
      </button>
      <Button type="button" id={`fav-${grp}-${e.id}`} variant="ghost" size="icon-sm" aria-pressed={fav} aria-label={`Favorite ${e.name}`} onClick={() => p.onToggleFavorite(e.name)}>
        <Icon name="star" className={fav ? "fill-primary text-primary" : "text-muted-foreground"} />
      </Button>
    </li>
  )
}

/** The effect's own sliders and checkboxes. */
function Params({ meta, p, c }: { meta: Effect; p: Props; c: Ctx }) {
  return (
    <>
      {meta.sliders.map((label, k) => {
        const f = SLIDER_KEYS[k]
        if (!label || !f) return null
        const max = f === "c3" ? 31 : 255
        const val = p.params[f] ?? c.slot[f]
        return (
          <div key={f} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`fxp-${f}`} className="text-sm font-medium">
                {label}
              </label>
              <span className="text-[13px] tabular-nums text-muted-foreground">{Math.round((val / max) * 100)}%</span>
            </div>
            <Slider id={`fxp-${f}`} aria-label={label} min={0} max={max} value={val} onValueChange={(v) => p.onParamDrag(f, v)} onValueCommit={(v) => p.onParamCommit(f, v)} />
          </div>
        )
      })}
      {meta.checks.some(Boolean) ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {meta.checks.map((label, k) => {
            const f = CHECK_KEYS[k]
            if (!label || !f) return null
            return (
              <label key={f} className="flex min-h-6 cursor-pointer items-center gap-2.5 text-sm">
                <input type="checkbox" className="size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={c.slot[f]} onChange={() => p.onCheck(f)} />
                {label}
              </label>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

function EffectPart(p: Props & { c: Ctx }) {
  const { c } = p
  const q = p.fxQuery.trim().toLowerCase()
  const sorted = (p.effects ?? []).filter((e) => !/RSVD/.test(e.name)).sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : a.name.localeCompare(b.name)))
  const shown = sorted.filter((e) => !q || e.name.toLowerCase().includes(q))
  const favs = shown.filter((e) => p.favoriteEffects.includes(e.name))
  const meta = metaOf(p.effects, c.slot)
  return (
    <>
      <Search id="fx-search" label="Search effects" value={p.fxQuery} onChange={p.setFxQuery} />
      <div className="max-h-72 overflow-y-auto rounded-md border p-1">
        {favs.length ? (
          <>
            <p className={GROUP_LABEL}>Favorites</p>
            <ul>
              {favs.map((e) => (
                <FxRow key={e.id} e={e} grp="fav" p={p} c={c} />
              ))}
            </ul>
          </>
        ) : null}
        <p className={GROUP_LABEL}>All effects</p>
        <ul>
          {shown.map((e) => (
            <FxRow key={e.id} e={e} grp="all" p={p} c={c} />
          ))}
        </ul>
        {!shown.length ? <p className="px-2 py-3 text-sm text-muted-foreground">No effects match “{p.fxQuery}”.</p> : null}
      </div>
      {meta ? <Params meta={meta} p={p} c={c} /> : null}
    </>
  )
}

function PalettePart(p: Props & { c: Ctx }) {
  const { slot } = p.c
  const q = p.palQuery.trim().toLowerCase()
  const shown = (p.palettes ?? []).filter((x) => !q || x.name.toLowerCase().includes(q))
  return (
    <>
      <Search id="pal-search" label="Search palettes" value={p.palQuery} onChange={p.setPalQuery} />
      <ul className="max-h-60 overflow-y-auto rounded-md border p-1">
        {shown.map((x) => (
          <li key={x.id}>
            <button type="button" id={`pal-${x.id}`} className={LIST_ROW} aria-pressed={x.id === slot.pal} onClick={() => p.onPickPal(x)}>
              <span
                aria-hidden="true"
                className="h-4 w-16 shrink-0 rounded-sm border border-foreground/10"
                style={{ background: x.stops.length ? `linear-gradient(90deg,${x.stops.join(",")})` : hexOf(slot.col[0] ?? [0, 0, 0]) }}
              />
              <span className="truncate">{x.name}</span>
              {x.id === slot.pal ? <Icon name="check" className="ml-auto size-4" /> : null}
            </button>
          </li>
        ))}
        {!shown.length ? <li className="px-2 py-3 text-sm text-muted-foreground">No palettes match “{p.palQuery}”.</li> : null}
      </ul>
    </>
  )
}

function SlotSheetView(p: Props) {
  const c = ctxOf(p)
  if (!c) return <Sheet open={false} />
  const { range, slot } = c
  const title = range.slots.length > 1 ? `Slot ${c.target.s + 1} · ${range.name}` : range.name
  const loading = p.fxStatus !== "ok" && p.fxStatus !== "error"
  const failed = p.fxStatus === "error"
  const meta = metaOf(p.effects, slot)
  return (
    <Sheet open onOpenChange={p.onOpenChange}>
      <SheetContent
        aria-describedby="slot-sub"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription id="slot-sub">{`${c.st.name} · ${rangeLabel(range)} · ${patternText(range.pattern)}`}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-7 overflow-y-auto p-4 sm:p-5">
          <section aria-labelledby="slot-color-h" className="flex flex-col gap-3">
            <h3 id="slot-color-h" className={HEADING}>
              Color
            </h3>
            <ColorPart {...p} c={c} />
          </section>
          <section aria-labelledby="slot-fx-h" className="flex flex-col gap-3">
            <h3 id="slot-fx-h" className={HEADING}>
              Effect
            </h3>
            {loading ? <ListSkeleton /> : null}
            {failed ? (
              <div className="flex flex-col items-start gap-2 rounded-md border p-3">
                <p role="alert" className={FORM_MESSAGE}>
                  {p.fxError?.message ?? ""}
                </p>
                <Button type="button" variant="outline" size="sm" leadingIcon="rotate-cw" onClick={p.onRetryFx}>
                  Try again
                </Button>
              </div>
            ) : null}
            {!loading && !failed ? <EffectPart {...p} c={c} /> : null}
          </section>
          {loading || (!failed && meta?.pal) ? (
            <section aria-labelledby="slot-pal-h" className="flex flex-col gap-3">
              <h3 id="slot-pal-h" className={HEADING}>
                Palette
              </h3>
              {loading ? <ListSkeleton /> : <PalettePart {...p} c={c} />}
            </section>
          ) : null}
          <p className="text-[13px] text-muted-foreground">Changes go to the lights as you make them.</p>
        </div>
        <SheetFooter>
          {range.slots.length > 1 ? (
            <Button type="button" variant="outline" className="flex-1" leadingIcon="copy" onClick={p.onApplyAll}>
              Apply to all slots
            </Button>
          ) : null}
          <Button type="button" className="flex-1" onClick={() => p.onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Moves the color area's marker and sends the color; `dh` and `ds` are the steps. */
function nudge(p: BaseProps, dh: number, ds: number) {
  const h = { h: (p.hsv.h + dh + 360) % 360, s: Math.max(0, Math.min(1, p.hsv.s + ds)), v: p.hsv.v || 1 }
  p.setHsv(h)
  p.setHexDraft(null)
  commitColor(p, hsvToHex(h))
}

/**
 * The slot editor: a bottom sheet below 900 px, a side sheet above. Every change goes to the lights at
 * once; the color area and the sliders send when released.
 */
export const SlotSheet = compose<Props, SlotSheetProps>(
  withState("colorIdx", "setColorIdx", 0),
  withState("hsv", "setHsv", (p: SlotSheetProps) => hexToHsv(hexOf(ctxOf(p)?.slot.col[0] ?? [0, 0, 0]))),
  withState("hexDraft", "setHexDraft", null),
  withState("fxQuery", "setFxQuery", ""),
  withState("palQuery", "setPalQuery", ""),
  withState("params", "setParams", {}),
  withState("areaDrag", "setAreaDrag", null),
  withHandlers<BaseProps, HandlerProps>({
    onOpenChange: (p) => (open: boolean) => {
      if (!open) p.onClose()
    },
    onColorSlot: (p) => (k: number) => {
      const slot = ctxOf(p)?.slot
      if (!slot) return
      p.setColorIdx(k)
      p.setHsv(hexToHsv(hexOf(slot.col[k] ?? [0, 0, 0])))
      p.setHexDraft(null)
    },
    onAreaDown: (p) => (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      e.currentTarget.focus()
      const h = hsvAt(e, p.hsv.v)
      p.setAreaDrag({ hsv: h })
      p.setHsv(h)
      p.setHexDraft(null)
    },
    onAreaMove: (p) => (e: PointerEvent<HTMLDivElement>) => {
      if (!p.areaDrag) return
      const h = hsvAt(e, p.areaDrag.hsv.v)
      p.setAreaDrag({ hsv: h })
      p.setHsv(h)
    },
    onAreaEnd: (p) => () => {
      const d = p.areaDrag
      p.setAreaDrag(null)
      if (d) commitColor(p, hsvToHex(d.hsv))
    },
    onAreaKey: (p) => (e: KeyboardEvent<HTMLDivElement>) => {
      const dh = { ArrowLeft: -1, ArrowRight: 1 }[e.key as string]
      const ds = { ArrowDown: -1, ArrowUp: 1 }[e.key as string]
      if (!dh && !ds) return
      e.preventDefault()
      nudge(p, (dh ?? 0) * (e.shiftKey ? 30 : 5), (ds ?? 0) * (e.shiftKey ? 0.2 : 0.05))
    },
    onBriDrag: (p) => (pct: number) => {
      p.setHsv({ ...p.hsv, v: pct / 100 })
      p.setHexDraft(null)
    },
    onBriCommit: (p) => (pct: number) => {
      commitColor(p, hsvToHex({ ...p.hsv, v: pct / 100 }))
    },
    onHex: (p) => (value: string) => {
      p.setHexDraft(value)
      if (!isHex(value)) return
      const hex = normHex(value)
      p.setHsv(hexToHsv(hex))
      commitColor(p, hex)
    },
    onRecent: (p) => (hex: string) => {
      p.setHsv(hexToHsv(hex))
      p.setHexDraft(null)
      commitColor(p, hex)
    },
    onPickFx: (p) => (e: Effect) => {
      p.setParams({})
      if (p.colorIdx >= Math.max(1, e.colors.length)) p.setColorIdx(0)
      editSlot(p, (s) => ({ ...s, fx: e.id, fxName: e.name }))
    },
    onPickPal: (p) => (x: Palette) => {
      editSlot(p, (s) => ({ ...s, pal: x.id, palName: x.name }))
    },
    onParamDrag: (p) => (f: SliderKey, v: number) => {
      p.setParams({ ...p.params, [f]: v })
    },
    onParamCommit: (p) => (f: SliderKey, v: number) => {
      p.setParams({ ...p.params, [f]: undefined })
      editSlot(p, (s) => ({ ...s, [f]: v }))
    },
    onCheck: (p) => (f: CheckKey) => {
      editSlot(p, (s) => ({ ...s, [f]: !s[f] }))
    },
    onApplyAll: (p) => () => {
      const c = ctxOf(p)
      if (!c) return
      const src = c.slot
      const slots = c.range.slots.map((s, k) => (k === c.target.s ? s : { ...s, ...Object.fromEntries(SHARED_KEYS.map((x) => [x, src[x]])) }))
      if (!p.onEdit(c.st.ranges.with(c.target.r, { ...c.range, slots }))) return
      p.onToast("success", `${src.fxName} is on ${plural(slots.length - 1, "other slot")} too`, "Their colors stay as they were.")
    },
  }),
)(SlotSheetView)
