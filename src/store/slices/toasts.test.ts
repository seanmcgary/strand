import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { makeStore } from "../index"
import { toast, toastsSlice } from "./toasts"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// Fails until the toasts slice caps the list at 3 and the toast thunk removes each item after 4200 ms.
it("keeps at most 3 toasts and removes each after 4200 ms", () => {
  const store = makeStore({ toasts: toastsSlice.reducer })
  for (const title of ["A", "B", "C", "D"]) store.dispatch(toast("error", title))
  expect(store.getState().toasts.items.map((t) => t.title)).toEqual(["B", "C", "D"])
  vi.advanceTimersByTime(4200)
  expect(store.getState().toasts.items).toEqual([])
})
