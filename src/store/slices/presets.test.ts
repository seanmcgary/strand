import { afterEach, describe, expect, it, vi } from "vitest"
import type { LookRecord, Scene } from "../../../shared/apiTypes"
import { allRange, strand, view } from "../../../test/lightsView"
import { api, ApiError } from "@/api/client"
import { makeStore } from "../index"
import { lightsSlice, loadLights, selectLights } from "./lights"
import { applyLook, applyScene, createScene, deleteScene, loadPresets, presetsSlice, renameScene, selectPresets } from "./presets"
import { toastsSlice } from "./toasts"

const scene = (id: string, name: string, strandKey = "o0"): Scene => ({
  id,
  name,
  strandKey,
  ledCount: 100,
  summary: "1 range · 50%",
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
})
const look = (id: string): LookRecord => ({
  id,
  name: "Candy",
  look: { pattern: { kind: "all" }, slots: [] },
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
})
const two = view([strand("o0", "Patio", 100, [allRange("A", 0, 50), allRange("B", 50, 50)]), strand("o1", "Fence", 100, [allRange("C", 0, 100)])])
const after = view([strand("o0", "Patio", 100, [allRange("A", 0, 50)])])

const setup = () => {
  const store = makeStore({ lights: lightsSlice.reducer, presets: presetsSlice.reducer, toasts: toastsSlice.reducer })
  const toasts = () => store.getState().toasts.items.map((t) => [t.title, t.desc])
  return { store, toasts, presets: () => selectPresets(store.getState(), "d1"), lights: () => selectLights(store.getState(), "d1") }
}

afterEach(() => vi.restoreAllMocks())

describe("loading", () => {
  // Fails if a failed reload throws away lists that are already on screen, or an empty load reads as an error.
  it("keeps the lists when a reload fails and shows the error only when there is nothing to show", async () => {
    const { store, presets } = setup()
    vi.spyOn(api, "getLights").mockResolvedValue(two)
    const scenes = vi.spyOn(api, "getScenes").mockRejectedValueOnce(new ApiError(504, "device_offline", "No answer."))
    vi.spyOn(api, "getLooks").mockResolvedValue([])
    await store.dispatch(loadPresets("d1"))
    expect([presets().status, presets().error?.message]).toEqual(["error", "No answer."])

    scenes.mockResolvedValueOnce([scene("s1", "Party")])
    await store.dispatch(loadPresets("d1"))
    expect([presets().status, presets().scenes?.length]).toEqual(["ok", 1])

    scenes.mockRejectedValueOnce(new ApiError(504, "device_offline", "No answer."))
    await store.dispatch(loadPresets("d1"))
    expect([presets().status, presets().scenes?.length]).toEqual(["ok", 1])
  })
})

describe("scenes", () => {
  // Fails if save, rename or delete stop updating the list the tab shows, or if a failed delete drops the row.
  it("adds, renames and removes scenes in the list", async () => {
    const { store, presets, toasts } = setup()
    vi.spyOn(api, "getLights").mockResolvedValue(two)
    vi.spyOn(api, "getScenes").mockResolvedValue([scene("s1", "Party")])
    vi.spyOn(api, "getLooks").mockResolvedValue([])
    await store.dispatch(loadPresets("d1"))

    vi.spyOn(api, "createScene").mockResolvedValue(scene("s2", "Calm"))
    await store.dispatch(createScene({ id: "d1", name: "Calm", strandKey: "o0" }))
    vi.spyOn(api, "renameScene").mockResolvedValue(scene("s1", "Rave"))
    await store.dispatch(renameScene({ id: "d1", sceneId: "s1", name: "Rave" }))
    expect(presets().scenes?.map((s) => s.name)).toEqual(["Rave", "Calm"])

    vi.spyOn(api, "deleteScene").mockRejectedValueOnce(new ApiError(504, "device_offline", "No answer."))
    await store.dispatch(deleteScene({ id: "d1", sceneId: "s1", name: "Rave" }))
    expect(presets().scenes).toHaveLength(2)
    expect(toasts().at(-1)).toEqual(["Couldn't delete Rave", "No answer."])
    vi.spyOn(api, "deleteScene").mockResolvedValue(undefined)
    await store.dispatch(deleteScene({ id: "d1", sceneId: "s1", name: "Rave" }))
    expect(presets().scenes?.map((s) => s.name)).toEqual(["Calm"])
  })

  // Fails if applying a scene stops adopting the answer, selecting the scene's strand, or clearing the busy mark.
  it("adopts the view, selects the strand and marks the scene busy while it applies", async () => {
    const { store, presets, lights, toasts } = setup()
    let answer!: (r: { view: typeof after; warnings: string[] }) => void
    vi.spyOn(api, "applyScene").mockReturnValue(new Promise((r) => (answer = r)))
    const done = store.dispatch(applyScene({ id: "d1", scene: scene("s1", "Party", "o1") }))
    expect(presets().applying).toEqual(["s1"])
    answer({ view: after, warnings: ["W1", "W2"] })
    await done
    expect([presets().applying, lights().view, lights().selected]).toEqual([[], after, "o1"])
    expect(toasts()).toEqual([["Applied Party", "W1 W2"]])
  })

  // Fails if one apply finishing clears the busy mark of another that is still in flight.
  it("keeps each scene busy until its own apply finishes", async () => {
    const { store, presets } = setup()
    const answers: Array<(r: { view: typeof after; warnings: string[] }) => void> = []
    vi.spyOn(api, "applyScene").mockImplementation(() => new Promise((r) => answers.push(r)))
    const first = store.dispatch(applyScene({ id: "d1", scene: scene("s1", "A") }))
    const second = store.dispatch(applyScene({ id: "d1", scene: scene("s2", "B") }))
    expect(presets().applying).toEqual(["s1", "s2"])
    answers[0]!({ view: after, warnings: [] })
    await first
    expect(presets().applying).toEqual(["s2"])
    answers[1]!({ view: after, warnings: [] })
    await second
    expect(presets().applying).toEqual([])
  })

  // Fails if a failed scene apply stops re-reading the lights, since the device may hold part of the write.
  it("re-reads the lights quietly after a failed apply", async () => {
    const { store, lights } = setup()
    vi.spyOn(api, "getLights").mockResolvedValueOnce(two)
    await store.dispatch(loadLights("d1"))
    vi.spyOn(api, "applyScene").mockRejectedValue(new ApiError(504, "device_offline", "No answer."))
    const reread = vi.spyOn(api, "getLights").mockResolvedValue(after)
    await store.dispatch(applyScene({ id: "d1", scene: scene("s1", "Party") }))
    await vi.waitFor(() => expect(lights().view).toEqual(after))
    expect(reread).toHaveBeenCalledTimes(1)
  })
})

describe("looks", () => {
  // Fails if the toast counts ranges from the answer instead of the targets, or a whole-strand target counts as one.
  it("counts the ranges of the targets in the toast", async () => {
    const { store, toasts } = setup()
    vi.spyOn(api, "getLights").mockResolvedValueOnce(two)
    await store.dispatch(loadLights("d1"))
    vi.spyOn(api, "applyLook").mockResolvedValue({ view: after, warnings: ["Careful."] })
    await store.dispatch(applyLook({ id: "d1", look: look("l1"), targets: [{ strandKey: "o0" }, { strandKey: "o1", range: "C" }] }))
    expect(toasts()).toEqual([["Applied Candy", "Changed 3 ranges. Careful."]])
  })
})
