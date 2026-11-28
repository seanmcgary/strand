import type { Meta, StoryObj } from "@storybook/react"
import { allRange, device, lights, strand, view } from "../../../test/lightsView"
import { LightsTab } from "@/components/lights/lightsTab"

const v = view([
  strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90, [255, 160, 0])]),
  strand("o1", "Strand 2", 150, [allRange("Fence", 0, 150, [0, 80, 255])], { pins: [4], start: 150 }),
])
const noop = () => {}

const meta = {
  title: "Lights/LightsTab",
  component: LightsTab,
  parameters: { layout: "padded" },
  args: {
    device,
    offline: false,
    lights: lights(v),
    strand: v.strands[0]!,
    prefs: { recentColors: [], favoriteEffects: [], loaded: true },
    actions: {
      editStrand: () => true,
      selectStrand: noop,
      selectRange: noop,
      resolveShared: noop,
      loadLights: noop,
      toast: noop,
      flashLed: noop,
      setStrandGroups: () => ({ unwrap: () => Promise.resolve() }),
      setStrandName: () => ({ unwrap: () => Promise.resolve() }),
      loadOutputs: noop,
      loadFxLists: noop,
      pushRecentColor: noop,
      toggleFavoriteEffect: noop,
    },
  },
} satisfies Meta<typeof LightsTab>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithNotice: Story = { args: { lights: lights({ ...v, notices: ["Strand 2 had segments Strand can't show. Its first change rewrites them."] }) } }
export const Loading: Story = { args: { lights: lights(null), strand: null } }
export const LoadError: Story = {
  args: { lights: lights(null, { status: "error", error: { message: "The device didn't answer." } }), strand: null },
}
export const Offline: Story = { args: { offline: true } }
export const Matrix: Story = { args: { lights: lights(view([], { matrix: true })), strand: null } }
