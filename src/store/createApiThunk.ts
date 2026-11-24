import { createAsyncThunk } from "@reduxjs/toolkit"

/** Normalized error shape every rejected API thunk carries in `action.payload`. */
export interface ApiError {
  status?: number
  code?: string | number
  message: string
}

/** Standard `{loading, error}` pair tracked per async operation in a slice. */
export interface RequestState {
  loading: boolean
  error: ApiError | null
  /**
   * When this operation last SUCCEEDED, as an epoch millisecond value, or
   * `null`/absent when it has never succeeded in this store. Stamped from the
   * fulfilled action's `meta.fetchedAt` (see `ApiThunkFulfilledMeta`) so a
   * screen can state how old the data on it is.
   *
   * OPTIONAL ON PURPOSE. A required field would fail the type check in every
   * consuming slice/test for no gain: a slice that does not track freshness
   * simply leaves it absent.
   */
  fetchedAt?: number | null
}

export const initialRequestState: RequestState = { loading: false, error: null }

/**
 * The initial state for a RequestState whose data is FETCHED ON MOUNT — starts
 * `loading: true` so a screen shows its loading state until the first fetch
 * resolves, instead of flashing an "empty"/"no data" state on the pre-fetch
 * render (before the thunk's `pending` fires in `componentDidMount`). Use this
 * for a slice's primary screen-data load field; keep `initialRequestState` for
 * user-action ops (create/update/delete/save) that legitimately start idle.
 */
export const loadingRequestState: RequestState = { loading: true, error: null }

/** Shape of an error body thrown by an API call: `{code?, message?}`. */
interface GrpcGatewayErrorBody {
  code?: string | number
  message?: string
  status?: number
}

function isGrpcGatewayErrorBody(e: unknown): e is GrpcGatewayErrorBody {
  return typeof e === "object" && e !== null && ("message" in e || "code" in e)
}

/**
 * Normalizes whatever an API call throws into an `ApiError`: a parsed JSON
 * error body (`{code?, message?}`), or a real `TypeError` on network failure.
 */
export function toApiError(e: unknown): ApiError {
  if (e instanceof TypeError) {
    return { message: "Network error" }
  }
  if (isGrpcGatewayErrorBody(e)) {
    return {
      status: e.status,
      code: e.code,
      message: e.message ?? "Request failed",
    }
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
 * into its `RequestState.fetchedAt`; every other slice ignores it.
 */
export function createApiThunk<Arg, Res>(typePrefix: string, call: (arg: Arg) => Promise<Res>) {
  return createAsyncThunk<Res, Arg, { fulfilledMeta: ApiThunkFulfilledMeta }>(
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
