import type { ComponentProps } from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { compose, withState } from "recompose"
import { cn } from "@/lib/utils"

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-[90] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg motion-safe:animate-zoom-in",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

const ITEM =
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent data-[highlighted]:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent [&_svg]:size-4"

let reasonCount = 0

interface ItemState {
  reasonId: string
  setReasonId: (id: string) => void
}

interface ItemProps extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
  /**
   * Why the item can't be used right now. The item stays focusable and
   * `aria-disabled`, selecting it does nothing, and the reason shows as a
   * second line that describes it.
   */
  reason?: string
}

function DropdownMenuItemView({ className, reason, children, onSelect, reasonId, setReasonId: _setReasonId, ...props }: ItemProps & ItemState) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(ITEM, reason && "flex-col items-start gap-0.5", className)}
      {...(reason
        ? {
            "aria-disabled": true,
            "aria-describedby": reasonId,
            // Keep the menu open and skip the caller's handler.
            onSelect: (e: Event) => e.preventDefault(),
          }
        : { onSelect })}
      {...props}
    >
      {reason ? (
        <>
          <span className="flex items-center gap-2">{children}</span>
          <span id={reasonId} className="text-xs text-muted-foreground">
            {reason}
          </span>
        </>
      ) : (
        children
      )}
    </DropdownMenuPrimitive.Item>
  )
}

const DropdownMenuItem = compose<ItemProps & ItemState, ItemProps>(
  withState("reasonId", "setReasonId", () => `menu-item-reason-${++reasonCount}`),
)(DropdownMenuItemView)

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
