import type { Device, LightsView, RangeView, SlotView, StrandView } from "../shared/apiTypes"
import type { DeviceLights } from "../src/store/slices/lights"

/** Lights tab fixtures for component tests and stories. */

export const device: Device = {
  id: "d1",
  name: "Backyard",
  host: "wled-backyard.local",
  lastIp: "192.168.1.40",
  mac: "aabbccddeeff",
  online: true,
  lastSeen: "2026-11-24T10:00:00.000Z",
  pinLocked: false,
}

export const slot = (rgb: number[], over: Partial<SlotView> = {}): SlotView => ({
  col: [rgb, [0, 0, 0], [0, 0, 0]],
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  c1: 0,
  c2: 0,
  c3: 16,
  o1: false,
  o2: false,
  o3: false,
  pal: 0,
  palName: "Default",
  on: true,
  ...over,
})

export const allRange = (name: string, start: number, len: number, rgb = [255, 180, 107]): RangeView => ({
  name,
  start,
  len,
  pattern: { kind: "all" },
  slots: [slot(rgb)],
})

export const strand = (key: string, name: string, len: number, ranges: RangeView[], over: Partial<StrandView> = {}): StrandView => ({
  key,
  name,
  pins: [2],
  start: 0,
  len,
  on: true,
  bri: 128,
  ranges,
  normalize: false,
  ...over,
})

export const view = (strands: StrandView[], over: Partial<LightsView> = {}): LightsView => ({
  on: true,
  bri: 128,
  strands,
  segments: { used: 4, max: 32 },
  notices: [],
  matrix: false,
  ...over,
})

export const lights = (v: LightsView | null, over: Partial<DeviceLights> = {}): DeviceLights => ({
  view: v,
  status: v ? "ok" : "loading",
  error: null,
  effects: [],
  palettes: [],
  fxStatus: "ok",
  fxError: null,
  outputs: null,
  outputsStatus: "idle",
  outputsError: null,
  selected: null,
  selRange: {},
  flash: null,
  ...over,
})
