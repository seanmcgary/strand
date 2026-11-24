import { createSlice, type PayloadAction, type ThunkDispatch, type UnknownAction } from "@reduxjs/toolkit"
import { api } from "@/api/client"
import { createApiThunk } from "../createApiThunk"

export interface PreferencesState {
  recentColors: string[]
  favoriteEffects: string[]
  loaded: boolean
}

const MAX_RECENT = 8
const RECENT_KEY = "recentColors"
const FAVORITES_KEY = "favorites.effects"

const initialState: PreferencesState = { recentColors: [], favoriteEffects: [], loaded: false }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

export const loadPreferences = createApiThunk<void, Record<string, unknown>>("preferences/load", () => api.getPreferences())

const savePreference = createApiThunk<{ key: string; value: string[] }, void>("preferences/save", ({ key, value }) =>
  api.putPreference(key, value),
)

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    recentColorsSet(state, action: PayloadAction<string[]>) {
      state.recentColors = action.payload
    },
    favoriteEffectsSet(state, action: PayloadAction<string[]>) {
      state.favoriteEffects = action.payload
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadPreferences.fulfilled, (state, action) => {
      state.recentColors = strings(action.payload[RECENT_KEY]).slice(0, MAX_RECENT)
      state.favoriteEffects = strings(action.payload[FAVORITES_KEY])
      state.loaded = true
    })
  },
})

type PrefsRoot = { preferences: PreferencesState }
type PrefsDispatch = ThunkDispatch<PrefsRoot, unknown, UnknownAction>

/** Puts `hex` first in the recent colors (unique, at most 8) and saves the list. A failed save keeps the local list; nothing is saved until the stored lists load, so they are not overwritten. */
export const pushRecentColor = (hex: string) => (dispatch: PrefsDispatch, getState: () => PrefsRoot) => {
  const next = [hex, ...getState().preferences.recentColors.filter((c) => c !== hex)].slice(0, MAX_RECENT)
  dispatch(preferencesSlice.actions.recentColorsSet(next))
  if (getState().preferences.loaded) return dispatch(savePreference({ key: RECENT_KEY, value: next }))
}

/** Adds the effect to the favorites, or removes it, and saves the list. */
export const toggleFavoriteEffect = (name: string) => (dispatch: PrefsDispatch, getState: () => PrefsRoot) => {
  const f = getState().preferences.favoriteEffects
  const next = f.includes(name) ? f.filter((x) => x !== name) : [...f, name]
  dispatch(preferencesSlice.actions.favoriteEffectsSet(next))
  if (getState().preferences.loaded) return dispatch(savePreference({ key: FAVORITES_KEY, value: next }))
}
