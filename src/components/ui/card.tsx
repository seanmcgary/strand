import { cn } from "@/lib/utils"

type CardProps = {
  children: React.ReactNode
  className?: string
} & (
  | { as?: "div"; onClick?: never }
  | { as: "button"; onClick?: React.MouseEventHandler<HTMLButtonElement> }
)

const BASE =
  "border border-stone-200 bg-white rounded-card shadow-[0_1px_2px_rgba(28,25,23,0.05)]"

export function Card({ as = "div", className, children, ...rest }: CardProps) {
  if (as === "button") {
    return (
      <button
        type="button"
        className={cn(
          BASE,
          "cursor-pointer text-left transition-colors hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
          className,
        )}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    )
  }
  return <div className={cn(BASE, className)}>{children}</div>
}
