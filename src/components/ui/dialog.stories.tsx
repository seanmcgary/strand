import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const meta = { title: "UI/Dialog", component: Dialog } satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>

/**
 * Closed by default — click the trigger to open. Exercises the full
 * lifecycle: focus trap, ESC to close, and focus returning to this trigger
 * button on close.
 */
export const ClosedWithTrigger: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this item?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary">Delete</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/**
 * `defaultOpen` renders the dialog open on mount (uncontrolled), so the
 * overlay/content/focus-trap chrome is visible without an interaction step.
 */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new item</DialogTitle>
          <DialogDescription>Save it once, and it&apos;ll be ready to reuse.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-stone-600">Dialog body content goes here.</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="primary">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
