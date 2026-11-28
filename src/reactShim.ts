// Vite aliases the bare `react` specifier -> this module, so recompose's
// `import { createFactory } from "react"` binds to a REAL export. React 19
// removed createFactory; the side-effect shim in src/lib/reactCompat.ts cannot win
// against rolldown's __toESM(react) namespace snapshot in the client build, so
// we surface createFactory as a first-class export here.
export * from "__react_original"
export { default } from "__react_original"
import * as React from "__react_original"

// React 19's types dropped `createFactory` along with the runtime export, so
// the (possibly-undefined) property read below needs a narrow escape hatch —
// `unknown`, not `any`, to keep the eslint no-explicit-any rule satisfied.
type ReactModuleWithCreateFactory = {
  createFactory?: (type: unknown) => (...args: unknown[]) => unknown
  createElement: (type: unknown, ...args: unknown[]) => unknown
}
const reactModule = React as unknown as ReactModuleWithCreateFactory
export const createFactory =
  reactModule.createFactory ?? ((type: unknown) => reactModule.createElement.bind(null, type))
