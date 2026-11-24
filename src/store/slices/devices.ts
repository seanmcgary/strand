import { createSlice } from "@reduxjs/toolkit"
import type { Device } from "../../../shared/apiTypes"
import { api } from "@/api/client"
import { createApiThunk, type ThunkError } from "../createApiThunk"

export interface DevicesState {
  list: Device[]
  status: "idle" | "loading" | "ok" | "error"
  error: ThunkError | null
}

const initialState: DevicesState = { list: [], status: "idle", error: null }

export const fetchDevices = createApiThunk<void, Device[]>("devices/fetch", () => api.listDevices())

export const devicesSlice = createSlice({
  name: "devices",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
    .addCase(fetchDevices.pending, (state) => {
      state.status = "loading"
      state.error = null
    })
    .addCase(fetchDevices.fulfilled, (state, action) => {
      state.list = action.payload
      state.status = "ok"
      state.error = null
    })
    .addCase(fetchDevices.rejected, (state, action) => {
      state.status = "error"
      state.error = action.payload ?? null
    })
  },
})
