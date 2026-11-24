import { afterEach, expect, it, vi } from "vitest"
import type { Device, LightsView, WledInfo } from "../../../shared/apiTypes"
import { api, ApiError } from "@/api/client"
import { makeStore } from "../index"
import { devicesSlice, fetchDevices } from "./devices"
import { devicePageSlice, rebootNow, setPower } from "./devicePage"
import { lightsSlice, loadLights } from "./lights"
import { toastsSlice } from "./toasts"

const view: LightsView = { on: true, bri: 128, strands: [], segments: { used: 0, max: 16 }, notices: [], matrix: false }
const device = { id: "d1", name: "Backyard", online: true } as Device

async function setup() {
  const store = makeStore({
    devicePage: devicePageSlice.reducer,
    devices: devicesSlice.reducer,
    lights: lightsSlice.reducer,
    toasts: toastsSlice.reducer,
  })
  vi.spyOn(api, "listDevices").mockResolvedValue([device])
  vi.spyOn(api, "getLights").mockResolvedValueOnce(view)
  await store.dispatch(fetchDevices())
  await store.dispatch(loadLights("d1"))
  const titles = () => store.getState().toasts.items.map((t) => t.title)
  return { store, titles }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// Fails if setPower does not set the lights view's power at once and restore it when the write fails.
it("sets the lights view's power optimistically and restores it on an error", async () => {
  const { store } = await setup()
  let fail!: (e: unknown) => void
  vi.spyOn(api, "patchState").mockReturnValueOnce(new Promise((_, rej) => (fail = rej)))
  const done = store.dispatch(setPower({ id: "d1", on: false }))
  expect(store.getState().lights.devices.d1!.view!.on).toBe(false)
  fail(new ApiError(504, "device_offline", "m"))
  await done
  expect(store.getState().lights.devices.d1!.view!.on).toBe(true)
})

// Fails if rebootNow does not mark the device rebooting until it answers again, then toast that it is back.
it("marks the device rebooting until it answers again", async () => {
  const { store, titles } = await setup()
  vi.useFakeTimers()
  vi.spyOn(api, "reboot").mockResolvedValueOnce(undefined)
  vi.spyOn(api, "getInfo")
  .mockRejectedValueOnce(new TypeError("down"))
  .mockResolvedValue({ name: "Backyard", live: false } as WledInfo)
  const done = store.dispatch(rebootNow("d1"))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getState().devicePage.byId.d1!.rebooting).toBe(true)
  await vi.advanceTimersByTimeAsync(1500)
  expect(store.getState().devicePage.byId.d1!.rebooting).toBe(true)
  await vi.advanceTimersByTimeAsync(2000)
  await done
  expect(store.getState().devicePage.byId.d1!.rebooting).toBe(false)
  expect(titles()).toContain("Backyard is back online")
})
