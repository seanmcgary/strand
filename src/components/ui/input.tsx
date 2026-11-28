import { cn, FOCUS_RING } from "@/lib/utils"
import { Label } from "@/components/ui/label"

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Required so the (optional) rendered label and error message can associate to the input. */
  id: string
  label?: string
  error?: string
}

export function Input({ id, label, error, className, ...props }: InputProps) {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          "h-9 rounded-control border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          FOCUS_RING,
          error && "border-red-400",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-[12.5px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
