import type { Effect, Palette, Pattern, RangeView } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { Stepper } from "@/components/ui/stepper"
import { everyPreview, kindReason, LOCKED, stepReasons, withPattern } from "@/lights/model"
import { LABEL, PRESSED } from "@/lib/dialogStyles"


const KINDS: [Pattern["kind"], string][] = [
  ["all", "All"],
  ["every", "Every N"],
  ["individual", "Individual"],
]

export interface PatternControlsProps {
  /** A DOM id prefix unique to this range. */
  uid: string
  range: RangeView
  /** The device's free segments. */
  free: number
  /** The strand shares a segment with another one. */
  locked: boolean
  effects: Effect[] | null
  palettes: Palette[] | null
  /** The range with its new pattern. */
  onRange: (next: RangeView) => void
}

/** The pattern toggles (All, Every N, Individual) and, for Every N, the N and Group steppers. */
export function PatternControls({ uid, range: r, free, locked, effects, palettes, onRange }: PatternControlsProps) {
  const setKind = (kind: Pattern["kind"]) => {
    if (kind === r.pattern.kind) return
    onRange(withPattern(effects, palettes, r, kind === "every" ? { kind, n: 2, group: 1 } : { kind }))
  }
  const every = r.pattern.kind === "every" ? r.pattern : null
  const why = every ? stepReasons(r, free) : null
  const lock = (reason: string) => (locked ? LOCKED : reason)
  const step = (dn: number, dg: number) => {
    if (every) onRange(withPattern(effects, palettes, r, { kind: "every", n: every.n + dn, group: every.group + dg }))
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span id={`pat-${uid}`} className={LABEL}>
          Pattern
        </span>
        <div role="group" aria-labelledby={`pat-${uid}`} className="flex flex-wrap gap-1.5">
          {KINDS.map(([kind, label]) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              className={PRESSED}
              aria-pressed={r.pattern.kind === kind}
              reason={kindReason(r, kind, free, locked) || undefined}
              onClick={() => setKind(kind)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {every && why ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Stepper
            id={`n-${uid}`}
            label="N"
            value={every.n}
            decReason={lock(why.nDown)}
            incReason={lock(why.nUp)}
            unit="slots"
            onStep={(dir) => step(dir, 0)}
          />
          <Stepper
            id={`g-${uid}`}
            label="Group"
            value={every.group}
            decReason={lock(why.gDown)}
            incReason={lock(why.gUp)}
            unit="LEDs per group"
            onStep={(dir) => step(0, dir)}
          />
          <p className="pb-2.5 text-[13px] leading-snug text-muted-foreground">
            LEDs go <span className="font-mono tracking-wide">{everyPreview(every.n, every.group)}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}
