import { cn } from "@/lib/utils"

export function ProgressBar({
  pct,
  fillClass = "bg-brand",
  trackClass = "bg-stone-200",
  className,
}: {
  pct: number
  fillClass?: string
  trackClass?: string
  className?: string
}) {
  const width = Math.max(0, Math.min(100, pct))
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full", trackClass, className)}>
      <div className={cn("h-full rounded-full", fillClass)} style={{ width: `${width}%` }} />
    </div>
  )
}
