import { connect } from "react-redux"
import type { AppDispatch } from "../store"

/**
 * Shape of the map passed to `withActions` — one action/thunk creator per key.
 * The `never[]` rest param is a deliberate trick to accept a creator with any
 * concrete parameter list; the return type is intentionally `unknown` here —
 * see `Dispatched<AC>` for why it can't be pinned down to a single static
 * "dispatchable action" type (RTK's `AppDispatch` is a generic, overloaded
 * function and utility types like `Parameters<AppDispatch>` collapse it to
 * its plain-action overload, discarding the thunk overload entirely).
 */
type ActionCreatorMap = Record<string, (...args: never[]) => unknown>

/**
 * What `dispatch(actionCreator(...args))` actually returns at runtime.
 * Plain action creators (`createSlice` reducers) return the action object
 * itself, and dispatching it returns that same object. Thunk/async-thunk
 * creators (`createAsyncThunk`) return a *thunk function* — the redux-thunk
 * middleware invokes it and dispatch returns whatever THAT call returns
 * (for `createAsyncThunk` this is a `Promise` augmented with `.unwrap()`).
 * Modeling that distinction here (instead of extracting a static parameter
 * type off `AppDispatch`) is what lets a bound action keep its `.unwrap()`
 * typing.
 */
type Dispatched<AC extends (...args: never[]) => unknown> = ReturnType<AC> extends (
  ...args: never[]
) => infer R
  ? R
  : ReturnType<AC>

type BoundActions<T extends ActionCreatorMap> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => Dispatched<T[K]>
}

/**
 * Binds a map of action/thunk creators to `dispatch`, returning a `connect(...)`
 * HOC that injects the bound versions as props.
 */
export function withActions<T extends ActionCreatorMap>(actions: T) {
  return connect(null, (dispatch: AppDispatch) => {
    const bound = {} as BoundActions<T>
    for (const key of Object.keys(actions) as Array<keyof T>) {
      // `key` comes from `Object.keys(actions)`, so it is always a present key.
      const actionCreator = actions[key]!
      bound[key] = ((...args: Parameters<typeof actionCreator>) =>
        // `actionCreator`'s return type is erased to `unknown` by the `keyof T`
        // loop (TS can't narrow it per-iteration); `dispatch` itself stays
        // real and correctly typed, so the outer cast below is what actually
        // guarantees callers see the right `Dispatched<T[K]>` shape.
        dispatch(actionCreator(...args) as never)) as BoundActions<T>[typeof key]
    }
    return bound
  })
}
