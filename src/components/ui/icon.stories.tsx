import type { Meta, StoryObj } from "@storybook/react"
import { Icon, type IconName } from "@/components/ui/icon"

const meta = { title: "UI/Icon", component: Icon } satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

const NAMES: IconName[] = [
  "plus", "chevronRight", "check", "sync", "settings", "mapPin",
  "edit", "image", "search", "close", "menu",
]

export const All: Story = {
  args: { name: "plus" },
  render: () => (
    <div className="flex flex-wrap gap-4 p-6 text-stone-700">
      {NAMES.map((n) => (
        <div key={n} className="flex flex-col items-center gap-1 text-[11px] text-stone-500">
          <Icon name={n} size={22} />
          {n}
        </div>
      ))}
    </div>
  ),
}
