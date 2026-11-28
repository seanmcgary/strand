import type { Meta, StoryObj } from "@storybook/react"
import { allRange, strand, view } from "../../../test/lightsView"
import { LightsDialogs } from "@/components/lights/lightsDialogs"

const v = view([
  strand("o0", "Strand 1", 150, [allRange("Patio", 0, 60), allRange("Kitchen", 60, 90)]),
  strand("o1", "Strand 2", 150, [allRange("Fence", 150, 150)], { start: 150, pins: [4] }),
  strand("o2+o3", "Strand 3 + Strand 4", 300, [allRange("Left", 300, 100), allRange("Middle", 400, 100), allRange("Right", 500, 100)], {
    start: 300,
    pins: [5, 18],
  }),
])
const outputs = [0, 150, 300, 450].map((start, k) => ({ type: 22, pin: [[2, 4, 5, 18][k]!], start, len: 150, order: 0, rev: false, skip: 0, ledma: 55 }))
const noop = () => {}

const meta = {
  title: "Lights/LightsDialogs",
  component: LightsDialogs,
  args: {
    dialog: { kind: "rename", key: "o0", i: 1 },
    view: v,
    outputs,
    outputsStatus: "ok",
    outputsError: null,
    onRetryOutputs: noop,
    onClose: noop,
    onRenameRange: noop,
    onRenameStrand: (): Promise<string | null> => Promise.resolve(null),
    onCombine: () => Promise.resolve(),
    onSeparate: () => Promise.resolve(),
  },
} satisfies Meta<typeof LightsDialogs>
export default meta
type Story = StoryObj<typeof meta>

export const RenameRange: Story = {}
export const RenameStrand: Story = { args: { dialog: { kind: "rename", key: "o0" } } }
export const RenameStrandRefused: Story = {
  args: { dialog: { kind: "rename", key: "o0" }, onRenameStrand: () => Promise.resolve("Names need 1 to 64 characters.") },
}
export const Combine: Story = { args: { dialog: { kind: "combine" } } }
export const Separate: Story = { args: { dialog: { kind: "separate", key: "o2+o3" } } }
export const SeparateLoading: Story = { args: { dialog: { kind: "separate", key: "o2+o3" }, outputs: null, outputsStatus: "loading" } }
export const SeparateError: Story = {
  args: { dialog: { kind: "separate", key: "o2+o3" }, outputs: null, outputsStatus: "error", outputsError: { message: "The device didn't answer." } },
}
