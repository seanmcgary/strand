# Conventions

Strand is one Node package with two runtimes:

- the SPA in `src/`: React 19, Vite, TypeScript, Tailwind v4, shadcn/ui, Redux Toolkit and recompose. The browser renders every page. There is no server-side rendering.
- the server in `server/`: Fastify 5. It serves the built SPA and is the whole backend (`/api`).

`shared/apiTypes.ts` holds the API types that both runtimes import.

## 1. The dev loop

```bash
pnpm install
pnpm dev:build          # tab 1: vite build --watch (client) and the server build in watch mode
pnpm dev                # tab 2: runs dist-server/server.js and restarts it on each rebuild
pnpm build              # client → dist/ (types are stripped, not checked)
pnpm build:server       # server → dist-server/server.js
pnpm start              # node dist-server/server.js
pnpm test               # vitest: server tests and plain src/ tests, in Node
pnpm test server/app.test.ts   # one file
pnpm lint               # eslint .
pnpm exec tsc --noEmit  # the type gate
pnpm storybook          # Storybook on :6006
```

The gate before every commit: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`.

## 2. No `NODE_ENV`

There is no `NODE_ENV` branch anywhere, and none should be added. The dev loop runs the same built `dist/` and `dist-server/` that production runs, so no dev-only code path can disagree with production. Behavior that tests must change comes from `server/config.ts` (environment variables) or from the dependencies passed to `buildApp`.

## 3. State management: Redux and recompose, no React hooks

- App state lives in Redux. Components are composed with recompose HOCs.
- The only file that may call a React hook is `src/lib/withRouter.tsx`. It turns the router hooks into `location`, `navigate`, `params` and `navigationType` props. Every other component gets them through `withRouter`. ESLint enforces this (`no-restricted-syntax` in `eslint.config.js`, for both `useX()` and `React.useX()`).
- Top-level screens are render functions enhanced with `compose(connect(selectPageState), withActions(mapDispatch), withState(...), withHandlers(...), lifecycle(...))`. All behavior lives in `withHandlers` and `lifecycle`. Only top-level screens `connect()` to the store; children get everything through props.
- Local UI state (form fields, open/closed) uses recompose `withState`/`withHandlers`, not `useState`.
- `makeStore(reducers)` (`src/store/index.ts`) is a factory, never a module-level singleton. One slice per domain. A slice's `initialState` is static: no reads of `window`, `localStorage` or `import.meta` at module scope.
- `withActions` and the `reactCompat` shim live in `src/lib/`. `reactCompat` restores `React.createFactory`, which recompose needs under React 19; import it before any module that evaluates a recompose chain. `cn()` lives in `src/lib/utils.ts`.

## 4. API client

`src/api/client.ts` is hand-written. It has one function per function of the design's mock `api` object (`docs/design/strand-wled-spec.html`), with the same names. Thunks call it through `createApiThunk` (`src/store/createApiThunk.ts`), never with their own `fetch`. `shared/apiTypes.ts` is the one source of the API types. The browser calls only the app server, with root-relative URLs, never a WLED device.

## 5. Server

- `server/app.ts` `buildApp(deps)` builds the app from its dependencies (config, database, mDNS, clock), so tests replace each one.
- Routes are Fastify plugins in `server/routes/`, each `export async function <name>Routes(app, deps)`, registered in `buildApp`.
- A route throws `ApiError` (`server/errors.ts`) for an expected failure. The error handler turns it into `{ error, message }`.
- Requests to devices go through `server/wled/deviceClient.ts` only.
- `server/requestGuard.ts` guards `/api`: the Host allow-list (`ALLOWED_HOSTS`) and the `X-Strand-Request: 1` header on writes.
- Never log a request body or a PIN. The request log serializer logs the method and the path only.
- The server keeps no device state, connection or queue in memory between requests.

## 6. Migrations

`server/db/migrations.ts` is an ordered, append-only list. Never edit or reorder an entry that is committed. A change is a new entry.

## 7. UI components

- `src/components/ui/` holds shadcn/ui primitives ("new-york" style, lucide icons, CSS variables; config in `components.json`). Add new primitives with the shadcn CLI rather than by hand.
- The design tokens (the shadcn color variables plus `success`, `warning`, `warning-muted`, `danger` and `glow`) are in `src/index.css`, copied from `docs/design/strand-wled-spec.html`.
- Storybook first: every component ships a colocated `*.stories.tsx`. When you add or change a component, add or update its story. `.storybook/preview.ts` wraps every story in one `MemoryRouter`; a story sets `parameters.routerEntries` instead of adding its own router.

## 8. File naming: camelCase

- Every file name is camelCase, including files whose default export is a PascalCase component (`button.tsx` exports `Button`, `homeScreen.tsx` exports `HomeScreen`) and test fixtures. Only the file name is camelCase; identifiers keep normal casing.
- Import paths match the on-disk casing.
- Exceptions are the names a tool requires: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `Dockerfile`, `compose.yaml`, `.gitignore`, `.dockerignore`, and the Markdown docs (`CLAUDE.md`, `CONVENTIONS.md`).

## 9. Commits: Conventional Commits

Commit messages are `type(scope): subject`. `type` is one of `feat|fix|docs|chore|refactor|test|build|ci|perf|style|revert`, `scope` is lowercase (for example `server`, `web`, `repo`), and the subject is lowercase-initial, imperative, with no trailing period. No co-author or attribution trailers. Stage files by path.

## 10. Tests, the type gate, one source of truth

- Tests live next to the file they cover, as `<file>.test.ts`. Shared test helpers live in `test/`.
- Test at the outermost surface that exercises a behavior: one behavior, one test. Each test has a one-line comment that names the production change that makes it fail.
- TypeScript is the type gate (`pnpm exec tsc --noEmit`). Vite and vitest strip types without checking them, so a green build or test run says nothing about types.
- One source of truth per concern. Derive lists from one authoritative list instead of keeping mirror copies that can drift.
- Prefer pure functions and explicit data flow over hidden global state.

## 11. Formatting: chained calls

A chained call aligns `.method()` with the start of the line above, not indented:

```ts
Promise.resolve()
.then(() => 'stuff')
```
