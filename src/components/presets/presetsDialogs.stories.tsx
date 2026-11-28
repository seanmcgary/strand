import type { Meta, StoryObj } from "@storybook/react"
import type { LookRecord, Scene } from "../../../shared/apiTypes"
import { allRange, slot, strand, view } from "../../../test/lightsView"
import { PresetsDialogs } from "@/components/presets/presetsDialogs"

const v = view([
  strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90), { ...allRange("Paint", 150, 0), pattern: { kind: "individual" } }]),
  strand("o1", "Strand 2", 100, [allRange("Fence", 0, 100)], { pins: [4], start: 150 }),
  strand("o2", "Strand 3", 100, [allRange("Eaves", 0, 100)], { pins: [5], start: 250, shared: { with: ["o3"] } }),
])
const at = "2026-11-24T10:00:00.000Z"
const scenes: Scene[] = [{ id: "s1", name: "Evening glow", strandKey: "o0", ledCount: 200, summary: "2 ranges · 50%", createdAt: at, updatedAt: at }]
const looks: LookRecord[] = [{ id: "l1", name: "Candy cane", look: { pattern: { kind: "all" }, slots: [slot([255, 0, 0], { fxName: "Chase" })] }, createdAt: at, updatedAt: at }]
const noop = () => {}
const ok = (): Promise<string | null> => Promise.resolve(null)

const meta = {
  title: "Presets/PresetsDialogs",
  component: PresetsDialogs,
  args: {
    dialog: { kind: "saveScene" },
    view: v,
    scenes,
    looks,
    selectedKey: "o0",
    onClose: noop,
    onSaveScene: ok,
    onSaveLook: ok,
    onRename: ok,
    onApplyLook: ok,
    onApplyScene: noop,
    onDelete: () => Promise.resolve(true),
  },
} satisfies Meta<typeof PresetsDialogs>
export default meta
type Story = StoryObj<typeof meta>

export const SaveScene: Story = {}
export const SaveSceneRefused: Story = { args: { onSaveScene: () => Promise.resolve("Names need 1 to 64 characters.") } }
export const SaveLook: Story = { args: { dialog: { kind: "saveLook" } } }
export const ApplyLook: Story = { args: { dialog: { kind: "applyLook", id: "l1" } } }
export const ApplyLookRefused: Story = { args: { dialog: { kind: "applyLook", id: "l1" }, onApplyLook: () => Promise.resolve("That range was deleted.") } }
export const SceneWarn: Story = { args: { dialog: { kind: "sceneWarn", id: "s1" } } }
export const RenameScene: Story = { args: { dialog: { kind: "rename", preset: "scene", id: "s1" } } }
export const RenameLook: Story = { args: { dialog: { kind: "rename", preset: "look", id: "l1" } } }
export const DeleteScene: Story = { args: { dialog: { kind: "delete", preset: "scene", id: "s1" } } }
export const DeleteLook: Story = { args: { dialog: { kind: "delete", preset: "look", id: "l1" } } }
