import { createSlice } from "@reduxjs/toolkit"
import type { Device } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { createApiThunk } from "../createApiThunk"

export interface DevicesState {
  list: Device[]
  status: "idle" | "loading" | "ok" | "error"
}

const initialState: DevicesState = { list: [], status: "idle" }

export const fetchDevices = createApiThunk<void, Device[]>("devices/fetch", () => api.listDevices())

export const devicesSlice = createSlice({
  name: "devices",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
    .addCase(fetchDevices.pending, (state) => {
      state.status = "loading"
    })
    .addCase(fetchDevices.fulfilled, (state, action) => {
      state.list = action.payload
      state.status = "ok"
    })
    .addCase(fetchDevices.rejected, (state) => {
      state.status = "error"
    })
  },
})
