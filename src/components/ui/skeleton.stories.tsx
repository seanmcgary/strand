import type { Meta, StoryObj } from "@storybook/react"
import { Skeleton } from "@/components/ui/skeleton"

const meta = { title: "UI/Skeleton", component: Skeleton } satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-2">
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-1.5 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  ),
}
