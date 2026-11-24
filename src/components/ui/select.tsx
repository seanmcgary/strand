import { cn, FOCUS_RING } from "@/lib/utils"
import { Label } from "@/components/ui/label"

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> {
  /** Required so the (optional) rendered label and error message can associate to the select. */
  id: string
  label?: string
  error?: string
  options: SelectOption[]
}

export function Select({ id, label, error, options, className, ...props }: SelectProps) {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          "h-9 rounded-control border border-stone-300 bg-white px-3 text-sm text-stone-900 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          FOCUS_RING,
          error && "border-red-400",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-[12.5px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
