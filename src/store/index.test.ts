import { describe, expect, it } from "vitest"
import { makeStore } from "./index"

describe("makeStore", () => {
  // Fails if makeStore ignores the reducer map it is given.
  it("builds a store from the given reducers", () => {
    expect(makeStore({ app: (s = {}) => s }).getState()).toEqual({ app: {} })
  })
})
