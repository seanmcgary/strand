import type { Effect, Palette, RangeView, SlotView } from "../../../shared/apiTypes"
import { Icon } from "@/components/ui/icon"
import { slotBackground, slotRowId, slotText } from "@/lights/model"
import { cn } from "@/lib/utils"

const LABEL = "text-sm font-medium leading-none"

/** A round color swatch for a slot: its first color, or its palette. */
export function Swatch({ fxs, pals, slot, className }: { fxs: Effect[] | null; pals: Palette[] | null; slot: SlotView; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-7 w-7 shrink-0 rounded-full border border-foreground/15 shadow-sm", !slot.on && "opacity-40", className)}
      style={{ background: slotBackground(fxs, pals, slot) }}
    />
  )
}

export interface SlotRowsProps {
  strandKey: string
  /** The range's index on its strand. */
  i: number
  range: RangeView
  effects: Effect[] | null
  palettes: Palette[] | null
  onOpenSlot: (s: number) => void
}

/** The range's slots, one row each; a row opens that slot. */
export function SlotRows({ strandKey, i, range, effects, palettes, onOpenSlot }: SlotRowsProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{range.slots.length > 1 ? "Slots" : "Slot"}</span>
      <ul className="-mx-2 flex flex-col">
        {range.slots.map((s, k) => (
          <li key={k}>
            <button
              type="button"
              id={slotRowId(strandKey, i, k)}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenSlot(k)}
            >
              <Swatch fxs={effects} pals={palettes} slot={s} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">Slot {k + 1}</span>
                <span className="truncate text-[13px] text-muted-foreground">{slotText(effects, s)}</span>
              </span>
              <Icon name="chevron-right" className="size-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
