import { createAsyncThunk, createSlice, type ThunkDispatch, type UnknownAction } from "@reduxjs/toolkit"
import type { ApplyResult, LookRecord, LookTarget, Scene } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { plural } from "@/lights/model"
import { createApiThunk, type ThunkError } from "../createApiThunk"
import { adoptView, lightsError, loadLights, selectStrand, type LightsState } from "./lights"
import { toast, type ToastsState } from "./toasts"

export interface DevicePresets {
  scenes: Scene[] | null
  looks: LookRecord[] | null
  status: "idle" | "loading" | "ok" | "error"
  error: ThunkError | null
  /** The id of the scene whose apply is in flight. */
  applying: string | null
}

export interface PresetsState {
  byDevice: Record<string, DevicePresets>
}

const EMPTY: DevicePresets = { scenes: null, looks: null, status: "idle", error: null, applying: null }

const dev = (state: PresetsState, id: string): DevicePresets => (state.byDevice[id] ??= structuredClone(EMPTY))

// API calls. Every one goes through createApiThunk; the flows below compose them.
const fetchPresets = createApiThunk("presets/load", async (id: string) => {
  const [scenes, looks] = await Promise.all([api.getScenes(id), api.getLooks(id)])
  return { scenes, looks }
})
const sendCreateScene = createApiThunk("presets/createScene", ({ id, ...body }: { id: string; name: string; strandKey: string }) =>
  api.createScene(id, body),
)
const sendRenameScene = createApiThunk("presets/renameScene", ({ id, sceneId, name }: { id: string; sceneId: string; name: string }) =>
  api.renameScene(id, sceneId, name),
)
const sendDeleteScene = createApiThunk("presets/deleteScene", ({ id, sceneId }: { id: string; sceneId: string; name: string }) =>
  api.deleteScene(id, sceneId),
)
const sendApplyScene = createApiThunk("presets/applyScene", ({ id, scene }: { id: string; scene: Scene }) => api.applyScene(id, scene.id))
const sendCreateLook = createApiThunk("presets/createLook", ({ id, ...body }: { id: string; name: string; strandKey: string; range: string }) =>
  api.createLook(id, body),
)
const sendRenameLook = createApiThunk("presets/renameLook", ({ id, lookId, name }: { id: string; lookId: string; name: string }) =>
  api.renameLook(id, lookId, name),
)
const sendDeleteLook = createApiThunk("presets/deleteLook", ({ id, lookId }: { id: string; lookId: string; name: string }) =>
  api.deleteLook(id, lookId),
)
const sendApplyLook = createApiThunk("presets/applyLook", ({ id, look, targets }: { id: string; look: LookRecord; targets: LookTarget[] }) =>
  api.applyLook(id, look.id, targets),
)

export const presetsSlice = createSlice({
  name: "presets",
  initialState: { byDevice: {} } as PresetsState,
  reducers: {},
  extraReducers: (builder) => {
    builder
    .addCase(fetchPresets.pending, (state, action) => {
      const d = dev(state, action.meta.arg)
      if (!d.scenes || !d.looks) d.status = "loading"
      d.error = null
    })
    .addCase(fetchPresets.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg)
      d.scenes = action.payload.scenes
      d.looks = action.payload.looks
      d.status = "ok"
    })
    .addCase(fetchPresets.rejected, (state, action) => {
      const d = dev(state, action.meta.arg)
      // Lists already on screen stay; the error shows only in place of nothing.
      if (d.scenes && d.looks) return
      d.status = "error"
      d.error = action.payload ?? null
    })
    .addCase(sendCreateScene.fulfilled, (state, action) => {
      dev(state, action.meta.arg.id).scenes?.push(action.payload)
    })
    .addCase(sendRenameScene.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg.id)
      d.scenes = d.scenes?.map((s) => (s.id === action.payload.id ? action.payload : s)) ?? null
    })
    .addCase(sendDeleteScene.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg.id)
      d.scenes = d.scenes?.filter((s) => s.id !== action.meta.arg.sceneId) ?? null
    })
    .addCase(sendApplyScene.pending, (state, action) => {
      dev(state, action.meta.arg.id).applying = action.meta.arg.scene.id
    })
    .addCase(sendApplyScene.fulfilled, (state, action) => {
      dev(state, action.meta.arg.id).applying = null
    })
    .addCase(sendApplyScene.rejected, (state, action) => {
      dev(state, action.meta.arg.id).applying = null
    })
    .addCase(sendCreateLook.fulfilled, (state, action) => {
      dev(state, action.meta.arg.id).looks?.push(action.payload)
    })
    .addCase(sendRenameLook.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg.id)
      d.looks = d.looks?.map((l) => (l.id === action.payload.id ? action.payload : l)) ?? null
    })
    .addCase(sendDeleteLook.fulfilled, (state, action) => {
      const d = dev(state, action.meta.arg.id)
      d.looks = d.looks?.filter((l) => l.id !== action.meta.arg.lookId) ?? null
    })
  },
})

type Root = { lights: LightsState; presets: PresetsState; toasts: ToastsState }
type Dispatch = ThunkDispatch<Root, unknown, UnknownAction>
type Config = { state: Root; dispatch: Dispatch; rejectValue: ThunkError }
const fail = (e: ThunkError | undefined): ThunkError => e ?? { message: "" }

export const selectPresets = (state: { presets: PresetsState }, id: string): DevicePresets => state.presets.byDevice[id] ?? EMPTY

/** Reads the lights, scenes and looks. Lists and view that are already loaded stay on screen while it loads. */
export const loadPresets = (id: string) => (dispatch: Dispatch, getState: () => Root) => {
  void dispatch(loadLights(id, { quiet: !!getState().lights.devices[id]?.view }))
  return dispatch(fetchPresets(id))
}

/** Saves a strand's setup. A refusal rejects with the server's message and the caller shows it. */
export const createScene = createAsyncThunk<Scene, { id: string; name: string; strandKey: string }, Config>(
  "presets/createSceneFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendCreateScene(arg))
    if (sendCreateScene.rejected.match(res)) return rejectWithValue(fail(res.payload))
    dispatch(toast("success", `Saved ${res.payload.name}`))
    return res.payload
  },
)

export const renameScene = createAsyncThunk<Scene, { id: string; sceneId: string; name: string }, Config>(
  "presets/renameSceneFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendRenameScene(arg))
    if (sendRenameScene.rejected.match(res)) return rejectWithValue(fail(res.payload))
    return res.payload
  },
)

/** A failure toasts and rejects; `name` is the scene's name for the toasts. */
export const deleteScene = createAsyncThunk<void, { id: string; sceneId: string; name: string }, Config>(
  "presets/deleteSceneFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendDeleteScene(arg))
    if (sendDeleteScene.rejected.match(res)) {
      dispatch(toast("error", `Couldn't delete ${arg.name}`, res.payload?.message ?? ""))
      return rejectWithValue(fail(res.payload))
    }
    dispatch(toast("success", `Deleted ${arg.name}`))
  },
)

/** Applies a scene: adopts the new view and selects the scene's strand. A failure toasts and re-reads the lights. */
export const applyScene = createAsyncThunk<ApplyResult, { id: string; scene: Scene }, Config>(
  "presets/applySceneFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendApplyScene(arg))
    if (sendApplyScene.rejected.match(res)) {
      dispatch(lightsError(arg.id, res.payload))
      return rejectWithValue(fail(res.payload))
    }
    dispatch(adoptView({ id: arg.id, view: res.payload.view }))
    dispatch(selectStrand({ id: arg.id, key: arg.scene.strandKey }))
    dispatch(toast("success", `Applied ${arg.scene.name}`, res.payload.warnings.join(" ")))
    return res.payload
  },
)

export const createLook = createAsyncThunk<LookRecord, { id: string; name: string; strandKey: string; range: string }, Config>(
  "presets/createLookFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendCreateLook(arg))
    if (sendCreateLook.rejected.match(res)) return rejectWithValue(fail(res.payload))
    dispatch(toast("success", `Saved ${res.payload.name}`))
    return res.payload
  },
)

export const renameLook = createAsyncThunk<LookRecord, { id: string; lookId: string; name: string }, Config>(
  "presets/renameLookFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendRenameLook(arg))
    if (sendRenameLook.rejected.match(res)) return rejectWithValue(fail(res.payload))
    return res.payload
  },
)

export const deleteLook = createAsyncThunk<void, { id: string; lookId: string; name: string }, Config>(
  "presets/deleteLookFlow",
  async (arg, { dispatch, rejectWithValue }) => {
    const res = await dispatch(sendDeleteLook(arg))
    if (sendDeleteLook.rejected.match(res)) {
      dispatch(toast("error", `Couldn't delete ${arg.name}`, res.payload?.message ?? ""))
      return rejectWithValue(fail(res.payload))
    }
    dispatch(toast("success", `Deleted ${arg.name}`))
  },
)

/**
 * Applies a look to the targets: adopts the new view and toasts how many ranges changed. A failure
 * re-reads the lights quietly and rejects; the caller shows the message in its dialog.
 */
export const applyLook = createAsyncThunk<ApplyResult, { id: string; look: LookRecord; targets: LookTarget[] }, Config>(
  "presets/applyLookFlow",
  async (arg, { dispatch, getState, rejectWithValue }) => {
    const strands = getState().lights.devices[arg.id]?.view?.strands ?? []
    const changed = arg.targets.reduce((n, t) => n + (t.range ? 1 : (strands.find((s) => s.key === t.strandKey)?.ranges.length ?? 0)), 0)
    const res = await dispatch(sendApplyLook(arg))
    if (sendApplyLook.rejected.match(res)) {
      void dispatch(loadLights(arg.id, { quiet: true }))
      return rejectWithValue(fail(res.payload))
    }
    dispatch(adoptView({ id: arg.id, view: res.payload.view }))
    dispatch(toast("success", `Applied ${arg.look.name}`, `Changed ${plural(changed, "range")}. ${res.payload.warnings.join(" ")}`.trim()))
    return res.payload
  },
)
