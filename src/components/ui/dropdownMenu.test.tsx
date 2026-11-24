// @vitest-environment jsdom
import "@/lib/reactCompat"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdownMenu"

beforeAll(() => {
  // jsdom has no ResizeObserver, which Radix's popper needs to open the menu.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(cleanup)

// Fails until DropdownMenuItem takes a `reason` prop that links a description and skips onSelect.
it("a menu item with a reason is described by the reason and does not select", () => {
  const onSelect = vi.fn()
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem reason="x" onSelect={onSelect}>Merge</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  )
  const item = screen.getByRole("menuitem")
  const describedBy = item.getAttribute("aria-describedby")
  expect(describedBy && document.getElementById(describedBy)?.textContent).toBe("x")
  fireEvent.click(item)
  expect(onSelect).not.toHaveBeenCalled()
})
