import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

export type ToastKind = "success" | "error" | "info"

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  desc: string
}

export interface ToastsState {
  items: ToastItem[]
  /** The id the next toast gets. Ids never repeat, so a stale timer can't remove a newer toast. */
  nextId: number
}

const MAX_TOASTS = 3
const TOAST_MS = 4200

export const toastsSlice = createSlice({
  name: "toasts",
  initialState: { items: [], nextId: 1 } as ToastsState,
  reducers: {
    added(state, action: PayloadAction<Omit<ToastItem, "id">>) {
      state.items = [...state.items, { ...action.payload, id: state.nextId }].slice(-MAX_TOASTS)
      state.nextId += 1
    },
    removed(state, action: PayloadAction<number>) {
      state.items = state.items.filter((t) => t.id !== action.payload)
    },
  },
})

type ToastsDispatch = (action: ReturnType<typeof toastsSlice.actions.added | typeof toastsSlice.actions.removed>) => unknown

/** Shows a toast and removes it after 4200 ms. */
export const toast =
  (kind: ToastKind, title: string, desc = "") =>
  (dispatch: ToastsDispatch, getState: () => { toasts: ToastsState }) => {
    const id = getState().toasts.nextId
    dispatch(toastsSlice.actions.added({ kind, title, desc }))
    setTimeout(() => dispatch(toastsSlice.actions.removed(id)), TOAST_MS)
  }
