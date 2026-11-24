import { cn } from "@/lib/utils"

type Tone = "excellent" | "good" | "watch" | "poor" | "neutral" | "info"

const TONES: Record<Tone, string> = {
  excellent: "bg-brand text-white",
  good: "bg-green-100 text-green-700",
  watch: "bg-amber-100 text-amber-700",
  poor: "bg-red-100 text-red-700",
  neutral: "bg-stone-100 text-stone-600",
  info: "bg-blue-100 text-blue-700",
}

export function StatusPill({
  tone,
  children,
  withDot = false,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  withDot?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        TONES[tone],
        className,
      )}
    >
      {withDot ? <span className="size-[7px] rounded-full bg-current opacity-90" /> : null}
      {children}
    </span>
  )
}
