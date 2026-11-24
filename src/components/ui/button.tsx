import { cn } from "@/lib/utils"
import { Icon, type IconName } from "@/components/ui/icon"

type Variant = "primary" | "secondary" | "ghost" | "subtle"
type Size = "sm" | "md"

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-[0_1px_2px_rgba(22,163,74,0.3)] hover:bg-brand-dark",
  secondary: "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50",
  ghost: "bg-transparent text-brand hover:text-brand-dark",
  subtle: "bg-stone-50 text-stone-700 border border-stone-300 hover:bg-stone-100",
}

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  leadingIcon?: IconName
}

export function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-control font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {leadingIcon ? <Icon name={leadingIcon} size={size === "sm" ? 15 : 17} strokeWidth={2.5} /> : null}
      {children}
    </button>
  )
}
