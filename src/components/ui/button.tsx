import { compose, withState } from "recompose"
import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"
import type { IconName } from "@/components/ui/iconPaths"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

const VARIANTS = {
  default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  outline: "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-foreground underline-offset-4 hover:underline",
  "destructive-outline": "border border-danger/50 text-danger shadow-sm hover:bg-danger/10",
  "destructive-ghost": "text-danger hover:bg-danger/10",
}

const SIZES = {
  default: "h-10 px-4 py-2",
  sm: "h-9 rounded-md px-3",
  lg: "h-11 rounded-md px-6",
  icon: "h-10 w-10",
  "icon-sm": "h-8 w-8",
  inline: "h-auto p-0",
}

const REASON_STYLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  leadingIcon?: IconName
  /**
   * Why the button can't be used right now. The button stays focusable and
   * `aria-disabled`, a click does nothing but show the reason, and the reason
   * is both its accessible description and a tooltip.
   */
  reason?: string
}

let reasonCount = 0

interface ReasonState {
  reasonId: string
  setReasonId: (id: string) => void
  tipOpen: boolean
  setTipOpen: (open: boolean) => void
}

type ReasonProps = Omit<ButtonProps, "ref">

const withReasonState = compose<ReasonProps & ReasonState, ReasonProps>(
  withState("reasonId", "setReasonId", () => `button-reason-${++reasonCount}`),
  withState("tipOpen", "setTipOpen", false),
)

function ReasonButtonView({
  variant = "default",
  size = "default",
  leadingIcon,
  reason,
  className,
  children,
  onClick: _onClick,
  reasonId,
  setReasonId: _setReasonId,
  tipOpen,
  setTipOpen,
  ...props
}: ReasonProps & ReasonState) {
  return (
    <>
      <Tooltip open={tipOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <button
            {...props}
            aria-disabled="true"
            aria-describedby={reasonId}
            className={cn(BASE, VARIANTS[variant], SIZES[size], REASON_STYLE, className)}
            onClick={(e) => {
              // preventDefault also stops the tooltip trigger from closing the tip it opens here.
              e.preventDefault()
              setTipOpen(true)
            }}
          >
            {leadingIcon ? <Icon name={leadingIcon} /> : null}
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
  )
}

const ReasonButton = withReasonState(ReasonButtonView)

export function Button({
  variant = "default",
  size = "default",
  leadingIcon,
  reason,
  className,
  children,
  ...props
}: ButtonProps) {
  if (reason) {
    return (
      <ReasonButton variant={variant} size={size} leadingIcon={leadingIcon} reason={reason} className={className} {...(props as ReasonProps)}>
        {children}
      </ReasonButton>
    )
  }
  return (
    <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {leadingIcon ? <Icon name={leadingIcon} /> : null}
      {children}
    </button>
  )
}
