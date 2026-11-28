/** The name tag of an Individual (painted) range's segment. */
export const PAINT_TAG = " paint";
/** The firmware's segment name limit on ESP8266 (`const.h:175-180`), the stricter one. */
export const NAME_BYTES = 32;
/** The most characters in a range or strand name. */
export const NAME_CHARS = 64;
/** The most segments an Every pattern may spread over. */
export const MAX_EVERY = 16;
/** A paint color, as the browser sends it. */
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const encoder = new TextEncoder();

/** The longest prefix of `s` that fits in `max` UTF-8 bytes, cut between code points. */
export function cutBytes(s: string, max: number): string {
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const size = encoder.encode(ch).length;
    if (bytes + size > max) break;
    out += ch;
    bytes += size;
  }
  return out;
}

/** A segment name: the base cut by bytes, on a UTF-8 boundary, so the whole tag fits in `NAME_BYTES`. */
export function segmentName(base: string, tag: "" | "paint" | { k: number; n: number }): string {
  const suffix = tag === "" ? "" : tag === "paint" ? PAINT_TAG : ` ${tag.k}/${tag.n}`;
  return cutBytes(base, NAME_BYTES - encoder.encode(suffix).length) + suffix;
}
