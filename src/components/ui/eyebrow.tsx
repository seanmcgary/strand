import { cn } from "@/lib/utils"

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-stone-500",
        className,
      )}
    >
      {children}
    </div>
  )
}
