import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu"
import { Icon } from "@/components/ui/icon"

const meta = { title: "UI/DropdownMenu", component: DropdownMenu } satisfies Meta<typeof DropdownMenu>
export default meta
type Story = StoryObj<typeof meta>

/** "Merge with next" has a reason: it stays focusable, shows the reason under its label and does nothing. */
export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Range options">
          <Icon name="ellipsis" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem><Icon name="pencil" />Rename</DropdownMenuItem>
        <DropdownMenuItem reason="There's no range right after this one."><Icon name="merge" />Merge with next</DropdownMenuItem>
        <DropdownMenuItem className="text-danger"><Icon name="trash-2" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
