import { configureStore, type ReducersMapObject } from "@reduxjs/toolkit"

/**
 * Store factory. The client builds exactly one store at bootstrap and each
 * test builds its own. Never a module-level singleton.
 */
export function makeStore<S>(reducers: ReducersMapObject<S>) {
  return configureStore({ reducer: reducers })
}

/** The slices the app runs with, one per domain. */
export const reducers = {
  app: (state: Record<string, never> = {}) => state,
}

export type RootState = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> }
export type AppStore = ReturnType<typeof makeStore<RootState>>
export type AppDispatch = AppStore["dispatch"]
