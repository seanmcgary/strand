import type { Meta, StoryObj } from "@storybook/react"
import { Slider } from "@/components/ui/slider"

const meta = { title: "UI/Slider", component: Slider } satisfies Meta<typeof Slider>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { value: 128, "aria-label": "Brightness" },
  render: (args) => (
    <div className="w-72">
      <Slider {...args} />
    </div>
  ),
}
export const Disabled: Story = { ...Default, args: { value: 64, "aria-label": "Brightness", disabled: true } }
