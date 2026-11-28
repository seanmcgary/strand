import type { Meta, StoryObj } from "@storybook/react"
import type { LookRecord, Scene } from "../../../shared/apiTypes"
import { allRange, device, lights, slot, strand, view } from "../../../test/lightsView"
import { PresetsTab } from "@/components/presets/presetsTab"
import type { DevicePresets } from "@/store/slices/presets"

const v = view([
  strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90, [255, 160, 0])]),
  strand("o1", "Strand 2", 150, [allRange("Fence", 0, 150, [0, 80, 255])], { pins: [4], start: 150 }),
])
const at = "2026-11-24T10:00:00.000Z"
const scene = (id: string, name: string, over: Partial<Scene> = {}): Scene => ({
  id,
  name,
  strandKey: "o0",
  ledCount: 150,
  summary: "2 ranges · 50%",
  createdAt: at,
  updatedAt: at,
  ...over,
})
const look = (id: string, name: string, colors: number[][], fx: string): LookRecord => ({
  id,
  name,
  look: { pattern: { kind: "all" }, slots: colors.map((c) => slot(c, { fxName: fx })) },
  createdAt: at,
  updatedAt: at,
})
const presets = (over: Partial<DevicePresets> = {}): DevicePresets => ({
  scenes: [scene("s1", "Evening glow"), scene("s2", "Movie night", { strandKey: "o1", ledCount: 120, summary: "1 range · off" })],
  looks: [look("l1", "Candy cane", [[255, 0, 0], [255, 255, 255]], "Chase"), look("l2", "Ocean", [[0, 80, 255]], "Solid")],
  status: "ok",
  error: null,
  applying: [],
  ...over,
})
const noop = () => {}
const call = () => ({ unwrap: () => Promise.resolve() })

const meta = {
  title: "Presets/PresetsTab",
  component: PresetsTab,
  parameters: { layout: "padded" },
  args: {
    device,
    offline: false,
    lights: lights(v),
    presets: presets(),
    strand: v.strands[0]!,
    actions: {
      loadPresets: noop,
      createScene: call,
      renameScene: call,
      createLook: call,
      renameLook: call,
      applyLook: call,
      deleteScene: call,
      deleteLook: call,
      applyScene: noop,
    },
  },
} satisfies Meta<typeof PresetsTab>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { args: { presets: presets({ scenes: [], looks: [] }) } }
export const Applying: Story = { args: { presets: presets({ applying: ["s1"] }) } }
export const SceneProblems: Story = {
  args: { presets: presets({ scenes: [scene("s1", "Evening glow", { ledCount: 200 }), scene("s2", "Gone", { strandKey: "o5" })] }) },
}
export const NoStrands: Story = { args: { lights: lights(view([], { matrix: true })), strand: null } }
export const Loading: Story = { args: { presets: presets({ scenes: null, looks: null, status: "loading" }) } }
export const LoadError: Story = {
  args: { presets: presets({ scenes: null, looks: null, status: "error", error: { message: "The device didn't answer." } }) },
}
export const Offline: Story = { args: { offline: true } }
