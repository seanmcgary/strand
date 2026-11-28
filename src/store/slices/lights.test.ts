import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LightsView, RangeView, SlotView, StrandView } from "../../../shared/apiTypes"
import { api, ApiError } from "@/api/client"
import { makeStore } from "../index"
import { toastsSlice } from "./toasts"
import {
  adoptView,
  beginPaint,
  editStrand,
  flashLed,
  lightsSlice,
  loadFxLists,
  loadLights,
  resolveShared,
  selectLights,
  setStrandGroups,
  setStrandName,
} from "./lights"

const slot: SlotView = {
  on: true,
  col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]],
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  c1: 0,
  c2: 0,
  c3: 0,
  o1: false,
  o2: false,
  o3: false,
  pal: 0,
  palName: "Default",
}
const range = (name: string, start: number, len: number, extra: Partial<RangeView> = {}): RangeView => ({
  name,
  start,
  len,
  pattern: { kind: "all" },
  slots: [slot],
  ...extra,
})
const strand = (key: string, start: number, len: number, extra: Partial<StrandView> = {}): StrandView => ({
  key,
  name: key,
  pins: [2],
  start,
  len,
  on: true,
  bri: 128,
  ranges: [range("A", 0, len)],
  normalize: false,
  ...extra,
})
const makeView = (over: Partial<LightsView> = {}, o0: Partial<StrandView> = {}): LightsView => ({
  on: true,
  bri: 128,
  strands: [strand("o0", 0, 100, o0), strand("o1", 100, 50)],
  segments: { used: 2, max: 4 },
  notices: [],
  matrix: false,
  ...over,
})
/** o0 cut into `n` equal All ranges. */
const cut = (n: number): RangeView[] => Array.from({ length: n }, (_, k) => range(`R${k}`, k * (100 / n), 100 / n))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const roomy = { segments: { used: 2, max: 8 } }
const flush = () => new Promise((r) => setTimeout(r, 0))

async function setup(view: LightsView = makeView()) {
  const store = makeStore({ lights: lightsSlice.reducer, toasts: toastsSlice.reducer })
  const getLights = vi.spyOn(api, "getLights").mockResolvedValueOnce(view)
  await store.dispatch(loadLights("d1"))
  const lights = () => selectLights(store.getState(), "d1")
  const titles = () => store.getState().toasts.items.map((t) => t.title)
  return { store, getLights, lights, titles }
}

afterEach(() => vi.restoreAllMocks())

describe("strand writes", () => {
  // Fails if the queue sends a second request while one is in flight, or sends a stale value next.
  it("keeps one request in flight and sends the newest edit next", async () => {
    const { store, lights } = await setup(makeView(roomy))
    const calls = [deferred<LightsView>(), deferred<LightsView>()]
    const patch = vi.spyOn(api, "patchStrand").mockImplementation(() => calls[patch.mock.calls.length - 1]!.promise)

    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(2) } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(4) } }))
    expect(patch).toHaveBeenCalledTimes(1)

    calls[0]!.resolve(makeView({ segments: { used: 3, max: 8 } }, { ranges: cut(2) }))
    await flush()
    expect(patch).toHaveBeenCalledTimes(2)
    expect(patch.mock.calls[1]).toEqual(["d1", "o0", { ranges: cut(4) }])

    const answer = makeView({ segments: { used: 5, max: 6 } }, { ranges: cut(4) })
    calls[1]!.resolve(answer)
    await flush()
    expect(lights().view).toEqual(answer)
  })

  // Fails if a failed write does not restore the view from before the edits, clear the channel, and toast.
  it("rolls back and keeps the rolled-back view when the quiet read fails too", async () => {
    const { store, lights, getLights, titles } = await setup(makeView(roomy))
    const before = lights().view
    const first = deferred<LightsView>()
    vi.spyOn(api, "patchStrand").mockReturnValueOnce(first.promise)
    getLights.mockRejectedValueOnce(new ApiError(504, "device_offline", "m"))

    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(2) } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(4) } }))
    first.reject(new ApiError(504, "device_offline", "m"))
    await flush()

    expect(lights().view).toEqual(before)
    expect(store.getState().lights.writes["d1|o0"]?.dirty ?? []).toEqual([])
    expect(titles()).toContain("Couldn't change the lights")
  })

  // Fails if the error path does not re-read the view after a failed write.
  it("shows the re-read view after a failed write", async () => {
    const { store, lights, getLights } = await setup()
    const fresh = makeView({}, { name: "Eaves" })
    vi.spyOn(api, "patchStrand").mockRejectedValueOnce(new ApiError(409, "strand_changed", "m"))
    getLights.mockResolvedValueOnce(fresh)

    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 10 } }))
    await flush()

    expect(getLights).toHaveBeenCalledTimes(2)
    expect(lights().view).toEqual(fresh)
  })

  // Fails if adopting one strand's answer overwrites another strand whose write is still in flight.
  it("keeps a strand's optimistic view while its own write is in flight", async () => {
    const { store, lights } = await setup()
    const o1Call = deferred<LightsView>()
    const o0Call = deferred<LightsView>()
    vi.spyOn(api, "patchStrand").mockReturnValueOnce(o1Call.promise).mockReturnValueOnce(o0Call.promise)

    store.dispatch(editStrand({ id: "d1", key: "o1", patch: { bri: 20 } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 30 } }))
    o0Call.resolve(makeView({}, { bri: 30 }))
    await flush()

    expect(lights().view!.strands.map((s) => s.bri)).toEqual([30, 20])
  })

  // Fails if the budget check is missing, or if it blocks a normalize strand the server decides on.
  it("refuses an edit over the segment budget, except on a normalize strand", async () => {
    const full = { segments: { used: 3, max: 4 } }
    const a = await setup(makeView(full))
    const patch = vi.spyOn(api, "patchStrand").mockReturnValue(new Promise(() => {}))

    expect(a.store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(3) } }))).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    expect(a.titles()).toEqual(["Not enough segments"])

    const b = await setup(makeView(full, { normalize: true }))
    expect(b.store.dispatch(editStrand({ id: "d1", key: "o0", patch: { ranges: cut(3) } }))).toBe(true)
    expect(patch).toHaveBeenCalledTimes(1)
  })

  // Fails if a channel whose strand vanished mid-write stays busy, so later edits to that key never send.
  it("sends edits to a strand that left the view and came back", async () => {
    const { store } = await setup(makeView(roomy))
    const first = deferred<LightsView>()
    const patch = vi.spyOn(api, "patchStrand").mockReturnValueOnce(first.promise).mockReturnValue(new Promise(() => {}))

    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 10 } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 20 } }))
    store.dispatch(adoptView({ id: "d1", view: makeView({ ...roomy, strands: [strand("o1", 100, 50)] }) }))
    first.resolve(makeView(roomy))
    await flush()
    store.dispatch(adoptView({ id: "d1", view: makeView(roomy) }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 30 } }))

    expect(patch).toHaveBeenCalledTimes(2)
  })

  // Fails if adopting an answer drops the segments another strand's in-flight edit has taken.
  it("keeps the segments of another strand's in-flight edit", async () => {
    const { store, lights } = await setup(makeView(roomy))
    const o1Call = deferred<LightsView>()
    const o0Call = deferred<LightsView>()
    vi.spyOn(api, "patchStrand").mockReturnValueOnce(o1Call.promise).mockReturnValueOnce(o0Call.promise)

    store.dispatch(editStrand({ id: "d1", key: "o1", patch: { ranges: [range("A", 0, 25), range("B", 25, 25)] } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 30 } }))
    o0Call.resolve(makeView(roomy, { bri: 30 }))
    await flush()

    expect(lights().view!.segments.used).toBe(3)
  })

  // Fails if a failed write rolls back strands other than its own.
  it("rolls back only the strand whose write failed", async () => {
    const { store, lights, getLights } = await setup()
    const o1Call = deferred<LightsView>()
    const o0Call = deferred<LightsView>()
    vi.spyOn(api, "patchStrand").mockReturnValueOnce(o1Call.promise).mockReturnValueOnce(o0Call.promise)
    getLights.mockRejectedValue(new ApiError(504, "device_offline", "m"))

    store.dispatch(editStrand({ id: "d1", key: "o1", patch: { bri: 20 } }))
    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 30 } }))
    o0Call.reject(new ApiError(504, "device_offline", "m"))
    await flush()

    expect(lights().view!.strands.map((st) => st.bri)).toEqual([128, 20])
  })

  // Fails if a failed write during a paint stroke ends the hold, so the quiet re-read replaces the strand mid-stroke.
  it("keeps a paint stroke's hold through a failed write", async () => {
    const { store, lights, getLights } = await setup()
    const first = deferred<LightsView>()
    vi.spyOn(api, "patchStrand").mockReturnValueOnce(first.promise)
    getLights.mockResolvedValueOnce(makeView({}, { name: "Eaves" }))

    store.dispatch(editStrand({ id: "d1", key: "o0", patch: { bri: 10 } }))
    store.dispatch(beginPaint({ id: "d1", key: "o0" }))
    first.reject(new ApiError(504, "device_offline", "m"))
    await flush()

    expect(lights().view!.strands[0]).toMatchObject({ name: "o0", bri: 128 })
    expect(store.getState().lights.writes["d1|o0"]?.hold).toBe(true)
  })
})

describe("flashLed", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout"] }))
  afterEach(() => vi.useRealTimers())

  // Fails if the flash is not cleared after 3000 ms, or if an older flash's timer clears a newer one.
  it("clears a flash after 3000 ms unless a newer flash replaced it", async () => {
    const store = makeStore({ lights: lightsSlice.reducer, toasts: toastsSlice.reducer })
    vi.spyOn(api, "flash").mockResolvedValue(undefined)
    const flash = () => selectLights(store.getState(), "d1").flash

    await store.dispatch(flashLed({ id: "d1", key: "o0", led: 5 }))
    expect(flash()).toEqual({ key: "o0", led: 5 })
    vi.advanceTimersByTime(3000)
    expect(flash()).toBeNull()

    await store.dispatch(flashLed({ id: "d1", key: "o0", led: 5 }))
    vi.advanceTimersByTime(2000)
    await store.dispatch(flashLed({ id: "d1", key: "o0", led: 5 }))
    vi.advanceTimersByTime(1000)
    expect(flash()).toEqual({ key: "o0", led: 5 })
    vi.advanceTimersByTime(2000)
    expect(flash()).toBeNull()
  })
})

describe("server-side strand changes", () => {
  // Fails if combining does not select the joined strand (members in LED order, as the server keys it) or skips the toast.
  it("selects the combined strand after combine", async () => {
    // o1 comes first on the wire, so the server's key is "o1+o0".
    const shared = makeView({ strands: [strand("o1", 0, 50, { shared: { with: ["o0"] } }), strand("o0", 50, 100)] })
    const { store, lights, titles } = await setup(shared)
    const joined = makeView({ strands: [strand("o1+o0", 0, 150)] })
    vi.spyOn(api, "resolveShared").mockResolvedValueOnce(joined)

    await store.dispatch(resolveShared({ id: "d1", key: "o1", action: "combine" }))

    expect(lights().selected).toBe("o1+o0")
    expect(titles()).toEqual(["Strands combined"])
  })

  // Fails if splitting skips its success toast.
  it("toasts after a split", async () => {
    const { store, titles } = await setup(makeView({}, { shared: { with: ["o1"] } }))
    vi.spyOn(api, "resolveShared").mockResolvedValueOnce(makeView())

    await store.dispatch(resolveShared({ id: "d1", key: "o0", action: "split" }))

    expect(titles()).toEqual(["Split by strand"])
  })

  // Fails if resolveShared or setStrandGroups skip the lights error path.
  it.each([
    ["resolveShared", "resolveShared"],
    ["setStrandGroups", "putStrandGroups"],
  ] as const)("toasts when %s fails", async (_, fn) => {
    const { store, getLights, titles } = await setup()
    vi.spyOn(api, fn).mockRejectedValueOnce(new ApiError(504, "device_offline", "m"))
    getLights.mockResolvedValueOnce(makeView())

    if (fn === "resolveShared") await store.dispatch(resolveShared({ id: "d1", key: "o0", action: "split" }))
    else await store.dispatch(setStrandGroups({ id: "d1", keys: ["o0+o1"] }))

    expect(titles()).toEqual(["Couldn't change the lights"])
  })

  // Fails if a failed rename toasts or drops the server's message instead of handing it to the dialog.
  it("hands a rename error to the caller without a toast", async () => {
    const { store, titles } = await setup()
    vi.spyOn(api, "putStrandNames").mockRejectedValueOnce(new ApiError(422, "invalid_name", "Names need 1 to 64 characters."))

    const action = await store.dispatch(setStrandName({ id: "d1", key: "o0", name: "x" }))

    expect(action.payload).toMatchObject({ message: "Names need 1 to 64 characters." })
    expect(titles()).toEqual([])
  })

  // Fails if a failed effects or palettes load does not set its own error state.
  it("records a failed effects load", async () => {
    const { store, lights } = await setup()
    vi.spyOn(api, "getEffects").mockRejectedValueOnce(new ApiError(504, "device_offline", "m"))
    vi.spyOn(api, "getPalettes").mockResolvedValueOnce([])

    await store.dispatch(loadFxLists("d1"))

    expect(lights().fxStatus).toBe("error")
    expect(lights().fxError?.message).toBe("m")
  })
})
