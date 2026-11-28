import { render } from "@testing-library/react"
import { vi } from "vitest"
import type { LightsView } from "../shared/apiTypes"
import { LightsTab, type LightsActions } from "../src/components/lights/lightsTab"
import { device, lights } from "./lightsView"

const prefs = { recentColors: [], favoriteEffects: [], loaded: true }

/** Renders the Lights tab for `v` with every action a spy, and returns the actions. */
export function renderTab(v: LightsView): LightsActions {
  const actions: LightsActions = {
    editStrand: vi.fn(() => true),
    selectStrand: vi.fn(),
    selectRange: vi.fn(),
    resolveShared: vi.fn(),
    loadLights: vi.fn(),
    toast: vi.fn(),
    flashLed: vi.fn(),
    setStrandGroups: vi.fn(() => ({ unwrap: () => Promise.resolve() })),
    setStrandName: vi.fn(() => ({ unwrap: () => Promise.resolve() })),
    loadOutputs: vi.fn(),
    loadFxLists: vi.fn(),
    pushRecentColor: vi.fn(),
    toggleFavoriteEffect: vi.fn(),
    beginPaint: vi.fn(),
    paintCells: vi.fn(),
    endPaint: vi.fn(),
  }
  render(<LightsTab device={device} offline={false} lights={lights(v)} strand={v.strands[0] ?? null} prefs={prefs} actions={actions} />)
  return actions
}

/** jsdom has no ResizeObserver, which Radix's popper needs to open a menu. */
export function stubResizeObserver() {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
