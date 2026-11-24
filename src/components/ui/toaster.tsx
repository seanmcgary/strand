import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"
import type { ToastItem } from "@/store/slices/toasts"

const ICON = { success: "circle-check", error: "triangle-alert", info: "info" } as const
const ICON_COLOR = { success: "text-success", error: "text-danger", info: "text-muted-foreground" }

/** The design's toast stack. The region is always mounted so screen readers announce what it gains. */
export function Toaster({ items }: { items: ToastItem[] }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[90] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 left-1/2 top-[calc(env(safe-area-inset-top,0px)+12px)] -translate-x-1/2 lg:left-auto lg:top-auto lg:translate-x-0 lg:right-[max(16px,env(safe-area-inset-right,0px))] lg:bottom-[calc(env(safe-area-inset-bottom,0px)+16px)]"
    >
      {items.map((t) => (
        <div key={t.id} className="flex gap-2.5 rounded-lg border border-border bg-popover p-3.5 text-foreground shadow-lg motion-safe:animate-rise">
          <Icon name={ICON[t.kind]} className={cn("mt-0.5 size-4", ICON_COLOR[t.kind])} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            {t.desc ? <p className="text-[13px] text-muted-foreground">{t.desc}</p> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
