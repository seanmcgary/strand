import { cn, FOCUS_RING } from "@/lib/utils"

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "checked" | "onChange"> {
  /** Required so the associated `<label>` can point at the input. */
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Checkbox({ id, label, checked, onChange, className, ...props }: CheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded-sm border border-stone-300 text-brand transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          FOCUS_RING,
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="cursor-pointer text-sm text-stone-700">
        {label}
      </label>
    </div>
  )
}
