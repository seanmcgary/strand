import { afterEach, expect, it, vi } from "vitest"
import { api } from "@/api/client"
import { makeStore } from "../index"
import { loadPreferences, preferencesSlice, pushRecentColor, toggleFavoriteEffect } from "./preferences"

afterEach(() => vi.restoreAllMocks())

// Fails if recent colors are not kept newest first, unique, at most 8, and saved.
it("keeps the 8 newest recent colors and saves them", async () => {
  const put = vi.spyOn(api, "putPreference").mockResolvedValue(undefined)
  vi.spyOn(api, "getPreferences").mockResolvedValue({})
  const store = makeStore({ preferences: preferencesSlice.reducer })
  await store.dispatch(loadPreferences())
  const colors = ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006", "#000007", "#000008", "#000009", "#000005"]

  for (const hex of colors) await store.dispatch(pushRecentColor(hex))

  const expected = ["#000005", "#000009", "#000008", "#000007", "#000006", "#000004", "#000003", "#000002"]
  expect(store.getState().preferences.recentColors).toEqual(expected)
  expect(put).toHaveBeenLastCalledWith("recentColors", expected)
})

// Fails if a list is saved before the stored lists load, which would overwrite them with a partial one.
it.each([
  ["pushRecentColor", pushRecentColor("#000001")],
  ["toggleFavoriteEffect", toggleFavoriteEffect("Solid")],
] as const)("%s does not save before the preferences load", async (_, thunk) => {
  const put = vi.spyOn(api, "putPreference").mockResolvedValue(undefined)
  const store = makeStore({ preferences: preferencesSlice.reducer })

  await store.dispatch(thunk)

  expect(put).not.toHaveBeenCalled()
})
