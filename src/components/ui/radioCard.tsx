import { cn, FOCUS_RING_WITHIN } from "@/lib/utils"

export interface RadioCardProps {
  id: string
  /** Shared across every RadioCard in the same RadioGroup for native roving-focus/arrow-key behavior. */
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label: string
  description?: string
  icon?: React.ReactNode
  disabled?: boolean
  className?: string
}

/**
 * A card-styled radio option. Uses a real, visually-hidden native
 * `<input type="radio">` inside a `<label>` so arrow-key navigation and
 * roving tabindex within the group come from the browser's native radio
 * behavior, not custom key handling.
 */
export function RadioCard({
  id,
  name,
  value,
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  className,
}: RadioCardProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-card border bg-white p-3 transition-colors",
        checked ? "border-brand ring-1 ring-brand" : "border-stone-200 hover:border-stone-300",
        disabled && "cursor-not-allowed opacity-50",
        FOCUS_RING_WITHIN,
        className,
      )}
    >
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {icon ? <span className="mt-0.5 text-brand">{icon}</span> : null}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-stone-900">{label}</span>
        {description ? <span className="text-[12.5px] text-stone-600">{description}</span> : null}
      </span>
    </label>
  )
}

export type RadioGroupProps = Omit<React.HTMLAttributes<HTMLDivElement>, "role">

/**
 * Thin `role="radiogroup"` wrapper around a set of RadioCards. Each
 * RadioCard's `checked`/`onChange` still comes from props supplied by the
 * caller (typically derived from a single selected value) — the group adds
 * no state of its own.
 */
export function RadioGroup({ className, children, ...props }: RadioGroupProps) {
  return (
    <div role="radiogroup" className={cn("flex flex-col gap-2", className)} {...props}>
      {children}
    </div>
  )
}
