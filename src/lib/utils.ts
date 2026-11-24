import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
