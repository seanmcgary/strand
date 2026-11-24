import { createAsyncThunk } from "@reduxjs/toolkit"
import type { ErrorCode } from "../../shared/apiTypes"
import { ApiError } from "@/api/client"

/** Normalized error shape every rejected API thunk carries in `action.payload`. */
export interface ThunkError {
  status?: number
  code?: ErrorCode
  message: string
}

/**
 * Normalizes whatever an API call throws into a `ThunkError`: an `ApiError`
 * from the client, or a real `TypeError` on network failure.
 */
export function toApiError(e: unknown): ThunkError {
  if (e instanceof ApiError) {
    return { status: e.status, code: e.code, message: e.message }
  }
  if (e instanceof TypeError) {
    return { message: "Network error" }
  }
  return { message: String(e) }
}

/** The extra meta every `createApiThunk` thunk attaches to its fulfilled action. */
export interface ApiThunkFulfilledMeta {
  fetchedAt: number
}

/**
 * Wraps an API client call as an async thunk that rejects with a mapped
 * `ApiError` instead of the raw thrown value. `call` must invoke a function of
 * the API client (`src/api/client.ts`), never a hand-rolled HTTP request.
 *
 * The fulfilled action also carries `meta.fetchedAt`, the wall-clock time the
 * call succeeded. It is read HERE and not inside a reducer: a reducer must be
 * a pure function of its arguments, and `Date.now()` inside one breaks replay
 * and time-travel debugging. A slice that wants freshness copies the value
 * into its own state; every other slice ignores it.
 */
export function createApiThunk<Arg, Res>(typePrefix: string, call: (arg: Arg) => Promise<Res>) {
  return createAsyncThunk<Res, Arg, { fulfilledMeta: ApiThunkFulfilledMeta; rejectValue: ThunkError }>(
    typePrefix,
    async (arg, { fulfillWithValue, rejectWithValue }) => {
      try {
        return fulfillWithValue(await call(arg), { fetchedAt: Date.now() })
      } catch (e) {
        return rejectWithValue(toApiError(e))
      }
    },
  )
}
