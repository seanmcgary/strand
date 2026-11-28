import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Device } from "../../shared/apiTypes"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Shared focus-visible ring for directly-focusable interactive primitives
 * (input, select, toggle). Keep every primitive's ring identical so focus
 * states read as one consistent system across the app.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"

/**
 * Same ring tokens as FOCUS_RING, applied via the `:has()` variant to a
 * wrapper element when a visually-hidden focusable descendant (e.g. a
 * sr-only radio input) has focus-visible — used by RadioCard, which can't
 * put the ring on the hidden input itself.
 */
export const FOCUS_RING_WITHIN =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-white"

/** "just now", "5 min ago", "3 h ago" or "2 d ago" (the design's `relativeTime`, with no-break spaces). */
export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1e3
  if (diff < 45) return "just now"
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}\u00A0min\u00A0ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}\u00A0h\u00A0ago`
  return `${Math.round(diff / 86400)}\u00A0d\u00A0ago`
}

/** The device's stock WLED settings page, with its port unless it is 80. */
export function wledSettingsUrl(d: Device): string {
  return `http://${d.host}${d.port === 80 ? "" : `:${d.port}`}/settings`
}
