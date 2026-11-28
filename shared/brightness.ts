/** A WLED brightness (0-255) as the percent the UI shows: at least 1, so a lit strand never reads "0%" (the design's `briToPct`). */
export const briToPct = (bri: number): number => Math.max(1, Math.round((bri / 255) * 100));
