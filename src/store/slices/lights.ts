import { createAsyncThunk, createSlice, current, type PayloadAction, type ThunkDispatch, type UnknownAction } from "@reduxjs/toolkit"
import type { Effect, LedOutput, LightsView, Palette, StrandPatch, StrandView } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { freeSegs, needMsg, segsNeeded } from "@/lights/model"
import { createApiThunk, type ThunkError } from "../createApiThunk"
import { toast, type ToastsState } from "./toasts"

type Status = "idle" | "loading" | "ok" | "error"
type Field = "on" | "bri" | "ranges"
type Edit = Partial<Pick<StrandView, Field>>

export interface DeviceLights {
  view: LightsView | null
  status: Status
  error: ThunkError | null
  effects: Effect[] | null
  palettes: Palette[] | null
  fxStatus: Status
  fxError: ThunkError | null
  outputs: LedOutput[] | null
  outputsStatus: Status
  outputsError: ThunkError | null
  selected: string | null
  /** Strand key -> the range "Add range" splits. */
  selRange: Record<string, number>
  flash: { key: string; led: number } | null
}

/** One strand's write channel. `base` is the view from before the first unsent or unanswered edit. */
export interface WriteChannel {
  busy: boolean
  base: LightsView | null
  dirty: Field[]
  hold: boolean
}

export interface LightsState {
  devices: Record<string, DeviceLights>
  /** Keyed by `${deviceId}|${strandKey}`. */
  writes: Record<string, WriteChannel>
}

const EMPTY: DeviceLights = {
  view: null,
  status: "idle",
  error: null,
  effects: null,
  palettes: null,
  fxStatus: "idle",
  fxError: null,
  outputs: null,
  outputsStatus: "idle",
  outputsError: null,
  selected: null,
  selRange: {},
  flash: null,
}
const IDLE: WriteChannel = { busy: false, base: null, dirty: [], hold: false }
const FLASH_MS = 3000

const initialState: LightsState = { devices: {}, writes: {} }

const writeKey = (id: string, key: string) => `${id}|${key}`
const strandOf = (view: LightsView | null | undefined, key: string) => view?.strands.find((s) => s.key === key)

function dev(state: LightsState, id: string): DeviceLights {
  return (state.devices[id] ??= structuredClone(EMPTY))
}
function chan(state: LightsState, id: string, key: string): WriteChannel {
  return (state.writes[writeKey(id, key)] ??= structuredClone(IDLE))
}

/**
 * Takes a server view, but keeps the strands whose own channel is still sending or painting:
 * their optimistic values are newer than the answer, and the segments they add still count.
 */
function adopt(state: LightsState, id: string, view: LightsView) {
  const d = dev(state, id)
  const cur = d.view
  let pending = 0
  const strands = view.strands.map((s) => {
    const w = state.writes[writeKey(id, s.key)]
    const keep = w && (w.busy || w.hold) ? strandOf(cur, s.key) : undefined
    if (!keep) return s
    pending += segsNeeded(s, keep.ranges)
    return keep
  })
  d.view = { ...view, strands, segments: { ...view.segments, used: view.segments.used + pending } }
}

/**
 * Puts a strand back as `base` had it, with its segment count. Other strands keep their values.
 * During a paint stroke the channel stays on hold, so the quiet re-read does not replace the strand mid-stroke.
 */
function rollback(state: LightsState, id: string, key: string) {
  const w = state.writes[writeKey(id, key)]
  const v = state.devices[id]?.view
  const was = strandOf(w?.base, key)
  const i = v ? v.strands.findIndex((s) => s.key === key) : -1
  if (v && was && i >= 0) {
    v.segments.used -= segsNeeded(was, v.strands[i]!.ranges)
    v.strands[i] = was
  }
  if (w?.hold && v) state.writes[writeKey(id, key)] = { busy: false, base: current(v), dirty: [], hold: true }
  else delete state.writes[writeKey(id, key)]
}

// API calls. Every one goes through createApiThunk; the thunks below compose them.
const fetchLights = createApiThunk("lights/load", ({ id }: { id: string; quiet: boolean }) => api.getLights(id))
const sendStrand = createApiThunk("lights/patchStrand", ({ id, key, body }: { id: string; key: string; body: StrandPatch }) =>
  api.patchStrand(id, key, body),
)
const sendResolve = createApiThunk(
  "lights/resolveShared",
  ({ id, key, action }: { id: string; key: string; action: "split" | "combine" }) => api.resolveShared(id, key, action),
)
const sendGroups = createApiThunk("lights/putStrandGroups", ({ id, keys }: { id: string; keys: string[] }) => api.putStrandGroups(id, keys))
const sendFlash = createApiThunk("lights/flash", ({ id, key, led }: { id: string; key: string; led: number }) => api.flash(id, key, led))

export const loadFxLists = createApiThunk("lights/loadFxLists", async (id: string) => {
  const [effects, palettes] = await Promise.all([api.getEffects(id), api.getPalettes(id)])
  return { effects, palettes }
})

/** The device's LED outputs (`hw.led.ins`), for the dialogs that name or separate strands. */
export const loadOutputs = createApiThunk("lights/loadOutputs", async (id: string) => (await api.getConfig(id)).hw.led.ins)

/** Renames a strand ("" restores the default name). A failure goes back to the caller and does not toast. */
export const setStrandName = createApiThunk("lights/setStrandName", ({ id, key, name }: { id: string; key: string; name: string }) =>
  api.putStrandNames(id, { [key]: name }),
)

/** Reads the view. `quiet` keeps the current state while it loads and when it fails. */
export const loadLights = (id: string, opts: { quiet?: boolean } = {}) => fetchLights({ id, quiet: !!opts.quiet })

export const lightsSlice = createSlice({
  name: "lights",
  initialState,
  reducers: {
    adoptView(state, action: PayloadAction<{ id: string; view: LightsView }>) {
      adopt(state, action.payload.id, action.payload.view)
    },
    selectStrand(state, action: PayloadAction<{ id: string; key: string }>) {
      dev(state, action.payload.id).selected = action.payload.key
    },
    selectRange(state, action: PayloadAction<{ id: string; key: string; i: number }>) {
      dev(state, action.payload.id).selRange[action.payload.key] = action.payload.i
    },
    /** Paints LEDs `from` to `to` (inclusive, relative to the range) of range `i`, locally. `endPaint` sends them. */
    paintCells(state, action: PayloadAction<{ id: string; key: string; i: number; from: number; to: number; color: string }>) {
      const { id, key, i, from, to, color } = action.payload
      const paint = strandOf(state.devices[id]?.view, key)?.ranges[i]?.paint
      if (!paint) return
      for (let k = Math.max(0, from); k <= Math.min(paint.length - 1, to); k++) paint[k] = color
    },
    edited(state, action: PayloadAction<{ id: string; key: string; patch: Edit; need: number }>) {
      const { id, key, patch, need } = action.payload
      const v = state.devices[id]?.view
      const st = strandOf(v, key)
      if (!v || !st) return
      const w = chan(state, id, key)
      w.base ??= current(v)
      Object.assign(st, patch)
      v.segments.used += need
      for (const f of Object.keys(patch) as Field[]) if (!w.dirty.includes(f)) w.dirty.push(f)
    },
    sending(state, action: PayloadAction<{ id: string; key: string }>) {
      const w = chan(state, action.payload.id, action.payload.key)
      w.busy = true
      w.dirty = []
    },
    /** The channel's last answer: adopt it, unless a paint stroke started meanwhile. */
    settled(state, action: PayloadAction<{ id: string; key: string; view: LightsView }>) {
      const { id, key, view } = action.payload
      const w = chan(state, id, key)
      w.busy = false
      // A paint stroke started while this was in flight: drop the answer so the stroke keeps its cells.
      // `endPaint` sends again, and that answer carries the other strands' updates.
      if (w.hold) return
      delete state.writes[writeKey(id, key)]
      adopt(state, id, view)
    },
    /** The strand left the view while its write was in flight; nothing is left to send. */
    dropped(state, action: PayloadAction<{ id: string; key: string }>) {
      delete state.writes[writeKey(action.payload.id, action.payload.key)]
    },
    failed(state, action: PayloadAction<{ id: string; key: string }>) {
      rollback(state, action.payload.id, action.payload.key)
    },
    paintBegan(state, action: PayloadAction<{ id: string; key: string }>) {
      const { id, key } = action.payload
      const v = state.devices[id]?.view
      if (!v) return
      const w = chan(state, id, key)
      w.base ??= current(v)
      w.hold = true
    },
    paintEnded(state, action: PayloadAction<{ id: string; key: string }>) {
      const w = chan(state, action.payload.id, action.payload.key)
      w.hold = false
      if (!w.dirty.includes("ranges")) w.dirty.push("ranges")
    },
    flashSet(state, action: PayloadAction<{ id: string; key: string; led: number }>) {
      const { id, key, led } = action.payload
      dev(state, id).flash = { key, led }
    },
    flashCleared(state, action: PayloadAction<string>) {
      dev(state, action.payload).flash = null
    },
  },
  extraReducers: (builder) => {
    builder
    .addCase(fetchLights.pending, (state, action) => {
      if (action.meta.arg.quiet) return
      const d = dev(state, action.meta.arg.id)
      d.status = "loading"
      d.error = null
    })
    .addCase(fetchLights.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg.id)
      adopt(state, action.meta.arg.id, action.payload)
      d.status = "ok"
      d.error = null
    })
    .addCase(fetchLights.rejected, (state, action) => {
      if (action.meta.arg.quiet) return
      const d = dev(state, action.meta.arg.id)
      d.status = "error"
      d.error = action.payload ?? null
    })
    .addCase(sendResolve.fulfilled, (state, action) => {
      const { id, key, action: how } = action.meta.arg
      const d = dev(state, id)
      if (how === "combine") {
        // The server keys a combination by its members in LED order.
        const keys = [key, ...(strandOf(d.view, key)?.shared?.with ?? [])]
        const start = (k: string) => strandOf(d.view, k)?.start ?? Infinity
        d.selected = keys.sort((a, b) => start(a) - start(b)).join("+")
      }
      adopt(state, id, action.payload)
    })
    .addCase(sendGroups.fulfilled, (state, action) => adopt(state, action.meta.arg.id, action.payload))
    .addCase(setStrandName.fulfilled, (state, action) => adopt(state, action.meta.arg.id, action.payload))
    .addCase(loadFxLists.pending, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.fxStatus = "loading"
      d.fxError = null
    })
    .addCase(loadFxLists.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.effects = action.payload.effects
      d.palettes = action.payload.palettes
      d.fxStatus = "ok"
    })
    .addCase(loadFxLists.rejected, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.fxStatus = "error"
      d.fxError = action.payload ?? null
    })
    .addCase(loadOutputs.pending, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.outputsStatus = "loading"
      d.outputsError = null
    })
    .addCase(loadOutputs.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.outputs = action.payload
      d.outputsStatus = "ok"
    })
    .addCase(loadOutputs.rejected, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.outputsStatus = "error"
      d.outputsError = action.payload ?? null
    })
  },
})

export const { adoptView, selectStrand, selectRange, paintCells } = lightsSlice.actions
const { edited, sending, settled, dropped, failed, paintBegan, paintEnded, flashSet, flashCleared } = lightsSlice.actions

type LightsRoot = { lights: LightsState; toasts: ToastsState }
type LightsDispatch = ThunkDispatch<LightsRoot, unknown, UnknownAction>
type Thunk<R> = (dispatch: LightsDispatch, getState: () => LightsRoot) => R

export const selectLights = (state: { lights: LightsState }, id: string): DeviceLights => state.lights.devices[id] ?? EMPTY

/** The selected strand, else the first one. */
export const selectedStrand = (state: { lights: LightsState }, id: string): StrandView | null => {
  const d = selectLights(state, id)
  return strandOf(d.view, d.selected ?? "") ?? d.view?.strands[0] ?? null
}

/** A failed lights write: toast, then re-read the view quietly (the device may hold part of the write). */
const lightsError =
  (id: string, e: ThunkError | undefined): Thunk<void> =>
  (dispatch) => {
    dispatch(toast("error", "Couldn't change the lights", e?.message ?? ""))
    void dispatch(loadLights(id, { quiet: true }))
  }

/** Sends the channel's dirty fields, one request at a time, until nothing new is waiting. */
const pump =
  (id: string, key: string): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    for (;;) {
      const { lights } = getState()
      const w = lights.writes[writeKey(id, key)]
      const st = strandOf(lights.devices[id]?.view, key)
      if (!w || !st) {
        dispatch(dropped({ id, key }))
        return
      }
      const body: StrandPatch = {}
      for (const f of w.dirty) Object.assign(body, { [f]: structuredClone(st[f]) })
      dispatch(sending({ id, key }))
      const res = await dispatch(sendStrand({ id, key, body }))
      if (sendStrand.rejected.match(res)) {
        dispatch(failed({ id, key }))
        dispatch(lightsError(id, res.payload))
        return
      }
      const after = getState().lights.writes[writeKey(id, key)]
      if (after && after.dirty.length > 0 && !after.hold) continue
      dispatch(settled({ id, key, view: res.payload }))
      return
    }
  }

const startPump =
  (id: string, key: string): Thunk<void> =>
  (dispatch, getState) => {
    const w = getState().lights.writes[writeKey(id, key)]
    if (w && !w.busy && !w.hold && w.dirty.length > 0) void dispatch(pump(id, key))
  }

/**
 * Applies an edit to a strand at once and queues it for the device. A `ranges` edit the segment budget
 * can't take is refused with a toast and returns false. On a normalize strand the server decides.
 */
export const editStrand =
  ({ id, key, patch }: { id: string; key: string; patch: Edit }): Thunk<boolean> =>
  (dispatch, getState) => {
    const v = getState().lights.devices[id]?.view
    const st = strandOf(v, key)
    if (!v || !st) return false
    const need = patch.ranges ? segsNeeded(st, patch.ranges) : 0
    if (!st.normalize && need > 0 && need > freeSegs(v)) {
      dispatch(toast("error", "Not enough segments", needMsg(need, freeSegs(v))))
      return false
    }
    dispatch(edited({ id, key, patch, need }))
    dispatch(startPump(id, key))
    return true
  }

/** Starts a paint stroke: `paintCells` changes the view locally until `endPaint` sends it. */
export const beginPaint =
  ({ id, key }: { id: string; key: string }): Thunk<void> =>
  (dispatch) => {
    dispatch(paintBegan({ id, key }))
  }

export const endPaint =
  ({ id, key }: { id: string; key: string }): Thunk<void> =>
  (dispatch) => {
    dispatch(paintEnded({ id, key }))
    dispatch(startPump(id, key))
  }

/** Flashes one LED; the strip marks it for 3 seconds. */
export const flashLed =
  ({ id, key, led }: { id: string; key: string; led: number }): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const res = await dispatch(sendFlash({ id, key, led }))
    if (sendFlash.rejected.match(res)) {
      dispatch(toast("error", "Couldn't flash the LED", res.payload?.message ?? ""))
      return
    }
    dispatch(flashSet({ id, key, led }))
    // The reducer makes a new object for each flash, so the reference tells a newer flash apart.
    const mine = selectLights(getState(), id).flash
    setTimeout(() => {
      if (selectLights(getState(), id).flash === mine) dispatch(flashCleared(id))
    }, FLASH_MS)
  }

/** Splits a shared strand or combines it with the strands it shares; selects the combined strand. */
export const resolveShared = createAsyncThunk<
  LightsView,
  { id: string; key: string; action: "split" | "combine" },
  { state: LightsRoot; dispatch: LightsDispatch; rejectValue: ThunkError }
>("lights/resolveSharedFlow", async (arg, { dispatch, rejectWithValue }) => {
  const res = await dispatch(sendResolve(arg))
  if (sendResolve.rejected.match(res)) {
    dispatch(lightsError(arg.id, res.payload))
    return rejectWithValue(res.payload ?? { message: "" })
  }
  if (arg.action === "combine") dispatch(toast("success", "Strands combined", "They're one strand now."))
  else dispatch(toast("success", "Split by strand", "Each strand has its own range now."))
  return res.payload
})

/** Replaces the device's strand combinations. */
export const setStrandGroups = createAsyncThunk<
  LightsView,
  { id: string; keys: string[] },
  { state: LightsRoot; dispatch: LightsDispatch; rejectValue: ThunkError }
>("lights/setStrandGroupsFlow", async (arg, { dispatch, rejectWithValue }) => {
  const res = await dispatch(sendGroups(arg))
  if (sendGroups.rejected.match(res)) {
    dispatch(lightsError(arg.id, res.payload))
    return rejectWithValue(res.payload ?? { message: "" })
  }
  return res.payload
})
