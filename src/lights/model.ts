import type { Effect, LedOutput, Palette, Pattern, RangeView, SlotView, StrandView } from "../../shared/apiTypes"
import { segmentName } from "../../shared/segmentName"

/** Pure helpers for the Lights tab: how a range reads, previews and edits. `fxs` and `pals` are null until the lists load. */

export const SLOT_COLORS = ["#FFB46B", "#FF0000", "#00C850", "#0050FF", "#FFFFFF", "#FF00B4", "#FFA000", "#8000FF"]
export const COLOR_NAMES: Record<string, string> = {
  "#FFB46B": "Warm white",
  "#FFFFFF": "White",
  "#FF0000": "Red",
  "#00C850": "Green",
  "#0050FF": "Blue",
  "#FFA000": "Orange",
  "#FF00B4": "Pink",
  "#8000FF": "Purple",
  "#00FFFF": "Cyan",
  "#000000": "Off",
}
export const COLOR_SLOT_LABELS = { Fx: "Main", Bg: "Background", Cs: "Accent" }
export const LOCKED = "Choose Split by strand or Combine strands first."

const MAX_SLOTS = 16
const MAX_GROUP = 255
const NAME_CHARS = 64

const rgbOf = (hex: string): number[] => {
  const n = parseInt(hex.replace("#", ""), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hexOf = (rgb: number[]): string => `#${rgb.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`
const clone = <T>(v: T): T => structuredClone(v)

export const colorName = (hex: string): string => COLOR_NAMES[hex.toUpperCase()] ?? hex.toUpperCase()
export const briToPct = (bri: number): number => Math.max(1, Math.round((bri / 255) * 100))
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`

export function pinLabel(pins: number[]): string {
  const set = pins.filter((p) => p >= 0)
  if (!set.length) return "No pin"
  return set.length === 1 ? `GPIO ${set[0]}` : `GPIO ${set.join(", ")}`
}

export function rangeLabel(o: { start: number; len: number }): string {
  const len = Number.isFinite(o.len) ? o.len : 0
  if (len <= 1) return `LED ${o.start}`
  return `LEDs ${o.start}–${o.start + len - 1}`
}

/** Segments a list of ranges uses: one per slot, one for All and Individual. */
export const segsOf = (ranges: RangeView[]): number => ranges.reduce((t, r) => t + (r.pattern.kind === "every" ? r.pattern.n : 1), 0)
export const freeSegs = (view: { segments: { used: number; max: number } }): number => view.segments.max - view.segments.used

/**
 * Segments an edit from `st.ranges` to `next` adds, as the server counts them. A shared strand adds none.
 * On a strand marked normalize the server removes every segment inside it, so segments the view leaves out
 * count as removed there; the browser cannot see them, so its figure is an upper bound.
 */
export const segsNeeded = (st: StrandView, next: RangeView[]): number => (st.shared ? 0 : segsOf(next) - segsOf(st.ranges))

export const needMsg = (need: number, free: number): string => `This needs ${plural(need, "more segment")} and ${free} ${free === 1 ? "is" : "are"} free. Remove a range first.`

export function patternText(p: Pattern): string {
  if (p.kind === "every") return `Every ${p.n} · group ${p.group}`
  return p.kind === "individual" ? "Individual" : "All"
}

export const rangeSummary = (r: RangeView): string => (r.pattern.kind === "all" ? `All · ${r.slots[0]!.fxName}` : patternText(r.pattern))

const fxMeta = (fxs: Effect[] | null, fx: number): Effect | undefined => fxs?.find((e) => e.id === fx)

export function usesPalette(fxs: Effect[] | null, slot: SlotView): boolean {
  const m = fxMeta(fxs, slot.fx)
  return !!m?.pal && (m.colors.length === 0 || slot.pal !== 0)
}

/** The palette's stops, or null when the lists are not loaded, the palette is unknown, or it has no stops (the slot's first color shows). */
function palStops(pals: Palette[] | null, pal: number): string[] | null {
  const stops = pals?.find((p) => p.id === pal)?.stops
  return stops && stops.length > 0 ? stops : null
}

/** The color the strip shows for a slot at position t (0 to 1) along its range. */
export function slotColorAt(fxs: Effect[] | null, pals: Palette[] | null, slot: SlotView, t: number): string {
  if (!slot.on) return "#000000"
  const stops = usesPalette(fxs, slot) ? palStops(pals, slot.pal) : null
  if (stops) return stops[Math.min(stops.length - 1, Math.floor(t * stops.length))]!
  return hexOf(slot.col[0]!)
}

export function slotBackground(fxs: Effect[] | null, pals: Palette[] | null, slot: SlotView): string {
  const stops = usesPalette(fxs, slot) ? palStops(pals, slot.pal) : null
  return stops ? `linear-gradient(135deg,${stops.join(",")})` : hexOf(slot.col[0]!)
}

export function slotText(fxs: Effect[] | null, slot: SlotView): string {
  const m = fxMeta(fxs, slot.fx)
  if (m && m.colors.length === 0) return `${slot.fxName} · ${slot.palName}`
  return `${colorName(hexOf(slot.col[0]!))} · ${slot.fxName}${usesPalette(fxs, slot) ? ` · ${slot.palName}` : ""}`
}

/** One color per LED of a strand, by each range's pattern. */
export function ledColors(fxs: Effect[] | null, pals: Palette[] | null, st: { len: number; ranges: RangeView[] }): string[] {
  const out: string[] = Array(st.len).fill("#000000")
  for (const r of st.ranges) {
    const n = r.pattern.kind === "every" ? r.pattern.n : 1
    const g = r.pattern.kind === "every" ? r.pattern.group : 1
    for (let k = 0; k < r.len; k++) {
      out[r.start + k] = r.pattern.kind === "individual" ? (r.paint?.[k] ?? "#000000") : slotColorAt(fxs, pals, r.slots[Math.floor(k / g) % n]!, k / r.len)
    }
  }
  return out
}

export const rangeColors = (fxs: Effect[] | null, pals: Palette[] | null, r: RangeView): string[] => ledColors(fxs, pals, { len: r.len, ranges: [{ ...r, start: 0 }] })

/** The name a device keeps: trimmed, then cut to 32 bytes. Two ranges with the same one cannot be read back apart. */
const keptName = (name: string): string => segmentName(name.trim(), "")

export function nextRangeName(ranges: RangeView[]): string {
  const taken = new Set(ranges.map((r) => keptName(r.name)))
  let n = 2
  while (taken.has(`Range ${n}`)) n++
  return `Range ${n}`
}

/** Why `name` cannot name range `i`, or null. */
export function nameError(ranges: RangeView[], i: number, name: string): string | null {
  const chars = [...name.trim()].length
  if (chars < 1 || chars > NAME_CHARS) return "A name needs 1 to 64 characters."
  const kept = keptName(name)
  return ranges.some((r, k) => k !== i && keptName(r.name) === kept) ? "Another range has this name." : null
}

export function newSlot(slots: SlotView[]): SlotView {
  const s = clone(slots.at(-1)!)
  const used = slots.map((x) => hexOf(x.col[0]!))
  s.col[0] = rgbOf(SLOT_COLORS.find((c) => !used.includes(c)) ?? SLOT_COLORS[slots.length % SLOT_COLORS.length]!)
  return s
}

/** A range with a new pattern: slots kept where they fit, paint taken from what it shows now. */
export function withPattern(fxs: Effect[] | null, pals: Palette[] | null, r: RangeView, p: Pattern): RangeView {
  const out: RangeView = { ...clone(r), pattern: clone(p) }
  delete out.paint
  if (p.kind === "every") {
    out.slots = []
    for (let k = 0; k < p.n; k++) {
      const kept = r.slots[k]
      out.slots.push(kept ? clone(kept) : newSlot(out.slots.length ? out.slots : r.slots))
    }
  } else {
    out.slots = [clone(r.slots[0]!)]
  }
  if (p.kind === "individual") out.paint = rangeColors(fxs, pals, r)
  return out
}

/** A preview of the Every N order, e.g. "1 1 2 2 1 1 2 2 …". */
export function everyPreview(n: number, g: number): string {
  const seq = Array.from({ length: Math.min(16, n * g * 2) }, (_, k) => (Math.floor(k / g) % n) + 1)
  return `${seq.join(" ")} …`
}

/** The fewest LEDs a range can have: an Every range needs `(n - 1) * group + 1`. */
export const minLen = (r: RangeView): number => (r.pattern.kind === "every" ? (r.pattern.n - 1) * r.pattern.group + 1 : 1)

/** A range cut to `len` LEDs; an Every range left too short becomes All with its first slot. */
function resized(r: RangeView, len: number): RangeView {
  const out: RangeView = { ...r, len }
  return minLen(out) > len ? { ...out, pattern: { kind: "all" }, slots: [r.slots[0]!] } : out
}

/** Splits range `i` in two (Add range). The second half takes `name`. Null when the range has one LED. */
export function splitRange(rs: RangeView[], i: number, name: string): RangeView[] | null {
  const r = rs[i]
  if (!r || r.len < 2) return null
  const half = Math.floor(r.len / 2)
  const a = resized(clone(r), half)
  const b = resized({ ...clone(r), name, start: r.start + half }, r.len - half)
  if (r.paint) {
    a.paint = r.paint.slice(0, half)
    b.paint = r.paint.slice(half)
  }
  return rs.with(i, a).toSpliced(i + 1, 0, b)
}

/** Merges range `drop` into its neighbor `keep`; the result keeps `keep`'s name, pattern and slots. */
export function mergeInto(fxs: Effect[] | null, pals: Palette[] | null, rs: RangeView[], keep: number, drop: number): RangeView[] {
  const a = clone(rs[keep]!)
  const b = rs[drop]!
  if (a.paint) a.paint = keep < drop ? [...a.paint, ...rangeColors(fxs, pals, b)] : [...rangeColors(fxs, pals, b), ...a.paint]
  a.start = Math.min(a.start, b.start)
  a.len += b.len
  return rs.with(keep, a).filter((_, k) => k !== drop)
}

/**
 * Moves the boundary between range `i` and `i + 1` to `led`, snapped to a whole LED and kept where both
 * ranges still fit their pattern. Null when nothing changes.
 */
export function moveBoundary(rs: RangeView[], i: number, led: number): RangeView[] | null {
  const a = rs[i]
  const b = rs[i + 1]
  if (!a || !b) return null
  const end = b.start + b.len
  const lo = a.start + minLen(a)
  const hi = end - minLen(b)
  if (lo > hi) return null
  const pos = Math.max(lo, Math.min(hi, Math.round(led)))
  if (pos === b.start) return null
  const seq = [...(a.paint ?? Array<string | null>(a.len).fill(null)), ...(b.paint ?? Array<string | null>(b.len).fill(null))]
  const aLast = a.paint?.at(-1) ?? "#000000"
  const bFirst = b.paint?.[0] ?? "#000000"
  const x: RangeView = { ...clone(a), len: pos - a.start }
  const y: RangeView = { ...clone(b), start: pos, len: end - pos }
  if (a.paint) x.paint = seq.slice(0, x.len).map((c) => c ?? aLast)
  if (b.paint) y.paint = seq.slice(x.len).map((c) => c ?? bFirst)
  return rs.with(i, x).with(i + 1, y)
}

/** Pairs of neighboring strands whose LEDs touch and that are not shared; those can be combined. */
export function adjacentPairs(view: { strands: StrandView[] }): [StrandView, StrandView][] {
  const out: [StrandView, StrandView][] = []
  for (let i = 0; i + 1 < view.strands.length; i++) {
    const a = view.strands[i]!
    const b = view.strands[i + 1]!
    if (a.start + a.len === b.start && !a.shared && !b.shared) out.push([a, b])
  }
  return out
}

/** Names of the ranges that run across a join between the outputs of a combined strand. */
export function cutRanges(ins: LedOutput[], st: StrandView): string[] {
  const joins = st.key
  .split("+")
  .slice(1)
  .map((k) => ins[Number(k.slice(1))]!.start - st.start)
  return st.ranges.filter((r) => joins.some((j) => r.start < j && j < r.start + r.len)).map((r) => r.name)
}

/** Why each Every stepper button is disabled, or "" when it is not. The strand's lock is the caller's to add. */
export function stepReasons(r: RangeView, free: number): { nDown: string; nUp: string; gDown: string; gUp: string } {
  const every = r.pattern.kind === "every" ? r.pattern : null
  const n = every?.n ?? 2
  const g = every?.group ?? 1
  const nUp =
    n >= MAX_SLOTS
      ? "A range can have at most 16 slots."
      : n * g > MAX_GROUP
        ? `With group ${g}, at most ${Math.floor(MAX_GROUP / g) + 1} slots fit.`
        : n * g >= r.len
          ? "This range is too short for another slot."
          : free < 1
            ? "No free segments. Remove a range first."
            : ""
  const nDown = n <= 2 ? "Every N needs at least 2 slots. Use All for one." : ""
  const gUp =
    g >= MAX_GROUP
      ? "A group can be at most 255 LEDs."
      : (n - 1) * (g + 1) > MAX_GROUP
        ? `With ${n} slots, a group can be at most ${Math.floor(MAX_GROUP / (n - 1))} LEDs.`
        : (n - 1) * (g + 1) >= r.len
          ? "This range is too short for a bigger group."
          : ""
  const gDown = g <= 1 ? "A group is at least 1 LED." : ""
  return { nDown, nUp, gDown, gUp }
}

/** Why the pattern button `kind` is disabled, or "". */
export function kindReason(r: RangeView, kind: Pattern["kind"], free: number, locked: boolean): string {
  if (kind === r.pattern.kind) return ""
  if (locked) return LOCKED
  if (kind === "every" && r.len < 2) return "Every N needs at least 2 LEDs."
  const n = r.pattern.kind === "every" ? r.pattern.n : 2
  const cost = (kind === "every" ? n : 1) - segsOf([r])
  return cost > free ? needMsg(cost, free) : ""
}
