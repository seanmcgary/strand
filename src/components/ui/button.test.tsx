// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Button } from "./button"

beforeAll(() => {
  // jsdom has no ResizeObserver, which Radix's popper needs once the tooltip opens.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(cleanup)

// Fails until Button takes a `reason` prop that sets aria-disabled, links an sr-only description and swallows the click.
it("a button with a reason is aria-disabled, described by the reason, and ignores clicks", () => {
  const onClick = vi.fn()
  render(<Button reason="x" onClick={onClick}>Go</Button>)
  const button = screen.getByRole("button", { name: "Go" })
  expect(button.getAttribute("aria-disabled")).toBe("true")
  const describedBy = button.getAttribute("aria-describedby")
  expect(describedBy && document.getElementById(describedBy)?.textContent).toBe("x")
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})
