import { cn } from "@/lib/utils"

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export function Label({ className, children, ...props }: LabelProps) {
  return (
    <label className={cn("block text-[13px] font-medium text-stone-700", className)} {...props}>
      {children}
    </label>
  )
}
