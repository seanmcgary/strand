import { cn, FOCUS_RING } from "@/lib/utils"
import { Label } from "@/components/ui/label"

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "value" | "onChange"> {
  /** Required so the (optional) rendered label and error message can associate to the textarea. */
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  error?: string
  rows?: number
}

export function Textarea({ id, label, value, onChange, error, rows = 4, className, ...props }: TextareaProps) {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "rounded-control border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
