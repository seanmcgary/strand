import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const meta = { title: "UI/Sheet", component: Sheet, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Sheet>
export default meta
type Story = StoryObj<typeof meta>

/** A bottom sheet below 900 px and a right side sheet at 900 px and up. */
export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="m-6">Open sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Slot 1</SheetTitle>
          <SheetDescription>Strand · LEDs 1-30</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 text-sm">Sheet body.</div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="secondary">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
}
