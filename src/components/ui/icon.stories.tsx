import type { Meta, StoryObj } from "@storybook/react"
import { Icon } from "@/components/ui/icon"
import { ICON_PATHS, type IconName } from "@/components/ui/iconPaths"

const meta = { title: "UI/Icon", component: Icon } satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

const NAMES = Object.keys(ICON_PATHS) as IconName[]

export const All: Story = {
  args: { name: "plus" },
  render: () => (
    <div className="flex max-w-3xl flex-wrap gap-4 p-6 text-foreground">
      {NAMES.map((n) => (
        <div key={n} className="flex w-24 flex-col items-center gap-1 text-[11px] text-muted-foreground">
          <Icon name={n} size={22} />
          {n}
        </div>
      ))}
    </div>
  ),
}
