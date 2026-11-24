import { describe, expect, it } from "vitest"
import { configureStore } from "@reduxjs/toolkit"
import { createApiThunk } from "./createApiThunk"

function probeStore() {
  return configureStore({ reducer: { probe: (state: Record<string, never> = {}) => state } })
}

describe("createApiThunk", () => {
  // Fails if the fulfilled action loses meta.fetchedAt.
  it("stamps fetchedAt on the fulfilled action", async () => {
    const thunk = createApiThunk<void, number>("probe/ok", async () => 7)
    const before = Date.now()
    const action = await probeStore().dispatch(thunk())
    const after = Date.now()

    expect(action.type).toBe("probe/ok/fulfilled")
    expect(action.payload).toBe(7)
    const fetchedAt = (action.meta as { fetchedAt?: number }).fetchedAt
    expect(typeof fetchedAt).toBe("number")
    expect(fetchedAt).toBeGreaterThanOrEqual(before)
    expect(fetchedAt).toBeLessThanOrEqual(after)
  })

  // Fails if a thrown error body is not mapped to an ApiError payload.
  it("still rejects with a mapped ApiError and stamps no timestamp", async () => {
    const thunk = createApiThunk<void, number>("probe/fail", async () => {
      throw { code: 13, message: "boom" }
    })
    const action = await probeStore().dispatch(thunk())

    expect(action.type).toBe("probe/fail/rejected")
    expect(action.payload).toEqual({ status: undefined, code: 13, message: "boom" })
    expect((action.meta as { fetchedAt?: number }).fetchedAt).toBeUndefined()
  })
})
