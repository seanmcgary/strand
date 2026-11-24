import { describe, expect, it, vi } from "vitest"
import type { Device } from "../../../shared/apiTypes"
import { api, ApiError } from "@/api/client"
import { makeStore } from "../index"
import { devicesSlice, fetchDevices } from "./devices"

const device: Device = {
  id: "d1",
  name: "Porch",
  host: "porch.local",
  lastIp: "10.0.0.2",
  mac: "aa:bb",
  online: true,
  lastSeen: null,
  pinLocked: false,
}

describe("devicesSlice", () => {
  // Fails if fetchDevices does not store the fetched list or mark the slice ok.
  it("fills the list when fetchDevices is fulfilled", async () => {
    vi.spyOn(api, "listDevices").mockResolvedValue([device])
    const store = makeStore({ devices: devicesSlice.reducer })

    await store.dispatch(fetchDevices())

    expect(store.getState().devices).toEqual({ list: [device], status: "ok", error: null })
  })

  // Fails if a rejected fetchDevices drops the server's error.
  it("stores the server error when fetchDevices is rejected", async () => {
    vi.spyOn(api, "listDevices").mockRejectedValue(new ApiError(504, "device_offline", "m"))
    const store = makeStore({ devices: devicesSlice.reducer })

    await store.dispatch(fetchDevices())

    expect(store.getState().devices).toEqual({
      list: [],
      status: "error",
      error: { status: 504, code: "device_offline", message: "m" },
    })
  })
})
