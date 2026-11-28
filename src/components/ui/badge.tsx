import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

const BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3"

const VARIANTS = {
  default: "border-transparent bg-primary text-primary-foreground",
  info: "border-border bg-muted text-muted-foreground",
  warning: "border-warning/40 bg-warning-muted text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  success: "border-success/40 bg-success/10 text-success",
}

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: keyof typeof VARIANTS
}

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(BASE, VARIANTS[variant], className)} {...props} />
}
