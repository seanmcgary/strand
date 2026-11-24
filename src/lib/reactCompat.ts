import React from "react"

/**
 * React 19 removed `React.createFactory`; recompose (unmaintained) still calls
 * it internally in nearly every HOC (`withState`, `withHandlers`, `lifecycle`,
 * `compose`, …). This side-effect module restores it so the recompose HOC
 * chains the app's state architecture is built on work under React 19.
 *
 * Must be imported for its side effect BEFORE any module that evaluates a
 * recompose chain (see the client's entry files and Storybook preview).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R = React as any
if (typeof R.createFactory !== "function") {
  R.createFactory = (type: Parameters<typeof React.createElement>[0]) =>
    React.createElement.bind(null, type)
}

export {}
