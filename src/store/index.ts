import { configureStore, type ReducersMapObject } from "@reduxjs/toolkit"
import { devicePageSlice } from "./slices/devicePage"
import { devicesSlice } from "./slices/devices"
import { lightsSlice } from "./slices/lights"
import { preferencesSlice } from "./slices/preferences"
import { presetsSlice } from "./slices/presets"
import { toastsSlice } from "./slices/toasts"

/**
 * Store factory. The client builds exactly one store at bootstrap and each
 * test builds its own. Never a module-level singleton.
 */
export function makeStore<S>(reducers: ReducersMapObject<S>) {
  return configureStore({ reducer: reducers })
}

/** The slices the app runs with, one per domain. */
export const reducers = {
  devicePage: devicePageSlice.reducer,
  devices: devicesSlice.reducer,
  lights: lightsSlice.reducer,
  preferences: preferencesSlice.reducer,
  presets: presetsSlice.reducer,
  toasts: toastsSlice.reducer,
}

export type RootState = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> }
export type AppStore = ReturnType<typeof makeStore<RootState>>
export type AppDispatch = AppStore["dispatch"]
