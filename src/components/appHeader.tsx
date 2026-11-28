import { Link } from "react-router-dom"
import { Toaster } from "@/components/ui/toaster"
import type { ToastItem } from "@/store/slices/toasts"

/** The design's horizontal gutter: 16 px, or the safe area when it is wider. */
export const GUTTER = "pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]"

/** The Strand logo: a strip with five LEDs fading out. */
export function StrandMark({ className = "h-3 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 12" className={className} aria-hidden="true">
      <rect x="0.5" y="4.5" width="39" height="3" rx="1.5" className="fill-muted" />
      {[4, 12, 20, 28, 36].map((x, i) => (
        <circle key={x} cx={x} cy="6" r="3.2" className="fill-glow" opacity={(1 - i * 0.17).toFixed(2)} />
      ))}
    </svg>
  )
}

/** The sticky app bar with the logo link home, and the toast stack. */
export function AppHeader({ toasts }: { toasts: ToastItem[] }) {
  return (
    <>
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className={`mx-auto flex h-14 max-w-6xl items-center gap-3 ${GUTTER}`}>
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StrandMark />
            <span className="text-[15px] font-semibold tracking-tight">Strand</span>
          </Link>
        </div>
      </header>
      <Toaster items={toasts} />
    </>
  )
}
