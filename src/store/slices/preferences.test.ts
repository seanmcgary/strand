import { afterEach, expect, it, vi } from "vitest"
import { api } from "@/api/client"
import { makeStore } from "../index"
import { preferencesSlice, pushRecentColor } from "./preferences"

afterEach(() => vi.restoreAllMocks())

// Fails if recent colors are not kept newest first, unique, at most 8, and saved.
it("keeps the 8 newest recent colors and saves them", async () => {
  const put = vi.spyOn(api, "putPreference").mockResolvedValue(undefined)
  const store = makeStore({ preferences: preferencesSlice.reducer })
  const colors = ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006", "#000007", "#000008", "#000009", "#000005"]

  for (const hex of colors) await store.dispatch(pushRecentColor(hex))

  const expected = ["#000005", "#000009", "#000008", "#000007", "#000006", "#000004", "#000003", "#000002"]
  expect(store.getState().preferences.recentColors).toEqual(expected)
  expect(put).toHaveBeenLastCalledWith("recentColors", expected)
})
