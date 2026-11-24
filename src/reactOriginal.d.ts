// `__react_original` only exists as a Vite resolve.alias (see vite.config.ts) that
// points back at the real `react` package, letting reactShim.ts import React
// without the `react` alias re-matching itself. TypeScript has no such alias, so
// this ambient module tells it `__react_original` has the same shape as `react`.
// NOTE: this file is deliberately NOT named `reactShim.d.ts` — TS treats a
// `<name>.d.ts` next to `<name>.ts` as that module's own declaration file and
// silently drops it from the program (no ambient module, no TS2307 fix).
declare module "__react_original" {
  export * from "react"
  import React from "react"
  export default React
}
