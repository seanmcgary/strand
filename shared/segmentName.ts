/** The name tag of an Individual (painted) range's segment. */
export const PAINT_TAG = " paint";
/** The firmware's segment name limit on ESP8266 (`const.h:175-180`), the stricter one. */
export const NAME_BYTES = 32;

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
