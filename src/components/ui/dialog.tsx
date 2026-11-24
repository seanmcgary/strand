import type { ComponentProps } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Radix dialog primitive, restyled to this repo's design system (stone
 * palette, `rounded-2xl`/16px radius, the `app-fade`/`app-pop` keyframes from
 * `src/index.css`) rather than shadcn's default `bg-background`/
 * `text-muted-foreground` CSS-variable tokens, which this project doesn't
 * define (its other `components/ui/*` primitives use direct Tailwind color
 * classes — see `card.tsx`/`button.tsx`).
 *
 * Radix supplies the focus trap, ESC-to-close, and focus-return-to-trigger
 * behavior for free. `DialogContent` only mounts (via `DialogPortal`) while
 * `open` is true. Animations use Tailwind's
 * built-in `motion-safe:` variant (no `tailwindcss-animate` plugin is
 * installed) so `prefers-reduced-motion: reduce` disables them entirely.
 */
function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-[2px]",
        "data-[state=open]:motion-safe:animate-[app-fade_0.15s_ease]",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)] outline-none sm:max-w-lg",
          "data-[state=open]:motion-safe:animate-[app-pop_0.2s_ease]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-control bg-stone-100 text-lg leading-none text-stone-500 transition-colors hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-bold tracking-[-0.01em] text-stone-900", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[13px] text-stone-500", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
