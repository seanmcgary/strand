import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"

export interface StepperProps {
  id: string
  label: string
  value: number
  /** Why "fewer" is unavailable; empty when it is available. */
  decReason?: string
  /** Why "more" is unavailable; empty when it is available. */
  incReason?: string
  onStep: (dir: -1 | 1) => void
  /** What is counted, for the button names: "Fewer slots", "More slots". */
  unit: string
}

const STEP_BUTTON =
  "h-9 w-10 rounded-none aria-disabled:hover:bg-transparent aria-disabled:opacity-40"

export function Stepper({ id, label, value, decReason, incReason, onStep, unit }: StepperProps) {
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-medium leading-none">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="inline-flex w-fit items-center overflow-hidden rounded-md border border-input shadow-sm"
      >
        <Button variant="ghost" size="icon" className={STEP_BUTTON} aria-label={`Fewer ${unit}`} reason={decReason} onClick={() => onStep(-1)}>
          <Icon name="minus" />
        </Button>
        <output id={id} className="w-12 border-x border-input text-center text-sm font-medium leading-9 tabular-nums" aria-live="polite">
          {value}
        </output>
        <Button variant="ghost" size="icon" className={STEP_BUTTON} aria-label={`More ${unit}`} reason={incReason} onClick={() => onStep(1)}>
          <Icon name="plus" />
        </Button>
      </div>
    </div>
  )
}
