# App Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Strand app server: one Node package that serves the client-rendered frontend and implements the design's `/api` contract over the WLED JSON API.

**Architecture:** Copy the frontend of `~/Code/app-template` to the repository root and remove SSR, auth, SEO, analytics and the `/v1` proxy. The Fastify serving tier becomes the whole backend. `buildApp(deps)` in `server/app.ts` registers every `/api` route. Each route reads the device row from SQLite, sends one or more HTTP requests to the device, and returns the result. Nothing is kept in memory between requests.

**Tech Stack:** Node 24, TypeScript, Fastify 5, `@fastify/static`, `node:sqlite`, `bonjour-service` 1.4.4, `multicast-dns` 7.2.5, vitest, Vite, React 19, Redux Toolkit + recompose, Tailwind v4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-10-23-app-server-design.md` (approved). The API contract comes from `docs/design/strand-wled-spec.html`, block "MOCK APP SERVER" (lines 574-937). Read both before you start a task.

## Pipeline State

| Field     | Value                                                        |
|-----------|--------------------------------------------------------------|
| stage     | 2 (plan review)                                              |
| class     | large (new subsystem, new schema, new public API)            |
| profile   | backend (the frontend part is a scaffold with no screens)    |
| branch    | feat/app-server                                              |
| pr        | n/a (no git remote: commit locally, no draft PR)             |
| gate      | pending                                                      |
| round     | 0                                                            |
| decisions | 0                                                            |

### Decisions

(none yet)

## Global Constraints

Binding rules this change can touch (see `CLAUDE.md` and the template's `frontend/CONVENTIONS.md`, which Task 1 copies to `CONVENTIONS.md`):

- The browser talks only to the app server. No frontend code calls a WLED device (CLAUDE.md, "Architecture constraints").
- Do not store lighting state, effects, palettes, segments or presets in the database (CLAUDE.md).
- No in-memory device state, connection, or queue between requests (spec §3, §4 anti-goals).
- Settings writes use only `POST /json/cfg` and `POST /json/state`. No `/settings/<page>` form POSTs (spec §3).
- No `NODE_ENV` branch anywhere (CONVENTIONS.md, "the no-`NODE_ENV` rule").
- React hooks only in `src/lib/withRouter.tsx`. Enforced by `eslint.config.js`.
- camelCase file names.
- `pnpm exec tsc --noEmit` is the type gate. The Vite build does not check types.
- Chained calls: align `.method()` with the start of the line above (user's global rule).
- Conventional Commits. No co-author or attribution trailers.
- No third-party network calls from the server or the browser (spec §4 anti-goals). The Google Fonts link in the design file is not copied. Use the `@fontsource-variable/geist` packages that the template already has.

## Verified external API (do not re-derive)

Facts pinned from source on 2026-10-23. WLED source: `~/Code/WLED` at `nightly-522-g3cdb5108` (17.0.0-dev) and tags `v0.15.0`, `v0.15.5`. There is no `v0.16.*` tag. "0.16" in the spec means the current nightly line. Fixtures cover 0.15 and 17.0.0-dev.

**`GET /settings/s.js?p=2`** (`wled00/xml.cpp:336-355`, `wled00/wled_server.cpp:537-539` in v0.15.0). The body is `function GetV(){var d=document;...}`. It contains:
- `d.ledTypes=[{i:22,c:1,t:"D",n:"WS281x"},...];`. The keys are NOT quoted. The values are numbers and double-quoted strings (`bus_manager.cpp:1346-1355`). Quote the keys (`/([{,])([a-z]+):/g` → `$1"$2":`), then `JSON.parse`. `c` bits: 0x01 RGB, 0x02 white, 0x04 CCT, 0x10 16-bit, 0x20 must refresh.
- `bLimits(...)` with integer arguments. The count tells the version:
  - 8 arguments (v0.15.x): `maxBusses, minVirtualBusses, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxAnalogChannels`.
  - 10 arguments (17.0.0-dev): `platformId, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxRmtChannels, maxI2sChannels, maxAnalogChannels, maxButtons`.
  - Any other count: unsupported firmware.
- `d.rsvd=[6,7,8];` and `d.ro_gpio=[34,35];`. Either list can be empty (`[]`). With Ethernet compiled in, `d.rsvd` can end in a trailing comma (`[6,7,8,]`) (`xml.cpp:136-153`). Drop empty items.
- Map to the design's `Capabilities.limits`: `maxLedsPerOutput` = maxLedsPerBus, `ledMemoryBytes` = maxLedMemory, `maxLeds` = maxLeds, `maxDigitalOutputs` = maxDigitalChannels, `maxPwmPins` = maxAnalogChannels.

**Lock check:** `GET /settings/s.js?p=3`. Page 3 (UI) prints only `DS` and `SU` (`xml.cpp:472-476`), so it is the smallest PIN-gated script. While the device has a PIN and is locked, every `s.js` page with `p > 0` returns `401` (`docs/wled-ui-audit/settings/mechanism.md:47`).

**PIN unlock:** a top-level `"pin"` key in any JSON POST runs `checkSettingsPIN` before the body applies (`wled_server.cpp:438`). A wrong attempt starts a 3 s period in which the device ignores more attempts (`util.cpp:504`).

**`POST /json/state`:** `{"v":true}` in the body makes the reply the full state. Without it, the reply is `{"success":true}` (`docs/wled-ui-audit/api/json-state.md:21-22`). `{"rb":true}` reboots the device.

**`POST /json/cfg`:** `401` while locked (`wled_server.cpp:452-456`). Request body limit: 10240 B on ESP8266, 32767 B on ESP32 (`const.h:657-664`).

**Wi-Fi in `/json/cfg`** (`wled00/cfg.cpp:85-147`): `nw.ins` grows the list but never shrinks it. An empty `ssid` or an empty client `psk` is ignored. `ap.psk` is copied with no check, so `""` makes the AP open. `GET /json/cfg` returns `pskl` (the length), never `psk`.

**`GET /json/info`:** `brand` is `"WLED"`. `mac` has 12 lowercase hex characters. `uptime` is in seconds. Also `ver`, `vid`, `name`, `ip`, `arch`, `leds.count` (`docs/wled-ui-audit/api/json-info-and-lists.md`).

**`GET /json/nodes`:** `{"nodes":[{"name","type","ip","age","vid"}]}` (`json.cpp:1092-1108`). The list leaves out the device that answers. Nodes always use port 80.

**`GET /json/net`:** `{"networks":[{"ssid","rssi","bssid","channel","enc"}]}`. The first call starts a scan and returns `[]`.

**`GET /presets.json`:** an object keyed by preset ID as a string. `"0"` is always `{}`. Deleted presets are `{}`. The name is `n`.

**`GET /json/effects`** is an array of names (the index is the ID; unused slots are `"RSVD"`). **`GET /json/fxdata`** is an array of metadata strings with the same indexes. **`GET /json/palettes`** is an array of names.

**`node:sqlite`** (Node 24.3, checked): `import { DatabaseSync } from "node:sqlite"`; `new DatabaseSync(path)`; `db.exec(sql)`; `db.prepare(sql).run(...params)`, `.get(...params)`, `.all(...params)`. Rows are null-prototype objects. `db.prepare("PRAGMA user_version").get()` returns `{ user_version: 0 }`. Node 24 prints an `ExperimentalWarning` once at start. This is expected. Do not hide it.

**`bonjour-service` 1.4.4:** `import { Bonjour } from "bonjour-service"`; `const b = new Bonjour()`; `const browser = b.find({ type: "wled" }, (service) => ...)`. `service` has `name`, `host`, `port`, `addresses?: string[]`, `txt`. Call `browser.stop()` then `b.destroy()` at the end of the window.

**`multicast-dns` 7.2.5** (types `@types/multicast-dns` 7.2.4): `const m = mdns()`; `m.on("response", (packet) => ...)`; `m.query({ questions: [{ name: "wled-x.local", type: "A" }] })`; an answer has `{ name, type: "A", data: "<ip>" }`; `m.destroy()`. Use it for the A-record lookup. `bonjour-service` has no public A-query function.

**Error messages:** use the text of the design's mock for each code (`docs/design/strand-wled-spec.html:656-891`):
- `not_found`: "This device isn't in the app any more."
- `device_offline`: "`<name>` isn't responding."
- `no_device`: "No WLED device answered at `<host>`. Check the address and that the device is powered on."
- `already_added`: "`<name>` is already in your devices."
- `pin_required`: "This device's settings are protected by a PIN."
- `wrong_pin`: "That PIN didn't work."

## Review Focus

These five conditions are the most likely to hurt a user, and the spec's examples do not test them. The owning task adds a test for each.

1. The device gets a new IP address after a Wi-Fi change, and `last_ip` is stale. Expected: the next request finds the device through mDNS and updates `last_ip` (Task 4).
2. The user types `HTTP://192.168.1.42/`, `wled-backyard`, or `192.168.1.42:8080`. Expected: the probe normalizes the value and reaches the device (Task 6).
3. A device is busy and returns `503`, or closes the socket. Expected: `503 device_busy`, not `device_offline` (Task 4).
4. One saved device times out while the others answer. Expected: `GET /api/devices` returns all devices in about `DEVICE_TIMEOUT_MS`, with only that device `online: false` (Task 6).
5. A config write gets `401` or a timeout from the device. Expected: no reboot request, and `pending_reboot` does not change (Task 9).

---

## File structure

```
package.json, pnpm-workspace.yaml, tsconfig.json, vite.config.ts, vitest.config.ts, eslint.config.js,
components.json, index.html, CONVENTIONS.md, Dockerfile, docker-compose.yml, .dockerignore
shared/apiTypes.ts            API request/response types; the API contract in code
server/
  server.ts                   entry: loadConfig, openDb, buildApp, listen
  app.ts                      buildApp(deps): static, SPA fallback, /api routes, error handler
  config.ts                   env → Config
  errors.ts                   ApiError, error body, messages
  db/database.ts              openDb, migrations runner
  db/migrations.ts            ordered SQL list
  db/devices.ts               device row access
  db/preferences.ts           preference row access
  wled/deviceClient.ts        deviceRequest, address recovery, result mapping
  wled/capabilities.ts        parseCapabilities(sJsText)
  wled/configMerge.ts         mergeConfigPatch, change classification
  mdns.ts                     browseWled, resolveA (real implementations)
  routes/devices.ts           list, probe, add, delete
  routes/discovery.ts         discovery
  routes/settings.ts          info, config, unlock, capabilities, pins, scan, presets, reboot, pending-reboot
  routes/control.ts           state, effects, palettes
  routes/preferences.ts       preferences
test/
  fakeWled.ts                 fake WLED device (Fastify, random port)
  fixtures/                   seeds from the design; s.js samples (v0.15, 17.0.0-dev)
  testApp.ts                  builds the app with a temp DB and mDNS doubles
src/
  api/client.ts               browser API client, one function per mock api function
  (store, lib, components/ui, screens/homeScreen.tsx from the template, trimmed)
```

`buildApp` takes its dependencies, so tests replace mDNS and the database:

```ts
export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  mdns: { browseWled(windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]>;
          resolveA(host: string, timeoutMs: number): Promise<string | null> };
  now?: () => Date;
}
export function buildApp(deps: AppDeps): FastifyInstance;
```

**Port handling (plan decision, in the spirit of spec §8.2.1):** the `devices` table has `port INTEGER NOT NULL DEFAULT 80`. A host typed with a port keeps that port. `info.ip` updates `last_ip` and never the port. The fake device in tests runs on `127.0.0.1:<random port>` with this column.

---

### Task 1: Scaffold the package from the template

review: yes. This task removes a large amount of template code. A leftover SSR, auth or analytics path is easy to miss.

**Files:**
- Create (copy from `~/Code/app-template/frontend`, then edit): `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `components.json`, `index.html`, `CONVENTIONS.md`, `src/**`, `server/server.ts`, `server/app.ts`, `server/config.ts`, `server/requestLogSerializer.ts`
- Create (copy from `~/Code/app-template`): `pnpm-workspace.yaml` (keep `autoInstallPeers: false` and the build settings; no `packages:` list), the `packageManager` field of the root `package.json`
- Copy into `src/`: `packages/core/src/store/{index,createApiThunk}.ts`, `packages/core/src/lib/{withActions,reactCompat}.ts`, and their tests
- Test: `server/app.test.ts`

**Interfaces:**
- Produces: `loadConfig(env): Config` with `{ port, dataDir, webDistDir, deviceTimeoutMs, discoveryWindowMs }`; `buildApp(deps: AppDeps): FastifyInstance` (the signature above). Task 1 registers only static files, the SPA fallback, `Cache-Control: no-store` on `/api/*`, and the `/api` 404. Later tasks add route plugins in `server/routes/*.ts`, each `export async function <name>Routes(app: FastifyInstance, deps: AppDeps)`.

- [ ] **Step 1: Copy and strip.** Copy the files above. Then remove each item in spec §5 "Remove": SSR (`src/entryServer.tsx`, `routeData.ts`, `routeRules.ts`, `entryServer` build input, `ssrEntryPath`, `html.ts`), cookies and session (`cookies.ts`, `session.ts`, `auth.test.ts`, `src/components/guards/`, the auth and example slices, `sessionGuardMiddleware`, `preloadedState`), `proxy.ts`, `sitemap.ts`, `robots.ts`, `routeHead.ts`, `assetUrl.ts`, `clientIp.ts` and their tests, all of `src/lib/analytics*`, `gtag*`, `startAnalytics*`, `toolConversionLatch*`, `pathAudience*`, `sensitiveQueryKeys.ts`, `src/screens/*` except `homeScreen.tsx` and `notFoundScreen.tsx`, `posthog-js`, `@fastify/cookie`, `@fastify/http-proxy`, `@apptemplate/core`. Rename the package to `strand`. Set `engines.node` to `>=24`. Replace every `@apptemplate/core/...` import with the `src/` copy. Remove the names "lawndominator" and "app-template" from comments.
- [ ] **Step 2: Client entry.** `src/entryClient.tsx` uses `createRoot(...).render(...)`, not `hydrateRoot`. Routes: `/` → `homeScreen` (a placeholder that says "Strand"), `*` → `notFoundScreen`.
- [ ] **Step 3: Build scripts.** `build` = `vite build` (client to `dist/`). `build:server` = `vite build --ssr server/server.ts --outDir dist-server` (the server bundle only). `start` = `node dist-server/server.js`. `dev:build` and `dev` keep the template's watch loop. `vite.config.ts` drops the SSR-only branches it no longer needs and keeps the client-build `react` alias.
- [ ] **Step 4: Design tokens.** Copy the CSS variables in the `<style>` block of `docs/design/strand-wled-spec.html` (light and dark) into `src/index.css` in the Tailwind v4 `@theme` form that the template uses. Add the `success`, `warning`, `warning-muted`, `danger` and `glow` colors.
- [ ] **Step 5: Write the failing tests** in `server/app.test.ts`, with a temp `webDistDir` that holds `index.html` and `assets/a.js`:
  - `GET /` → 200, the `index.html` body.
  - `GET /devices/abc/settings/network` → 200, the `index.html` body.
  - `GET /assets/a.js` → 200, the file body.
  - `GET /api/nope` → 404 `{ error: "not_found" }`, header `cache-control: no-store`.
  - `POST /devices/x` → 404 (the fallback is for `GET` only).
- [ ] **Step 6: Implement** `buildApp` and `server/server.ts` until the tests pass. The tests pass `new DatabaseSync(":memory:")` as `db` and mDNS stubs that return `[]` and `null`. `server.ts` listens on `0.0.0.0:config.port`. Task 3 replaces the database it opens with `openDb`.
- [ ] **Step 7: Verify.** `pnpm install`, then `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:server`. All pass. `grep -rniE "posthog|gtag|cookie|ssr|entryServer|apptemplate|lawn" src server package.json` returns no product code (test names and comments about "no SSR" are fine).
- [ ] **Step 8: Update `CLAUDE.md`.** Replace the "There are no build, lint, or test commands yet" sentence with the commands from Step 7.
- [ ] **Step 9: Commit.** `git add -A && git commit -m "chore: scaffold strand package from the app template"`

### Task 2: Shared API types and errors

review: no

**Files:**
- Create: `shared/apiTypes.ts`, `server/errors.ts`
- Test: `server/errors.test.ts`

**Interfaces:**
- Produces, in `shared/apiTypes.ts`: `Device`, `DiscoveredDevice`, `WledInfo`, `WledConfig`, `WifiEntry` (with `psk?: string`), `ApConfig` (with `psk?: string`), `LedOutput`, `SyncConfig`, `Capabilities`, `PinInfo`, `WifiNetwork`, `Preset = { id: number; name: string }`, `Effect = { id: number; name: string; meta: string }`, `Palette = { id: number; name: string }`, `ErrorCode` (the union of the codes in spec §8.1), `ApiErrorBody = { error: ErrorCode; message: string }`. Copy the field lists from the design file: `toDevice` (line 670), `info` (line 711), the seed `config` objects, and `capabilitiesFor` (line 346).
- Produces, in `server/errors.ts`: `class ApiError extends Error { constructor(status: number, code: ErrorCode, message: string) }`; `messages: { notFound(): string; deviceOffline(name: string): string; noDevice(host: string): string; alreadyAdded(name: string): string; pinRequired(): string; wrongPin(): string }` with the texts in "Verified external API"; `registerErrorHandler(app: FastifyInstance): void`, which sends `ApiError` as `status` + `{ error, message }`, adds `Retry-After: 1` for `device_busy`, and sends any other error as `500 { error: "device_error", message: "Something went wrong." }` after it logs the error.

- [ ] **Step 1: Write the failing test.** An app with a route that throws `new ApiError(503, "device_busy", "x")` → status 503, header `retry-after: 1`, body `{ error: "device_busy", message: "x" }`. A route that throws `new Error("boom")` → 500 with code `device_error`. `messages.deviceOffline("Backyard")` === `"Backyard isn't responding."`.
- [ ] **Step 2: Run** `pnpm test server/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two files. Register the handler in `buildApp`. Convert Fastify validation errors to `400 invalid_request`.
- [ ] **Step 4: Run** the test and `pnpm exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add shared API types and error responses`

### Task 3: SQLite database and repositories

review: yes (schema and migrations)

**Files:**
- Create: `server/db/database.ts`, `server/db/migrations.ts`, `server/db/devices.ts`, `server/db/preferences.ts`
- Modify: `server/server.ts` (open the DB at `<dataDir>/strand.db`, create `dataDir` if missing)
- Test: `server/db/database.test.ts`, `server/db/devices.test.ts`, `server/db/preferences.test.ts`

**Interfaces:**
- Produces:
  - `openDb(path: string): DatabaseSync` (runs migrations; `":memory:"` works in tests).
  - `migrations: string[]`. Migration 1 is the SQL in spec §7 plus `port INTEGER NOT NULL DEFAULT 80` in `devices`.
  - `type DeviceRow = { id: string; mac: string; name: string; host: string; port: number; lastIp: string; lastSeen: string | null; pendingReboot: string[]; pendingSince: string | null; createdAt: string; updatedAt: string }`.
  - `devices`: `list(db): DeviceRow[]` (order by `created_at`), `get(db, id): DeviceRow | undefined`, `getByMac(db, mac): DeviceRow | undefined`, `insert(db, row: { mac, name, host, port, lastIp }, now: Date): DeviceRow` (new UUID v4 via `crypto.randomUUID()`), `remove(db, id): boolean`, `recordSeen(db, id, { name, lastIp }, now: Date): void`, `setLastIp(db, id, lastIp, now): void`, `addPendingReboot(db, id, names: string[], now: Date): void` (union with the current list, keep order, set `pending_since` to `now`), `clearPendingReboot(db, id, now): void`.
  - `preferences`: `getAll(db): Record<string, unknown>`, `put(db, key: string, value: unknown, now: Date): void`.

- [ ] **Step 1: Write the failing tests.**
  - `openDb(":memory:")` sets `user_version` to `migrations.length`. Opening a file DB twice does not run a migration again.
  - A migration that throws leaves `user_version` unchanged (run the runner with `["CREATE TABLE a(x)", "BROKEN SQL"]`).
  - `insert` then `getByMac` returns the row. A second `insert` with the same MAC throws.
  - `addPendingReboot(["hostname"])` then `addPendingReboot(["static IP", "hostname"])` gives `["hostname", "static IP"]`.
  - `preferences.put("fav", ["Chase"])` then `getAll()` gives `{ fav: ["Chase"] }`.
- [ ] **Step 2: Run** `pnpm test server/db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each migration runs in `BEGIN`/`COMMIT` with `PRAGMA user_version = n` inside the same transaction. Use only prepared statements with parameters. Store `pending_reboot` as JSON text.
- [ ] **Step 4: Run** the tests and the type gate. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add sqlite device registry and preferences`

### Task 4: Fake WLED device and device client

review: yes (error mapping and address recovery are the base of every route)

**Files:**
- Create: `test/fakeWled.ts`, `test/fixtures/seeds.ts`, `test/testApp.ts`, `server/wled/deviceClient.ts`
- Test: `server/wled/deviceClient.test.ts`

**Interfaces:**
- Produces, `test/fixtures/seeds.ts`: the five seeds of the design (`SEEDS`, lines 375-556), as WLED-shaped data: `info` (the output of the mock's `info()`, plus `brand: "WLED"`), `cfg` (the seed `config`, plus `hw.btn`, `hw.ir`, `hw.relay`, `if.mqtt`, `if.ntp` stubs so that subtree tests can see them), `state`, `presets` (as a `presets.json` object), `effects`, `fxdata`, `palettes`.
- Produces, `test/fakeWled.ts`: `startFakeWled(seed, opts?: { pin?: string; version?: "0.15" | "17" }): Promise<FakeWled>` with `FakeWled = { port: number; url: string; requests: { method: string; path: string; body: unknown }[]; setMode(m: "ok" | "timeout" | "busy" | "reset"): void; restart(): void; cfg: object; state: object; close(): Promise<void> }`. It serves every WLED endpoint in "Verified external API" from the seed. It applies `POST /json/cfg` with the firmware rules (top-level keys replace, `nw.ins` never shrinks, empty `psk` ignored for clients, `ap.psk` copied). It implements the PIN (`401` on `POST /json/cfg` and `s.js?p>0` while locked; a body `"pin"` unlocks). `restart()` sets `uptime` to 0. `"timeout"` never answers; `"busy"` returns `503`; `"reset"` destroys the socket.
- Produces, `test/testApp.ts`: `makeTestApp(opts?: { browse?: AppDeps["mdns"]["browseWled"]; resolveA?: AppDeps["mdns"]["resolveA"]; now?: () => Date }): { app: FastifyInstance; db: DatabaseSync; addFake(f: FakeWled, seed): DeviceRow }`, with `deviceTimeoutMs: 300` and `discoveryWindowMs: 50`.
- Produces, `server/wled/deviceClient.ts`:
  - `type DeviceTarget = { id?: string; name: string; host: string; port: number; lastIp: string; mac?: string }`.
  - `deviceRequest<T>(deps: AppDeps, target: DeviceTarget, path: string, init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; parse?: "json" | "text" }): Promise<T>`.
  - `fetchInfo(deps, ip: string, port: number): Promise<WledInfo & { brand: string; mac: string } | null>`. It returns `null` for any failure or a reply that is not WLED (spec §8.2.1).

- [ ] **Step 1: Write the failing tests** for `deviceRequest` against a fake:
  - `"ok"`: returns the parsed JSON.
  - `"timeout"`: throws `ApiError` 504 `device_offline` with the message "Backyard isn't responding." in about `timeoutMs`.
  - `"busy"`: throws 503 `device_busy`.
  - `"reset"`: throws 503 `device_busy`.
  - Connection refused (a closed port): throws 504 `device_offline`.
  - A `200` reply `{"error":3}`: throws 502 `device_error`, and the message contains `3`.
  - A `401`: throws 401 `pin_required`.
  - Review Focus 1: the row has a stale `lastIp` (a closed port on `127.0.0.2`), `host` is `wled-backyard.local`, `resolveA` returns `127.0.0.1`, and the fake's MAC matches. The request succeeds, and `devices.get(id).lastIp` becomes `127.0.0.1`.
  - The same case, but the fake's MAC is different: throws 504, and `lastIp` does not change.
- [ ] **Step 2: Run** `pnpm test server/wled/deviceClient.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the fake, the seeds, `makeTestApp`, and `deviceRequest` by spec §9. Map errors: `AbortError`/`TimeoutError`, `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH` → offline; `ECONNRESET`, `UND_ERR_SOCKET`, `503` → busy. Address recovery runs only for an offline error, only when `host` ends in `.local` and the row has an `id`, and only one time.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add WLED device client and fake device for tests`

### Task 5: mDNS functions

review: no

**Files:**
- Create: `server/mdns.ts`
- Modify: `server/server.ts` (pass the real `mdns` to `buildApp`), `package.json` (add `bonjour-service@1.4.4`, `multicast-dns@7.2.5`, `@types/multicast-dns@7.2.4`)
- Test: `server/mdns.test.ts`

**Interfaces:**
- Produces: `browseWled(windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]>` and `resolveA(host: string, timeoutMs: number): Promise<string | null>`, as the "Verified external API" section describes. Both create their sockets per call and destroy them before they return. Both resolve (never reject) when the network has no mDNS.

- [ ] **Step 1: Write the test.** `browseWled(50)` resolves to an array in less than 500 ms. `resolveA("strand-test-nonexistent.local", 100)` resolves to `null`. These tests check that the functions end and clean up. They do not need a real device.
- [ ] **Step 2: Implement.** Keep only IPv4 addresses. For `resolveA`, ignore answers whose `name` is not the requested host.
- [ ] **Step 3: Run** the test and the type gate. Expected: PASS.
- [ ] **Step 4: Commit.** `feat(server): add mDNS browse and A-record lookup`

### Task 6: Device routes: list, probe, add, delete

review: yes (public API, input handling)

**Files:**
- Create: `server/routes/devices.ts`
- Test: `server/routes/devices.test.ts`

**Interfaces:**
- Consumes: `deviceRequest`, `fetchInfo` (Task 4), `devices` repository (Task 3), `ApiError`/`messages` (Task 2).
- Produces: `devicesRoutes(app, deps)`. Exports `normalizeHost(input: string): { host: string; port: number } | null` and `toDevice(row: DeviceRow, live: { info: WledInfo | null; locked: boolean }, now: Date): Device` for reuse.

- [ ] **Step 1: Write the failing tests.**
  - `GET /api/devices` with three saved fakes (Backyard, Front Roof with PIN `1234`, Desk Lamp in `"timeout"`): three devices in `created_at` order. Backyard is `online: true, pinLocked: false`. Front Roof is `pinLocked: true`. Desk Lamp is `online: false, pinLocked: false`, and `lastSeen` is the stored value. Review Focus 4: the response arrives in less than `2 × deviceTimeoutMs`.
  - `GET /api/devices` updates `name` and `last_seen` from `info`.
  - `normalizeHost`: `"HTTP://192.168.1.42/"` → `{ host: "192.168.1.42", port: 80 }`; `"192.168.1.42:8080"` → port 8080; `"wled-backyard"` → `{ host: "wled-backyard", port: 80 }`; `"  "` → `null`; `"a b"` → `null`. (Review Focus 2.)
  - `POST /api/devices/probe { host: "127.0.0.1:<port>" }` → `DiscoveredDevice` with `alreadyAdded: false`.
  - Probe of a bare name: `"wled-backyard"`, where `resolveA("wled-backyard.local")` returns `127.0.0.1` → success, `host: "wled-backyard.local"`.
  - Probe of a closed port → `404 no_device`, with the message for that host.
  - Probe of a server that returns `{}` for `/json/info` → `404 no_device`.
  - `POST /api/devices` → 201 `Device`. The same host again → `409 already_added`, message "Backyard is already in your devices.".
  - `POST /api/devices {}` → `400 invalid_request`.
  - `DELETE /api/devices/:id` → 204. Again → `404 not_found`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.2. The list runs `fetchInfo` and the lock check (`GET /settings/s.js?p=3`, text) for each device at the same time with `Promise.allSettled`. Run the lock check only after `info` succeeds. A host name that is not an IP is resolved: `.local` names through `resolveA`, other names through `node:dns/promises` `lookup`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add device list, probe, add and delete endpoints`

### Task 7: Discovery

review: no

**Files:**
- Create: `server/routes/discovery.ts`
- Test: `server/routes/discovery.test.ts`

**Interfaces:**
- Consumes: `mdns.browseWled`, `fetchInfo`, `devices`.
- Produces: `discoveryRoutes(app, deps)`. Add `wledPort: number` to `AppDeps` (default 80). Discovery uses it for addresses from `/json/nodes`. Tests set it to the fake's port.

- [ ] **Step 1: Write the failing tests.**
  - `browse` returns Garage and Backyard (two fakes). Backyard is saved. The result has both, and only Backyard has `alreadyAdded: true`. `host` is `"wled-garage.local"` for Garage.
  - `browse` returns `[]`. A saved device's `/json/nodes` lists the address of a second fake. The result has that device.
  - `browse` returns an address that does not answer, and an address that is not WLED. The result leaves out both.
  - The same MAC found through mDNS and through nodes appears once.
  - A saved device found at a new address gets its `last_ip` updated.
  - A device whose `id.mdns` is `""`: `host` is its IP.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.2.2. Run `browseWled` and the nodes requests at the same time. Then run every `fetchInfo` at the same time. The `/json/info` reply has no mDNS name, so take it from the browse result (`service.host`) or from a `GET /json/cfg` `id.mdns` request when the address came from nodes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add WLED discovery endpoint`

### Task 8: Read-only settings endpoints and the capabilities parser

review: yes (the parser reads text from the device)

**Files:**
- Create: `server/wled/capabilities.ts`, `server/routes/settings.ts`, `test/fixtures/sjs-0.15.txt`, `test/fixtures/sjs-17.txt`, `test/fixtures/sjs-ethernet.txt`
- Test: `server/wled/capabilities.test.ts`, `server/routes/settings.read.test.ts`

**Interfaces:**
- Produces: `parseCapabilities(text: string): Capabilities | null`; `settingsRoutes(app, deps)` with the read endpoints: `GET info`, `GET config`, `GET capabilities`, `GET pins`, `POST networks/scan`, `GET presets`. Task 9 adds the write endpoints to the same file. Export `loadDevice(deps, id): DeviceRow` (throws `404 not_found`) for Tasks 9 and 10.

- [ ] **Step 1: Write the fixtures.** Build each `s.js` sample from the format in "Verified external API": `function GetV(){var d=document;d.um_p=[];d.rsvd=[6,7,8,9,10,11];d.ro_gpio=[34,35,36,37,38,39];...d.ledTypes=[{i:22,c:1,t:"D",n:"WS281x"},{i:30,c:3,t:"D",n:"SK6812/WS2814 RGBW"},{i:45,c:7,t:"AAAAA",n:"PWM RGBCCT"}];bLimits(...);...}`. Use 8 arguments in the 0.15 sample (`32,3,2048,87040,16384,10,16,16`) and 10 in the 17 sample (`0,2048,87040,16384,10,16,8,8,16,4`). The Ethernet sample has `d.rsvd=[6,7,8,];`.
- [ ] **Step 2: Write the failing tests.**
  - The 0.15 sample → `limits` `{ maxLedsPerOutput: 2048, ledMemoryBytes: 87040, maxLeds: 16384, maxDigitalOutputs: 16, maxPwmPins: 16 }`, `reservedPins` `[6,…,11]`, `inputOnlyPins` `[34,…,39]`, three `ledTypes` with `i`, `c`, `t`, `n`.
  - The 17 sample → the same `limits`.
  - The Ethernet sample → `reservedPins` `[6,7,8]`.
  - `bLimits` with 9 arguments → `null`. No `d.ledTypes` → `null`.
  - `GET capabilities` on a locked fake → `401 pin_required`. On a fake that serves an unsupported sample → `502 device_error`.
  - `GET config` returns only the keys `id, nw, ap, def, light, hw, if`, with `hw` = `{ led }` and `if` = `{ sync }`.
  - `GET presets` from `{"0":{},"1":{"n":"Warm White"},"3":{},"2":{"n":"Christmas"}}` → `[{id:1,name:"Warm White"},{id:2,name:"Christmas"}]`.
  - `POST networks/scan`: the fake returns `[]` on the first two calls and then the design's `AIRWAVES` → the five networks. A fake that always returns `[]` → `{ networks: [] }` after 10 tries (use a 1 ms delay in tests: make the delay a parameter of the function, default 1000 ms).
  - Each endpoint for an unknown `:id` → `404 not_found`. For an offline device → `504 device_offline`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** by spec §8.3 and "Verified external API". The parser does not run the text.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(server): add settings read endpoints and capabilities parser`

### Task 9: Config write, pending reboot, reboot, unlock

review: yes (writes device configuration; data integrity)

**Files:**
- Create: `server/wled/configMerge.ts`
- Modify: `server/routes/settings.ts`
- Test: `server/wled/configMerge.test.ts`, `server/routes/settings.write.test.ts`

**Interfaces:**
- Produces:
  - `checkUnsupported(current: WledConfigFull, patch: Partial<WledConfig>): string | null` (a message, or `null`).
  - `mergeConfigPatch(current: object, patch: object): object`. Objects merge deeply. Arrays and scalars in `patch` replace.
  - `topLevelBody(merged: object, patch: object): object`. For each top-level key of `patch`, the full merged subtree.
  - `classifyChanges(before: WledConfig, after: WledConfig, patch: Partial<WledConfig>): { reconnect: boolean; reboot: string[] }`. The rules are spec §8.3 step 7, which copies `wifiChanged` (design line 759) and `getPendingReboot` (line 929). Names: `"hostname"`, `"static IP"`.
  - Routes: `PATCH config`, `POST unlock`, `POST reboot`, `GET pending-reboot`.

- [ ] **Step 1: Write the failing unit tests** for `configMerge.ts`:
  - `topLevelBody` of a patch `{ hw: { led: { maxpwr: 850 } } }` contains the full `hw`, with `btn`, `ir`, `relay`, and `led.ins` unchanged.
  - A patch with `hw.led.ins` of one entry replaces a list of two.
  - `checkUnsupported`: 2 current networks and a patch with 1 → message. A client entry `psk: ""` where `pskl > 0` → message. `ap.psk: ""` → `null`.
  - `classifyChanges`: a new SSID → `reconnect`. A `psk` on an entry → `reconnect`. `ap.chan` changed → `reconnect`. `id.mdns` changed → `reboot: ["hostname"]`. A static IP added → `reboot: ["static IP"]`. `def.bri` changed → neither.
- [ ] **Step 2: Write the failing route tests** against the fake:
  - A `PATCH config { hw: { led: { maxpwr: 850 } } }` → exactly one `POST /json/cfg` in `fake.requests`, whose body has the full `hw` object and no other key. The response is the re-read config, with `maxpwr: 850`.
  - A `PATCH` with a new SSID → the request list has `POST /json/cfg`, then `GET /json/cfg`, then `POST /json/state {"rb":true}`. `pending_reboot` is empty afterward.
  - A `PATCH { id: { mdns: "porch" } }` → no reboot request. `GET pending-reboot` → `["hostname"]`. After `fake.restart()`, `GET pending-reboot` → `[]`, and the DB value is cleared.
  - `GET pending-reboot` with nothing pending → `[]`, and the fake gets no request.
  - `GET pending-reboot` while the device is offline → the stored list.
  - A locked fake → `401 pin_required`. Review Focus 5: no `rb` request, and `pending_reboot` does not change. The same for a fake in `"timeout"` → `504`.
  - A shorter `nw.ins` → `422 unsupported_change`, and the fake gets no `POST`.
  - `POST unlock { pin: "1234" }` on a locked fake → 204, then `PATCH config` succeeds. `{ pin: "0000" }` → `401 wrong_pin`. On a fake with no PIN → 204. `{}` → `400 invalid_request`.
  - `POST reboot` → 204, the fake got `{"rb":true}`, and `pending_reboot` is cleared.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** by spec §8.3 "Config write", "Pending reboot", "Unlock" and "Reboot". The device "started after `pending_since`" when `now - info.uptime * 1000 > pending_since`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(server): add config write, unlock, reboot and pending reboot`

### Task 10: Control and preferences endpoints

review: no

**Files:**
- Create: `server/routes/control.ts`, `server/routes/preferences.ts`
- Test: `server/routes/control.test.ts`, `server/routes/preferences.test.ts`

**Interfaces:**
- Produces: `controlRoutes(app, deps)` (`GET state`, `PATCH state`, `GET effects`, `GET palettes`); `preferencesRoutes(app, deps)` (`GET /api/preferences`, `PUT /api/preferences/:key`).

- [ ] **Step 1: Write the failing tests.**
  - `PATCH state { on: false }` → the fake got exactly `{ on: false, v: true }`. The response is the fake's full state.
  - `PATCH state { pin: "1234" }` and `{ rb: true }` → `400 invalid_request`. `PATCH state [1]` → `400`.
  - `GET effects` with names `["Solid","RSVD","Blink"]` and fxdata `["","","!,;!;"]` → `[{id:0,name:"Solid",meta:""},{id:2,name:"Blink",meta:"!,;!;"}]`.
  - `GET palettes` → `{ id, name }[]` by index.
  - `PUT /api/preferences/fav { value: ["Chase"] }` → 204, then `GET` → `{ fav: ["Chase"] }`. Key `"a b"` → 400. A value over 64 KB → 400.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.4 and §8.5.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add light control and preferences endpoints`

### Task 11: Browser API client

review: no

**Files:**
- Create: `src/api/client.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**
- Consumes: `shared/apiTypes.ts`.
- Produces: `export const api` with the functions of the design's mock `api` object and the same names: `listDevices`, `discover`, `probeHost`, `addDevice`, `removeDevice`, `getInfo`, `getState`, `patchState`, `getConfig`, `patchConfig`, `unlock`, `getCapabilities`, `getPins`, `scanNetworks`, `getPresets`, `reboot`, plus `getPendingReboot`, `getEffects`, `getPalettes`, `getPreferences`, `putPreference`. `export class ApiError extends Error { status: number; code: ErrorCode }`, the same as the mock's.

- [ ] **Step 1: Write the failing tests** with a stubbed `fetch`: `getConfig("abc")` calls `GET /api/devices/abc/config`. A `401 {"error":"pin_required","message":"m"}` reply throws `ApiError` with `status 401`, `code "pin_required"`, `message "m"`. A `204` reply resolves to `undefined`. URLs are absolute paths with no origin.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** One private `request<T>(method, path, body?)`. Encode `:id` with `encodeURIComponent`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add typed API client`

### Task 12: Docker image and compose file

review: no

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

**Interfaces:**
- Consumes: the `build`, `build:server` and `start` scripts (Task 1).

- [ ] **Step 1: Write the Dockerfile.** Build stage `node:24`: install pnpm from `packageManager`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm build:server`. Runtime stage `node:24-slim`: `pnpm install --prod --frozen-lockfile --ignore-scripts`, copy `dist/` and `dist-server/` as siblings, `ENV DATA_DIR=/data`, `VOLUME /data`, `RUN mkdir -p /data && chown node:node /data`, `USER node`, `EXPOSE 3000`, `CMD ["node", "dist-server/server.js"]`.
- [ ] **Step 2: Write `docker-compose.yml`**, the same as PRD §5, with `build: .` and `image: strand`.
- [ ] **Step 3: Verify.** `docker build -t strand .` succeeds. `docker run --rm -p 3000:3000 -v "$PWD/.tmp-data:/data" strand` starts. `curl -s localhost:3000/api/devices` returns `[]`, and `curl -s localhost:3000/` returns the HTML. `.tmp-data/strand.db` exists. Remove `.tmp-data` afterward. (`network_mode: host` does not work on Docker Desktop for macOS. This check uses `-p` only to prove that the image runs.)
- [ ] **Step 4: Commit.** `build: add Docker image and compose file`
