import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"

export interface DialogShellProps {
  onClose: () => void
  title: string
  description?: string
  /** The control that opened the dialog, which gets focus back when it closes. */
  returnFocus: () => HTMLElement | null
  /** The control that takes focus when the dialog opens; the first focusable control when it is absent or finds none. */
  initialFocus?: () => HTMLElement | null
  /** A confirm dialog has no close button; Cancel is its first control. */
  showCloseButton?: boolean
  children?: React.ReactNode
}

/** An open dialog that returns focus to the control `returnFocus` finds. */
export function DialogShell({ onClose, title, description, returnFocus, initialFocus, showCloseButton = true, children }: DialogShellProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        showCloseButton={showCloseButton}
        {...(description ? {} : { "aria-describedby": undefined })}
        onOpenAutoFocus={(e) => {
          const el = initialFocus?.()
          if (!el) return
          e.preventDefault()
          el.focus()
        }}
        onCloseAutoFocus={(e) => {
          const el = returnFocus()
          if (!el) return
          e.preventDefault()
          el.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function Spinner() {
  return <Icon name="loader-circle" className="motion-safe:animate-spin" />
}

export const CancelButton = () => (
  <DialogClose asChild>
    <Button type="button" variant="outline">
      Cancel
    </Button>
  </DialogClose>
)
