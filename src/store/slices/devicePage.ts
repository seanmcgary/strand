import { createSlice, type PayloadAction, type ThunkDispatch, type UnknownAction } from "@reduxjs/toolkit"
import type { WledInfo } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { createApiThunk } from "../createApiThunk"
import { fetchDevices, type DevicesState } from "./devices"
import { adoptView, type LightsState } from "./lights"
import { toast, type ToastsState } from "./toasts"

export interface DevicePower {
  on: boolean
  bri: number
}

export interface DevicePageEntry {
  /** The device's master power and brightness. Null until the device answers with both. */
  state: DevicePower | null
  info: WledInfo | null
  /** The settings that take effect after a reboot. */
  pending: string[]
  /** A reboot was sent and the device has not answered since. */
  rebooting: boolean
}

export interface DevicePageState {
  byId: Record<string, DevicePageEntry>
}

const EMPTY: DevicePageEntry = { state: null, info: null, pending: [], rebooting: false }
const initialState: DevicePageState = { byId: {} }

const REBOOT_FIRST_POLL_MS = 1500
const REBOOT_POLL_MS = 2000
/** An answer this long after the reboot counts as back, even if no poll saw the device down. */
const REBOOT_SETTLE_MS = 3000
const REBOOT_GIVE_UP_MS = 60000

function entry(state: DevicePageState, id: string): DevicePageEntry {
  return (state.byId[id] ??= structuredClone(EMPTY))
}

/** The `on` and `bri` of a WLED state reply, or null when either is missing. */
function power(raw: unknown): DevicePower | null {
  if (typeof raw !== "object" || raw === null) return null
  const { on, bri } = raw as { on?: unknown; bri?: unknown }
  return typeof on === "boolean" && typeof bri === "number" ? { on, bri } : null
}

export const loadDeviceState = createApiThunk("devicePage/loadState", (id: string) => api.getState(id))
export const loadInfo = createApiThunk("devicePage/loadInfo", (id: string) => api.getInfo(id))
export const loadPending = createApiThunk("devicePage/loadPending", (id: string) => api.getPendingReboot(id))
const sendPower = createApiThunk("devicePage/patchState", ({ id, on }: { id: string; on: boolean }) => api.patchState(id, { on }))
const sendReboot = createApiThunk("devicePage/reboot", (id: string) => api.reboot(id))

export const devicePageSlice = createSlice({
  name: "devicePage",
  initialState,
  reducers: {
    powerSet(state, action: PayloadAction<{ id: string; state: DevicePower | null }>) {
      entry(state, action.payload.id).state = action.payload.state
    },
    rebootEnded(state, action: PayloadAction<string>) {
      entry(state, action.payload).rebooting = false
    },
  },
  extraReducers: (builder) => {
    builder
    .addCase(loadDeviceState.fulfilled, (state, action) => {
      entry(state, action.meta.arg).state = power(action.payload)
    })
    .addCase(sendPower.fulfilled, (state, action) => {
      const next = power(action.payload)
      if (next) entry(state, action.meta.arg.id).state = next
    })
    .addCase(loadInfo.fulfilled, (state, action) => {
      entry(state, action.meta.arg).info = action.payload
    })
    .addCase(loadPending.fulfilled, (state, action) => {
      entry(state, action.meta.arg).pending = action.payload.filter((x): x is string => typeof x === "string")
    })
    .addCase(sendReboot.fulfilled, (state, action) => {
      entry(state, action.meta.arg).rebooting = true
    })
  },
})

const { powerSet, rebootEnded } = devicePageSlice.actions

export const selectDevicePage = (state: { devicePage: DevicePageState }, id: string): DevicePageEntry => state.devicePage.byId[id] ?? EMPTY

type PageRoot = { devicePage: DevicePageState; devices: DevicesState; lights: LightsState; toasts: ToastsState }
type PageDispatch = ThunkDispatch<PageRoot, unknown, UnknownAction>
type Thunk<R> = (dispatch: PageDispatch, getState: () => PageRoot) => R

const nameOf = (state: PageRoot, id: string) => state.devices.list.find((d) => d.id === id)?.name ?? "The device"

/** Turns the device on or off at once; on an error, restores the switch and the lights view and toasts. */
export const setPower =
  ({ id, on }: { id: string; on: boolean }): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const prev = getState().devicePage.byId[id]?.state ?? null
    const before = getState().lights.devices[id]?.view
    if (prev) dispatch(powerSet({ id, state: { ...prev, on } }))
    if (before) dispatch(adoptView({ id, view: { ...before, on } }))
    const res = await dispatch(sendPower({ id, on }))
    if (!sendPower.rejected.match(res)) return
    dispatch(powerSet({ id, state: prev }))
    const now = getState().lights.devices[id]?.view
    if (before && now) dispatch(adoptView({ id, view: { ...now, on: before.on, bri: before.bri } }))
    dispatch(toast("error", "Couldn't change the lights", res.payload?.message ?? ""))
  }

/** Reboots the device, then polls its info until it answers again (at most a minute). */
export const rebootNow =
  (id: string): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const name = nameOf(getState(), id)
    const res = await dispatch(sendReboot(id))
    if (sendReboot.rejected.match(res)) {
      dispatch(toast("error", `Couldn't reboot ${name}`, res.payload?.message ?? ""))
      return
    }
    const started = Date.now()
    let seenDown = false
    await new Promise<void>((resolve) => {
      const poll = async () => {
        const r = await dispatch(loadInfo(id))
        if (loadInfo.fulfilled.match(r)) {
          if (seenDown || Date.now() - started > REBOOT_SETTLE_MS) {
            dispatch(rebootEnded(id))
            dispatch(toast("success", `${name} is back online`))
            void dispatch(fetchDevices())
            return resolve()
          }
        } else {
          seenDown = true
          if (Date.now() - started > REBOOT_GIVE_UP_MS) {
            dispatch(rebootEnded(id))
            dispatch(toast("error", `${name} hasn't come back after rebooting`, "Give it another minute, then check its power supply."))
            return resolve()
          }
        }
        setTimeout(poll, REBOOT_POLL_MS)
      }
      setTimeout(poll, REBOOT_FIRST_POLL_MS)
    })
  }

/** Asks an offline device for its info, toasts the outcome, and re-reads the device list. */
export const retryDevice =
  (id: string): Thunk<Promise<void>> =>
  async (dispatch, getState) => {
    const name = nameOf(getState(), id)
    const r = await dispatch(loadInfo(id))
    if (loadInfo.fulfilled.match(r)) dispatch(toast("success", `${name} is back online`))
    else dispatch(toast("error", `${name} still isn't responding`, "Check that it has power and is in range of your Wi-Fi."))
    await dispatch(fetchDevices())
  }
