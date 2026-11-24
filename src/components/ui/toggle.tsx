import { cn, FOCUS_RING } from "@/lib/utils"

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
}

/**
 * Accessible switch built on a native `<button>` so Space/Enter operate it
 * for free — no custom key handling needed. `checked` drives the on/off
 * visual and `aria-checked`; state lives entirely in props.
 */
export function Toggle({
  checked,
  onChange,
  id,
  disabled,
  className,
  ...ariaProps
}: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-stone-300",
        FOCUS_RING,
        className,
      )}
      {...ariaProps}
    >
      <span
        className={cn(
          "inline-block size-[18px] rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-[3px]",
        )}
      />
    </button>
  )
}
