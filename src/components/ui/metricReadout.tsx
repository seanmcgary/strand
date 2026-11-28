import { cn } from "@/lib/utils"

export function MetricReadout({
  label,
  value,
  labelClass,
  valueClass,
}: {
  label: string
  value: string
  labelClass?: string
  valueClass?: string
}) {
  return (
    <div>
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.05em] text-stone-500",
          labelClass,
        )}
      >
        {label}
      </div>
      <div className={cn("font-mono text-[15px] font-semibold text-stone-900", valueClass)}>
        {value}
      </div>
    </div>
  )
}
