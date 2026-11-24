import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  // Fails if cn stops dropping falsy class values.
  it("joins class strings and prunes falsy values", () => {
    const falsy = false
    expect(cn("a", "b", falsy && "c", undefined, null, "", "d")).toBe("a b d")
  })

  // Fails if cn stops merging conflicting Tailwind classes (tailwind-merge removed).
  it("resolves conflicting tailwind utilities (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })
})