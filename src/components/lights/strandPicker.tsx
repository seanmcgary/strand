import type { LightsView } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { adjacentPairs, COMBINE_BUTTON_ID, LOCKED, pinLabel } from "@/lights/model"
import { cn } from "@/lib/utils"

const CHIP =
  "inline-flex flex-col items-start justify-center rounded-md border border-input bg-transparent text-sm font-medium shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:font-semibold aria-pressed:text-foreground"

export interface StrandPickerProps {
  view: LightsView
  selected: string
  onPick: (key: string) => void
  onCombine: () => void
}

/** The strand chips and Combine…; hidden when the device has one strand. */
export function StrandPicker({ view, selected, onPick, onCombine }: StrandPickerProps) {
  if (view.strands.length < 2) return null
  const reason = adjacentPairs(view).length
    ? undefined
    : view.strands.some((s) => s.shared)
      ? LOCKED
      : "Only strands whose LEDs touch can be combined."
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Strands">
      <span className="mr-1 text-sm font-medium text-muted-foreground">Strands</span>
      {view.strands.map((s) => (
        <button
          key={s.key}
          type="button"
          className={cn(CHIP, "min-h-11 gap-0 px-3 py-1.5 text-left")}
          aria-pressed={s.key === selected}
          onClick={() => onPick(s.key)}
        >
          <span className="text-sm">{s.name}</span>
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {pinLabel(s.pins)} · {s.len}
          </span>
        </button>
      ))}
      <Button type="button" id={COMBINE_BUTTON_ID} variant="ghost" size="sm" leadingIcon="link" reason={reason} onClick={onCombine}>
        Combine…
      </Button>
    </div>
  )
}
