# App Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Strand app server: one Node package that serves the client-rendered frontend and implements the design's `/api` contract over the WLED JSON API.

**Architecture:** Copy the frontend of `~/Code/app-template` to the repository root and remove SSR, auth, SEO, analytics and the `/v1` proxy. The Fastify serving tier becomes the whole backend. `buildApp(deps)` in `server/app.ts` registers every `/api` route. Each route reads the device row from SQLite, sends one or more HTTP requests to the device, and returns the result. Nothing is kept in memory between requests.

**Tech Stack:** Node 24, TypeScript, Fastify 5, `@fastify/static`, `node:sqlite`, `bonjour-service` 1.4.4, `multicast-dns` 7.2.5, vitest, Vite, React 19, Redux Toolkit + recompose, Tailwind v4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-10-23-app-server-design.md` (approved). The API contract comes from `docs/design/strand-wled-spec.html`, block "MOCK APP SERVER" (lines 576-1058), down to its "Lights and presets" list. Read both before you start a task. The Lights and Presets design (`docs/superpowers/specs/2026-11-23-lights-presets-design.md`) changes some rules of the spec. "Decisions" below lists what it changes in this plan. Its endpoints (the "Lights and presets" list and the block "MOCK APP SERVER: LIGHTS AND PRESETS") belong to a separate plan.

## Pipeline State

| Field     | Value                                                        |
|-----------|--------------------------------------------------------------|
| stage     | 3 (implementation)                                           |
| class     | large (new subsystem, new schema, new public API)            |
| profile   | backend (the frontend part is a scaffold with no screens)    |
| branch    | feat/app-server                                              |
| pr        | #1                                                           |
| gate      | approved 2026-11-23                                          |
| round     | 0                                                            |
| decisions | 8                                                            |

### Decisions

The plan-time choices that change the spec are in "Plan decisions" below. These entries record changes to the approved plan.

1. **Task 8, WLED presets endpoint.** The plan said: `settingsRoutes` serves `GET /api/devices/:id/presets` from `/presets.json`, with a test, and the file structure lists "presets" in `routes/settings.ts`. It says now: there is no presets endpoint. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §3, §9.
2. **Task 8, `Preset` type.** The plan said: Task 8 consumes `Preset` (Task 2 added it to `shared/apiTypes.ts`). It says now: Task 8 removes `Preset` from `shared/apiTypes.ts`, because no endpoint returns it. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §3, §9.
3. **Task 8, config read `def`.** The plan said: `GET config` returns `def` as the device has it, with the boot preset `ps`. It says now: `GET config` returns `def` = `{ on, bri }`, and `WledConfig.def` has no `ps` (the test seeds keep `def.ps`). Strand always sets its startup preset as the boot preset, so Settings has no boot preset field. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §6.7.
4. **Task 9, config write `def`.** The plan said: the config write accepts any keys inside `def`. It says now: a `def` key other than `on` and `bri` gets `400 invalid_request`, and the device gets no `POST`. Settings writes only `def.on` and `def.bri`. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §6.7.
5. **Task 10, `PATCH state`.** The plan said: the server passes any JSON object through, except one with `pin` or `rb`. It says now: the body is only `{ on?, bri? }` (`StatePatch` in `shared/apiTypes.ts`). The handler checks it and rejects anything else with `400 invalid_request`. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §4, §9.
6. **Task 11, browser API client.** The plan said: `api` has every function of the mock `api` object, with `getPresets`, and `patchState` takes a WLED state object. It says now: no `getPresets`; `patchState(id, patch: StatePatch)`; the Lights, scene and look functions belong to a separate plan. The browser never sends WLED JSON. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §2 (decision 11), §9.
7. **Global Constraints.** The plan said: do not store presets in the database, and keep nothing in memory between requests. It says now: do not store live lighting state, effects, palettes or segments in the database; this plan adds no timer (the flash and startup-write timers belong to a separate plan); the browser never sends WLED JSON. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §4.
8. **Spec line, mock block.** The plan said: the contract is the block "MOCK APP SERVER" (lines 574-937). It says now: lines 576-1058, down to the "Lights and presets" list; the Lights and Presets endpoints belong to a separate plan. Why: Lights and Presets design, docs/superpowers/specs/2026-11-23-lights-presets-design.md §9, §10.

## Plan decisions

The plan makes these choices. The spec does not make them, or the plan changes what the spec says. Each one is here so that the owner sees it at the gate.

1. **Host allow-list and CSRF guard** (security review). The server has no login, so a web page on the internet can try to call the API from a user's browser (DNS rebinding and cross-site requests). The server rejects:
   - an `/api` request whose `Host` is not allowed. Allowed by default: IP addresses, `localhost`, and names that end in `.local`. Add more names with `ALLOWED_HOSTS` (comma-separated, for example `strand.example.com,lights.tail1234.ts.net`). `ALLOWED_HOSTS=*` turns the check off.
   - a non-`GET` `/api` request without the header `X-Strand-Request: 1`, or with an `Origin` whose host is not the `Host`.

   A user who puts Strand behind a reverse proxy with its own host name must set `ALLOWED_HOSTS`. The compose file shows this.
2. **`last_ip` is the address the server reached**, not the `info.ip` that the device reports (spec §7 says `info.ip`). A device must not choose where the server sends the next request, which can include the PIN.
3. **`port` column** in `devices` (default 80). A host typed with a port keeps that port. Tests run fake devices on random ports.
4. **`wledPort`** in `AppDeps` (default 80). Discovery uses it for addresses from `/json/nodes`, and probe uses it when the user types no port. Tests set it to the fake's port.
5. **`/json/pins` does not exist in WLED 0.15** (it is not in `v0.15.0:wled00/json.cpp`). For 0.15, `GET pins` builds the list from `s.js?p=2` (`d.max_gpio`, `d.rsvd`, `d.ro_gpio`) and the pins in `/json/cfg`. This path is PIN-gated.
6. **The `s.js` fixtures are written from the firmware source format**, not captured from a real device. No device is available to the build. Real-device checks go in the PR's "Pre-merge checks".
7. **If the reboot after a Wi-Fi change fails**, the config write still returns `200` with the new config, and the server adds `"Wi-Fi"` to `pending_reboot`. The design's banner then says "The new Wi-Fi takes effect after a reboot."
8. **Limits:** request bodies at most 32 KB (preferences 70 KB); device replies at most 1 MB; at most 64 addresses per discovery, all private IPv4; at most 256 preference keys; PIN is 4 digits.
9. **The config write rejects top-level keys other than** `id`, `nw`, `ap`, `def`, `light`, `hw`, `if`. This keeps the settings coverage partial, as CLAUDE.md requires.

## Global Constraints

Binding rules this change can touch (see `CLAUDE.md`, and the `CONVENTIONS.md` that Task 1 writes from the template's root and frontend conventions):

- The browser talks only to the app server. No frontend code calls a WLED device (CLAUDE.md, "Architecture constraints").
- Do not store live lighting state, effects, palettes or segments in the database (CLAUDE.md). Scenes, looks and strand groups come with the Lights and Presets plan.
- No in-memory device state, connection, or queue between requests (spec §3, §4 anti-goals). This plan adds no timer. The flash and startup-write timers belong to the Lights and Presets plan.
- The browser never builds or sends WLED JSON. `PATCH state` accepts only `{ on?, bri? }` (CLAUDE.md).
- Settings writes use only `POST /json/cfg` and `POST /json/state`. No `/settings/<page>` form POSTs (spec §3).
- No `NODE_ENV` branch anywhere (template CONVENTIONS, "the no-`NODE_ENV` rule").
- React hooks only in `src/lib/withRouter.tsx`. Enforced by `eslint.config.js`.
- camelCase file names, including test fixtures (template root CONVENTIONS §4). Tool-mandated names (`package.json`, `pnpm-workspace.yaml`, `Dockerfile`, `compose.yaml`, `.gitignore`, `.dockerignore`) are the exception.
- Tests are colocated as `<file>.test.ts` next to the file they cover (template root CONVENTIONS §6).
- Every task's gate before its commit: `pnpm exec tsc --noEmit && pnpm lint && pnpm test <task paths>`. The Vite build and vitest do not check types.
- Chained calls: align `.method()` with the start of the line above (user's global rule).
- Conventional Commits, `type(scope): subject`. No co-author or attribution trailers.
- Stage files by path. Never `git add -A`.
- No third-party network calls from the server or the browser (spec §4 anti-goals). Do not copy the Google Fonts link from the design file. Use the `@fontsource-variable/geist` packages that the template already has.
- Never log a request body or a PIN.

## Verified external API (do not re-derive)

Facts pinned from source on 2026-10-23. WLED source: `~/Code/WLED` at `nightly-522-g3cdb5108` (17.0.0-dev) and tags `v0.15.0`, `v0.15.5`. There is no `v0.16.*` tag. "0.16" in the spec means the current nightly line. Fixtures cover 0.15 and 17.0.0-dev.

**`GET /settings/s.js?p=2`** (`wled00/xml.cpp:336-355`, `wled00/wled_server.cpp:537-539` in v0.15.0). The body is `function GetV(){var d=document;...}`. It contains:
- `d.ledTypes=[{i:22,c:1,t:"D",n:"WS281x"},...];`. The keys are NOT quoted. The values are numbers and double-quoted strings (`bus_manager.cpp:1346-1355`). Quote the keys (`/([{,])([a-z]+):/g` → `$1"$2":`), then `JSON.parse`. `c` bits: 0x01 RGB, 0x02 white, 0x04 CCT, 0x10 16-bit, 0x20 must refresh.
- `bLimits(...)` with integer arguments. The count tells the version:
  - 8 arguments (v0.15.x): `maxBusses, minVirtualBusses, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxAnalogChannels`.
  - 10 arguments (17.0.0-dev): `platformId, maxLedsPerBus, maxLedMemory, maxLeds, maxColorOrderMappings, maxDigitalChannels, maxRmtChannels, maxI2sChannels, maxAnalogChannels, maxButtons`.
  - Any other count: unsupported firmware.
- `d.rsvd=[6,7,8];` and `d.ro_gpio=[34,35];`. Either list can be empty (`[]`). With Ethernet compiled in, `d.rsvd` can end in a trailing comma (`[6,7,8,]`) (`xml.cpp:136-153`). Drop empty items.
- `d.max_gpio=40;` (the number of GPIOs) in both versions (`xml.cpp:171`; v0.15.0 `xml.cpp:150`).
- Map to the design's `Capabilities.limits`: `maxLedsPerOutput` = maxLedsPerBus, `ledMemoryBytes` = maxLedMemory, `maxLeds` = maxLeds, `maxDigitalOutputs` = maxDigitalChannels, `maxPwmPins` = maxAnalogChannels.

**Lock check:** `GET /settings/s.js?p=3`. Page 3 (UI) prints only `DS` and `SU` (`xml.cpp:472-476`), so it is the smallest PIN-gated script. While the device has a PIN and is locked, every `s.js` page with `p > 0` returns `401` (`docs/wled-ui-audit/settings/mechanism.md:47`).

**`GET /json/pins`** (17.0.0-dev only, `json.cpp:1110-1150`): `{"pins":[{"p":<gpio>,"c":<caps>,"a":<allocated>,"n"?:<owner>}]}`. Caps bits (`pin_manager.h:14-18`): 0x02 ADC, 0x08 boot, 0x10 strapping, 0x20 input-only. In v0.15 the path `/json/pins` falls through to the full `/json` reply (`v0.15.0:json.cpp:1083-1101`), which has no `pins` key.

**PIN unlock:** a top-level `"pin"` key in any JSON POST runs `checkSettingsPIN` before the body applies (`wled_server.cpp:438`). A wrong attempt starts a 3 s period in which the device ignores more attempts (`util.cpp:504`).

**`POST /json/state`:** `{"v":true}` in the body makes the reply the full state. Without it, the reply is `{"success":true}` (`docs/wled-ui-audit/api/json-state.md:21-22`). `{"rb":true}` reboots the device.

**`POST /json/cfg`:** `401` while locked (`wled_server.cpp:452-456`). Request body limit: 10240 B on ESP8266, 32767 B on ESP32 (`const.h:657-664`).

**Wi-Fi in `/json/cfg`** (`wled00/cfg.cpp:85-147`): `nw.ins` grows the list but never shrinks it. An empty `ssid` or an empty client `psk` is ignored. `ap.psk` is copied with no check, so `""` makes the AP open. `GET /json/cfg` returns `pskl` (the length), never `psk`.

**`GET /json/info`:** `brand` is `"WLED"`. `mac` has 12 lowercase hex characters. `uptime` is in seconds. Also `ver`, `vid`, `name`, `ip`, `arch`, `leds.count` (`docs/wled-ui-audit/api/json-info-and-lists.md`).

**`GET /json/nodes`:** `{"nodes":[{"name","type","ip","age","vid"}]}` (`json.cpp:1092-1108`). The list leaves out the device that answers. Nodes always use port 80.

**`GET /json/net`:** `{"networks":[{"ssid","rssi","bssid","channel","enc"}]}`. The first call starts a scan and returns `[]`.

**`GET /presets.json`:** an object keyed by preset ID as a string. `"0"` is always `{}`. Deleted presets are `{}`. The name is `n`.

**`GET /json/effects`** is an array of names (the index is the ID; unused slots are `"RSVD"`). **`GET /json/fxdata`** is an array of metadata strings with the same indexes. **`GET /json/palettes`** is an array of names.

**Node `fetch` errors** (undici, Node 24): a network failure rejects with `TypeError("fetch failed")`, and the cause code is on `err.cause.code`. Timeout through `AbortSignal.timeout(ms)` rejects with a `DOMException` named `TimeoutError`.

**`node:sqlite`** (Node 24.3, checked): `import { DatabaseSync } from "node:sqlite"`; `new DatabaseSync(path)`; `db.exec(sql)`; `db.prepare(sql).run(...params)`, `.get(...params)`, `.all(...params)`. Rows are null-prototype objects. `db.prepare("PRAGMA user_version").get()` returns `{ user_version: 0 }`. Node 24 prints an `ExperimentalWarning` once at start. This is expected. Do not hide it.

**`bonjour-service` 1.4.4:** `import { Bonjour } from "bonjour-service"`; `const b = new Bonjour()`; `const browser = b.find({ type: "wled" }, (service) => ...)`. `service` has `name`, `host`, `port`, `addresses?: string[]`, `txt`. Call `browser.stop()` then `b.destroy()` at the end of the window.

**`multicast-dns` 7.2.5** (types `@types/multicast-dns` 7.2.4): `const m = mdns()`; `m.on("response", (packet) => ...)`; `m.query({ questions: [{ name: "wled-x.local", type: "A" }] })`; an answer has `{ name, type: "A", data: "<ip>" }`; `m.destroy()`. Use it for the A-record lookup. `bonjour-service` has no public A-query function.

**Error messages:** use the text of the design's mock where it has one (`docs/design/strand-wled-spec.html:656-891`):
- `not_found`: "This device isn't in the app any more."
- `device_offline`: "`<name>` isn't responding."
- `no_device`: "No WLED device answered at `<host>`. Check the address and that the device is powered on."
- `already_added`: "`<name>` is already in your devices."
- `pin_required`: "This device's settings are protected by a PIN."
- `wrong_pin`: "That PIN didn't work."
- `device_busy` (new): "`<name>` is busy. Try again in a moment."
- `device_error` (new): "`<name>` returned an error (`<detail>`)."
- `unsupported_change` (new): the text from `checkUnsupported` (Task 9).
- `invalid_request` (new): "That request isn't valid." or a more exact sentence from the route.

## Review Focus

These five conditions are the most likely to hurt a user, and the spec's examples do not test them. The owning task adds a test for each.

1. The device gets a new IP address after a Wi-Fi change, and `last_ip` is stale. Expected: the next request finds the device through mDNS and updates `last_ip` (Task 4).
2. The user types `HTTP://192.168.1.42/`, `wled-backyard`, or `192.168.1.42:8080`, or a value with `?`, `@`, `#` or a bad port. Expected: valid forms reach the device; bad forms get `400 invalid_request` (Task 6).
3. A device is busy and returns `503`, or closes the socket. Expected: `503 device_busy`, not `device_offline` (Task 4).
4. One saved device times out while the others answer. Expected: `GET /api/devices` returns all devices, with only that device `online: false`, and the slow device does not delay the response past its own time limit (Task 6).
5. A config write gets `401` or a timeout from the device. Expected: no reboot request, and `pending_reboot` does not change (Task 9).

---

## File structure

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.json, vite.config.ts, vitest.config.ts,
eslint.config.js, components.json, index.html, CONVENTIONS.md, .gitignore, .storybook/,
Dockerfile, compose.yaml, .dockerignore
shared/apiTypes.ts            API request/response types; the API contract in code
server/
  server.ts                   entry: loadConfig, openDb, buildApp, listen
  app.ts                      buildApp(deps): guards, static, SPA fallback, /api routes, error handler
  config.ts                   env → Config
  errors.ts                   ApiError, error body, messages, error handler
  requestGuard.ts             Host allow-list and CSRF guard
  requestLogSerializer.ts     logs method and path only
  db/database.ts              openDb, runMigrations
  db/migrations.ts            ordered SQL list (append-only)
  db/devices.ts               device row access
  db/preferences.ts           preference row access
  wled/deviceClient.ts        deviceRequest, fetchInfo, address recovery, result mapping
  wled/capabilities.ts        parseCapabilities, pinsFromCapabilities
  wled/configMerge.ts         checkUnsupported, mergeConfigPatch, topLevelBody, classifyChanges
  mdns.ts                     browseWled, resolveA (real implementations)
  routes/devices.ts           list, probe, add, delete
  routes/discovery.ts         discovery
  routes/settings.ts          info, config, unlock, capabilities, pins, scan, reboot, pending-reboot
  routes/control.ts           state, effects, palettes
  routes/preferences.ts       preferences
test/
  fakeWled.ts                 fake WLED device (Fastify, 127.0.0.1, random port)
  testApp.ts                  builds the app with a temp DB and mDNS doubles
  fixtures/seeds.ts           seeds from the design
  fixtures/sjsV015.txt, sjsV17.txt, sjsEthernet.txt, sjsUnsupported.txt
src/
  api/client.ts               browser API client, one function per mock api function
  store/                      makeStore with a devices slice; createApiThunk
  lib/, components/ui/, screens/homeScreen.tsx, screens/notFoundScreen.tsx
```

`buildApp` takes its dependencies, so tests replace mDNS, the clock and the database:

```ts
export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  mdns: { browseWled(windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]>;
          resolveA(host: string, timeoutMs: number): Promise<string | null> };
  now: () => Date;
  wledPort: number;      // 80 in production
  scanDelayMs: number;   // 1000 in production
}
export function buildApp(deps: AppDeps): FastifyInstance;
```

---

### Task 1: Scaffold the package from the template

review: yes. This task removes a large amount of template code. A leftover SSR, auth or analytics path is easy to miss.

**Files:**
- Copy from `~/Code/app-template/frontend`, then edit: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `components.json`, `index.html`, `.gitignore`, `.storybook/`, `src/**`, `server/server.ts`, `server/config.ts`, `server/requestLogSerializer.ts`
- Copy from `~/Code/app-template`: `pnpm-workspace.yaml` (keep `autoInstallPeers: false` and the build settings; no `packages:` list), the `packageManager` field of the root `package.json`
- Copy into `src/`: `packages/core/src/store/createApiThunk.ts`, `packages/core/src/lib/withActions.ts`, `packages/core/src/lib/reactCompat.ts`, and the tests of these three files
- Create: `server/app.ts`, `server/requestGuard.ts`, `src/store/index.ts`, `CONVENTIONS.md`
- Modify: `.gitignore`, `CLAUDE.md`
- Test: `server/app.test.ts`, `server/config.test.ts`, `server/requestGuard.test.ts`, `src/store/index.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config`, `Config = { port: number; dataDir: string; webDistDir: string; deviceTimeoutMs: number; discoveryWindowMs: number; allowedHosts: string[] | "*" }`. Env names: `PORT`, `DATA_DIR`, `WEB_DIST_DIR`, `DEVICE_TIMEOUT_MS`, `DISCOVERY_WINDOW_MS`, `ALLOWED_HOSTS`. A value that is set but is not a positive integer throws at start.
  - `AppDeps` and `buildApp(deps: AppDeps): FastifyInstance`, as above. Task 1 registers the request guard, the request log serializer, `bodyLimit: 32768`, static files, the SPA fallback, `Cache-Control: no-store` on `/api/*`, and the `/api` 404. Later tasks add route plugins in `server/routes/*.ts`, each `export async function <name>Routes(app: FastifyInstance, deps: AppDeps): Promise<void>`, registered in `buildApp`.
  - `registerRequestGuard(app: FastifyInstance, config: Config): void`.
  - Package scripts: `build` (client to `dist/`), `build:server` (server to `dist-server/`), `start` (`node dist-server/server.js`), `dev:build`, `dev`, `test`, `lint`, `typecheck`, `storybook`.
  - `src/store/index.ts`: `makeStore(reducers: ReducersMapObject)`, `RootState`, `AppDispatch`. Task 1 calls it with a placeholder `app` reducer that holds `{}`. Task 11 replaces the placeholder with `devicesSlice`.
  - `src/store/createApiThunk.ts` (`createApiThunk`), `src/lib/withActions.ts` (`withActions`), `src/lib/reactCompat.ts`, copied from the template core.

- [ ] **Step 1: Copy and strip.** Copy the files above. Then remove each item in spec §5 "Remove":
  - SSR: `src/entryServer.tsx`, `src/routeData.ts`, `src/routeRules.ts`, the `entryServer` build input, `ssrEntryPath`, `server/html.ts`.
  - Cookies, session and auth: `server/cookies.ts`, `server/session.ts`, `server/auth.test.ts`, `src/components/guards/`, `src/store/selectors/auth.ts`, the auth and example slices, `sessionGuardMiddleware`, `preloadedState`.
  - The core seam: `src/coreAdapter.ts`, and every `configureCore` / `configureWebCore` call in `src/testSetup.ts` and `.storybook/preview.ts`. Replace every `@apptemplate/core/...` import with the `src/` copy.
  - `server/proxy.ts`, `server/sitemap.ts`, `server/robots.ts`, `server/routeHead.ts`, `server/assetUrl.ts`, `server/clientIp.ts`, and their tests.
  - Analytics: `src/lib/analytics*`, `gtag*`, `startAnalytics*`, `toolConversionLatch*`, `pathAudience*`, `sensitiveQueryKeys.ts`, `analyticsProviders/`, `posthog-js`.
  - `src/screens/*` except `homeScreen.tsx` and `notFoundScreen.tsx`.
  - Dependencies `@fastify/cookie`, `@fastify/http-proxy`, `@apptemplate/core`.
- [ ] **Step 2: Rename and clean.** Rename the package to `strand`. Set `engines.node` to `>=24`. Remove the names "lawndominator", "app-template", "apptemplate" and `APP_TEMPLATE` (for example the `X-APP_TEMPLATE-VERSION` header) from code and comments. Reword the `autoInstallPeers: false` comment in `pnpm-workspace.yaml` to the recompose / React 19 reason only. Trim `server/requestLogSerializer.ts` so that it logs the method and the path with no query string, and has no import from `src/`. Pass it as `logger.serializers.req` in `buildApp`.
- [ ] **Step 3: `.gitignore`.** Keep the template entries (`node_modules`, `dist`, `dist-server`, `.DS_Store`) and add `data/`, `.tmp-data/`, `*.db`.
- [ ] **Step 4: Client entry.** `src/entryClient.tsx` uses `createRoot(...).render(...)`, not `hydrateRoot`. Routes: `/` → `homeScreen` (a placeholder that says "Strand"), `*` → `notFoundScreen`.
- [ ] **Step 5: Build scripts.** `build` = `vite build`. `build:server` = `vite build --ssr server/server.ts --outDir dist-server` (`--ssr` here only means "build for Node"). `start` = `node dist-server/server.js`. `dev:build` and `dev` keep the template's watch loop. `vite.config.ts` drops the `entryServer` input and keeps the client-build `react` alias.
- [ ] **Step 6: Design tokens.** Copy the CSS variables in the `<style>` block of `docs/design/strand-wled-spec.html` (light and dark) into `src/index.css` in the Tailwind v4 `@theme` form that the template uses. Add the `success`, `warning`, `warning-muted`, `danger` and `glow` colors.
- [ ] **Step 7: Write the failing tests.**
  - `server/app.test.ts`, with a temp `webDistDir` that holds `index.html` and `assets/a.js`, and `Host: localhost` on each request:
    - `GET /` → 200, the `index.html` body.
    - `GET /devices/abc/settings/network` → 200, the `index.html` body.
    - `GET /assets/a.js` → 200, the file body.
    - `GET /api/nope` → 404 `{ error: "not_found", message: "That page doesn't exist." }`, header `cache-control: no-store`.
    - `POST /devices/x` → 404 (the fallback is for `GET` only).
  - `server/config.test.ts`: an empty env gives `{ port: 3000, deviceTimeoutMs: 3000, discoveryWindowMs: 2500, allowedHosts: [] }` and `dataDir` ending in `data`. `PORT=abc` throws. `ALLOWED_HOSTS="a.example.com, b.ts.net"` gives `["a.example.com", "b.ts.net"]`. `ALLOWED_HOSTS="*"` gives `"*"`.
  - `server/requestGuard.test.ts` (an app with one `GET /api/x` and one `POST /api/x` route):
    - `Host: 192.168.1.10:3000`, `localhost:3000`, `strand.local` → `GET` 200.
    - `Host: evil.example.com` → 403 `{ error: "invalid_request" }`. With `allowedHosts: ["evil.example.com"]` → 200. With `"*"` → 200.
    - `POST` with `Host: localhost`, no `X-Strand-Request` → 403. With `X-Strand-Request: 1` → 200. With that header and `Origin: http://evil.example.com` → 403. With `Origin: http://localhost:3000` → 200.
    - `GET /` (not `/api`) with `Host: evil.example.com` → 200 (the guard covers `/api` only).
  - `src/store/index.test.ts`: `makeStore({ app: (s = {}) => s }).getState()` is `{ app: {} }`.
- [ ] **Step 8: Implement** `buildApp`, `registerRequestGuard`, `server/server.ts` and the store until the tests pass. The app tests pass `new DatabaseSync(":memory:")` as `db` and mDNS stubs that return `[]` and `null`. `server.ts` listens on `0.0.0.0:config.port`, and also passes those mDNS stubs, `now: () => new Date()`, `wledPort: 80` and `scanDelayMs: 1000`. Task 3 replaces the database it opens with `openDb`. Task 5 replaces the mDNS stubs. Remove Fastify's `text/plain` content-type parser so that `/api` accepts only `application/json` bodies.
- [ ] **Step 9: Write `CONVENTIONS.md`.** Merge the template's root `CONVENTIONS.md` §4 (naming), §5 (commits), §6 (tests, type gate, one source of truth) and §8 (formatting), and the parts of `frontend/CONVENTIONS.md` that still apply: the no-`NODE_ENV` rule, the hooks rule, Storybook-first, shadcn primitives, the dev loop. Rewrite the dev-loop commands for this package. Do not keep the sections on SSR, cookies, access policy, the three SEO registries, path identities, the asset CDN, or analytics. Add these sections:
  - "API client": `src/api/client.ts` is hand-written and replaces the generated client. Thunks call it through `createApiThunk`. `shared/apiTypes.ts` is the one source of the API types.
  - "Server": routes are Fastify plugins in `server/routes/`. Each one throws `ApiError` for an expected failure. Requests to devices go through `server/wled/deviceClient.ts` only.
  - "Migrations": `server/db/migrations.ts` is append-only. Never edit or reorder an entry that is committed. A change is a new entry.
- [ ] **Step 10: Update `CLAUDE.md`.** Replace the "No code exists yet" paragraph and its "no build, lint, or test commands" sentence with the commands from Step 11. Change the database line to the schema of spec §7 plus the `port` column. Add `ALLOWED_HOSTS` and the reverse-proxy note (Plan decision 1) to the architecture constraints. Point to `CONVENTIONS.md`.
- [ ] **Step 11: Verify.** `pnpm install`, then `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:server`. All pass. `grep -rniE "posthog|gtag|cookie|entryServer|hydrateRoot|app[-_]?template|lawn" src server .storybook package.json` returns nothing.
- [ ] **Step 12: Commit.** Stage the files of this task by path, plus `pnpm-lock.yaml`. Then `git commit -m "chore(repo): scaffold strand package from the app template"`.

### Task 2: Shared API types and errors

review: no

**Files:**
- Create: `shared/apiTypes.ts`, `server/errors.ts`
- Modify: `server/app.ts` (register the error handler)
- Test: `server/errors.test.ts`

**Interfaces:**
- Consumes: `buildApp`, `AppDeps` (Task 1).
- Produces, in `shared/apiTypes.ts`:
  - `Device`, `DiscoveredDevice`, `WledInfo`, `WledConfig`, `WifiEntry` (with `psk?: string`), `ApConfig` (with `psk?: string`), `LedOutput`, `SyncConfig`, `Capabilities`, `PinInfo`, `WifiNetwork`. Copy the field lists from the design file: `toDevice` (line 670), `info` (line 711), the seed `config` objects, `capabilitiesFor` (line 346) and `pinsFor` (line 350).
  - `WledConfigFull = Record<string, unknown>` (the whole `/json/cfg` object, as the device returns it).
  - `DeepPartial<T>` and `ConfigPatch = DeepPartial<WledConfig>`.
  - `Preset = { id: number; name: string }`, `Effect = { id: number; name: string; meta: string }`, `Palette = { id: number; name: string }`.
  - `ErrorCode` (the union of the codes in spec §8.1), `ApiErrorBody = { error: ErrorCode; message: string }`.
- Produces, in `server/errors.ts`:
  - `class ApiError extends Error { status: number; code: ErrorCode; constructor(status: number, code: ErrorCode, message: string) }`.
  - `messages`: `notFound()`, `deviceOffline(name)`, `deviceBusy(name)`, `deviceError(name, detail)`, `noDevice(host)`, `alreadyAdded(name)`, `pinRequired()`, `wrongPin()`, `invalidRequest()`, each returning `string`, with the texts in "Verified external API".
  - `registerErrorHandler(app: FastifyInstance): void`. It sends an `ApiError` as `status` + `{ error, message }` and adds `Retry-After: 1` for `device_busy`. It sends a Fastify error with `statusCode` 400-499 (bad JSON, empty JSON body, 413, 415, schema validation) as the same status with `{ error: "invalid_request", message: messages.invalidRequest() }`, and does not log it. It sends any other error as `500 { error: "device_error", message: "Something went wrong on the server." }` and logs only `{ err: { message, stack } }`.

- [ ] **Step 1: Write the failing tests.**
  - A route that throws `new ApiError(503, "device_busy", "x")` → status 503, header `retry-after: 1`, body `{ error: "device_busy", message: "x" }`.
  - A route that throws `new Error("boom")` → 500, code `device_error`.
  - `POST` with the body `{"pin":"12` (bad JSON) → 400 `invalid_request`. A log capture (a pino destination stream) contains no `12`.
  - A 40 KB body → 413 `invalid_request`.
  - `messages.deviceOffline("Backyard")` === `"Backyard isn't responding."`.
- [ ] **Step 2: Run** `pnpm test server/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two files. Register the handler in `buildApp`. The 404 handler for `/api` uses `ApiError(404, "not_found", ...)`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/errors.test.ts server/app.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add shared API types and error responses`

### Task 3: SQLite database and repositories

review: yes (schema and migrations)

**Files:**
- Create: `server/db/database.ts`, `server/db/migrations.ts`, `server/db/devices.ts`, `server/db/preferences.ts`
- Modify: `server/server.ts` (open the DB at `<dataDir>/strand.db`; create `dataDir` if it is missing)
- Test: `server/db/database.test.ts`, `server/db/devices.test.ts`, `server/db/preferences.test.ts`

**Interfaces:**
- Consumes: `AppDeps` (Task 1).
- Produces:
  - `runMigrations(db: DatabaseSync, list: string[]): void`. It applies each entry after `user_version` in its own transaction, with `PRAGMA user_version = n` inside that transaction. On an error it rolls back that entry and rethrows.
  - `openDb(path: string): DatabaseSync`. It opens the file (or `":memory:"`), runs `PRAGMA foreign_keys = ON`, and calls `runMigrations(db, migrations)`.
  - `migrations: string[]`. Entry 1 is the SQL of spec §7 plus `port INTEGER NOT NULL DEFAULT 80` in `devices`.
  - `type DeviceRow = { id: string; mac: string; name: string; host: string; port: number; lastIp: string; lastSeen: string | null; pendingReboot: string[]; pendingSince: string | null; createdAt: string; updatedAt: string }`.
  - `devices`: `list(db): DeviceRow[]` (order by `created_at, rowid`), `get(db, id): DeviceRow | undefined`, `getByMac(db, mac): DeviceRow | undefined`, `insert(db, row: { mac: string; name: string; host: string; port: number; lastIp: string }, now: Date): DeviceRow` (id from `crypto.randomUUID()`), `remove(db, id): boolean`, `recordSeen(db, id, seen: { name: string; lastIp: string }, now: Date): void` (sets `last_seen` too), `setLastIp(db, id, lastIp: string, now: Date): void`, `addPendingReboot(db, id, names: string[], now: Date): void` (union with the current list, keeps order, sets `pending_since` to `now`), `clearPendingReboot(db, id, now: Date): void`.
  - `preferences`: `getAll(db): Record<string, unknown>`, `count(db): number`, `has(db, key): boolean`, `put(db, key: string, value: unknown, now: Date): void`.

- [ ] **Step 1: Write the failing tests.**
  - `openDb(":memory:")` sets `user_version` to `migrations.length`. Opening the same file twice does not run a migration again.
  - `runMigrations(db, ["CREATE TABLE a(x)", "BROKEN SQL"])` throws, and `user_version` is then `1`, and table `a` exists.
  - `insert` then `get` and `getByMac` return the row. A second `insert` with the same MAC throws.
  - `list` returns rows in insert order, also when `now` is the same for all of them.
  - `remove` returns `true`, then `false`.
  - `recordSeen` changes `name`, `lastIp` and `lastSeen`. `setLastIp` changes only `lastIp` and `updatedAt`.
  - `addPendingReboot(["hostname"])` then `addPendingReboot(["static IP", "hostname"])` gives `["hostname", "static IP"]`. `clearPendingReboot` gives `[]` and `pendingSince: null`.
  - `preferences.put("fav", ["Chase"])` then `getAll()` gives `{ fav: ["Chase"] }`. `count()` is 1. `put` on the same key replaces the value.
- [ ] **Step 2: Run** `pnpm test server/db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use only prepared statements with parameters. Store `pending_reboot` as JSON text.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/db`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add sqlite device registry and preferences`

### Task 4: Fake WLED device and device client

review: yes (error mapping and address recovery are the base of every route)

**Files:**
- Create: `test/fakeWled.ts`, `test/fixtures/seeds.ts`, `test/testApp.ts`, `server/wled/deviceClient.ts`, `test/fixtures/sjsV015.txt`, `test/fixtures/sjsV17.txt`, `test/fixtures/sjsEthernet.txt`, `test/fixtures/sjsUnsupported.txt`
- Test: `server/wled/deviceClient.test.ts`

**Interfaces:**
- Consumes: `AppDeps`, `Config`, `buildApp` (Task 1); `ApiError`, `messages`, `WledInfo` (Task 2); `openDb`, `devices`, `DeviceRow` (Task 3).
- Produces, `test/fixtures/sjs*.txt`: the `s.js?p=2` samples. Build each one from the format in "Verified external API": `function GetV(){var d=document;d.um_p=[-1];d.rsvd=[6,7,8,9,10,11];d.ro_gpio=[34,35,36,37,38,39];d.max_gpio=40;...d.ledTypes=[{i:22,c:1,t:"D",n:"WS281x"},{i:30,c:3,t:"D",n:"SK6812/WS2814 RGBW"},{i:45,c:7,t:"AAAAA",n:"PWM RGBCCT"}];bLimits(...);...}`. Use 8 arguments in `sjsV015.txt` (`32,3,2048,87040,16384,10,16,16`) and 10 in `sjsV17.txt` (`0,2048,87040,16384,10,16,8,8,16,4`). `sjsEthernet.txt` has `d.rsvd=[6,7,8,];`. `sjsUnsupported.txt` has 9 `bLimits` arguments. The fake serves `s.js?p=3` as `function GetV(){var d=document;}`.
- Produces, `test/fixtures/seeds.ts`: `seeds`, the five seeds of the design (`SEEDS`, lines 375-556), as WLED-shaped data per seed: `info` (the output of the mock's `info()`, plus `brand: "WLED"`), `cfg` (the seed `config`, plus `hw.btn`, `hw.ir`, `hw.relay`, `if.mqtt`, `if.ntp` stubs so that subtree tests can see them), `state`, `presets` (a `presets.json` object), `effects`, `fxdata`, `palettes`, `pins` (from the mock's `pinsFor`), `networks` (the design's `AIRWAVES`, line 362).
- Produces, `test/fakeWled.ts`: `startFakeWled(seed, opts?: FakeOpts): Promise<FakeWled>`:
  - `FakeOpts = { pin?: string; version?: "0.15" | "17"; nodes?: { ip: string }[]; sjs?: string; scanEmptyCalls?: number; infoOverride?: object }`. Defaults: version `"17"`, no PIN, no nodes, the `sjsV17.txt` or `sjsV015.txt` fixture for the version, `scanEmptyCalls` 2.
  - `FakeWled = { port: number; requests: { method: string; path: string; body: unknown }[]; setMode(m: FakeMode): void; failNext(m: FakeMode, match: { method?: string; path?: string; skip?: number }): void; restart(): void; cfg: Record<string, unknown>; state: Record<string, unknown>; close(): Promise<void> }`.
  - `FakeMode = "ok" | "timeout" | "busy" | "reset" | "deviceError" | "notJson" | "serverError" | "huge"`. `setMode` applies to every later request. `failNext` applies the mode to one later request that matches `method` and `path`, after `skip` matching requests (default 0). Then the fake goes back to its current mode.
  - It listens on `127.0.0.1` with `forceCloseConnections: true`, and `close()` destroys any open socket. It serves every WLED endpoint in "Verified external API" from the seed. With `version: "0.15"`, `/json/pins` returns the full `/json` reply with no `pins` key.
  - It applies `POST /json/cfg` with the firmware rules: top-level keys replace, `nw.ins` never shrinks, an empty client `psk` is ignored, `ap.psk` is copied.
  - It implements the PIN: `401` on `POST /json/cfg` and on `s.js?p>0` while locked. A body `"pin"` that matches unlocks it.
  - `restart()` sets `info.uptime` to 0 and keeps counting from there.
  - Modes: `"timeout"` never answers; `"busy"` returns `503`; `"reset"` destroys the socket; `"deviceError"` returns `200 {"error":3}`; `"notJson"` returns `200 <html>`; `"serverError"` returns `500`; `"huge"` streams 2 MB with status `200`.
- Produces, `test/testApp.ts`: `makeTestApp(opts?: { browse?: AppDeps["mdns"]["browseWled"]; resolveA?: AppDeps["mdns"]["resolveA"]; now?: () => Date; wledPort?: number; allowedHosts?: string[] | "*" }): { app: FastifyInstance; deps: AppDeps; db: DatabaseSync; addFake(f: FakeWled, seed, host?: string): DeviceRow; inject(opts): Promise<LightMyRequestResponse> }`. Config: `deviceTimeoutMs: 300`, `discoveryWindowMs: 50`, `scanDelayMs: 1`. `inject` adds `Host: localhost`, `X-Strand-Request: 1` and `Content-Type: application/json` when there is a body.
- Produces, `server/wled/deviceClient.ts`:
  - `type DeviceTarget = { id?: string; name: string; host: string; port: number; lastIp: string; mac?: string }`.
  - `deviceRequest<T>(deps: AppDeps, target: DeviceTarget, path: string, init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; parse?: "json" | "text"; recover?: boolean }): Promise<T>`. `recover` defaults to `true`.
  - `fetchInfo(deps: AppDeps, ip: string, port: number): Promise<WledInfo | null>`. It returns `null` for any failure, or a reply that is not WLED: `brand !== "WLED"`, `mac` not `^[0-9a-f]{12}$`, or no `ver`. It cuts `name` to 64 characters.
  - `isPrivateIpv4(ip: string): boolean` (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8).

- [ ] **Step 1: Write the failing tests** for `deviceRequest` against a fake:
  - `"ok"`: returns the parsed JSON.
  - `"timeout"`: throws `ApiError` 504 `device_offline`, message "Backyard isn't responding.", in less than `timeoutMs + 200` ms.
  - `"busy"` and `"reset"`: throw 503 `device_busy`.
  - A closed port: throws 504 `device_offline`.
  - `"deviceError"`: throws 502 `device_error`, and the message contains `3`.
  - `"notJson"` and `"serverError"`: throw 502 `device_error`.
  - A `401` (locked fake, `GET /settings/s.js?p=3`): throws 401 `pin_required`.
  - `"huge"` (2 MB): throws 502 `device_error`.
  - The URL is built with `new URL()`: a `path` that is not one of the fixed device paths is a programming error, so `deviceRequest` asserts that `path` starts with `/`.
  - Review Focus 1: the row has `lastIp: "192.0.2.1"` (unreachable), `host: "wled-backyard.local"`, and the fake's port. `resolveA` returns `127.0.0.1`, and the fake's MAC matches. The request succeeds, and `devices.get(id).lastIp` becomes `127.0.0.1`.
  - The same case, but the fake's MAC is different: throws 504, and `lastIp` does not change.
  - The same case with `recover: false`: throws 504, and `resolveA` is not called.
  - `fetchInfo` on a fake with `infoOverride: { brand: "Other" }`, and with `infoOverride: { mac: "ZZ" }` → `null`.
- [ ] **Step 2: Run** `pnpm test server/wled/deviceClient.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the fixtures, the fake, the seeds, `makeTestApp` and the client by spec §9. The client uses the global `fetch`, so tests can spy on it. Map errors: a `TimeoutError`, or `err.cause.code` in `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN`, `EADDRNOTAVAIL`, `UND_ERR_CONNECT_TIMEOUT` → offline. `ECONNRESET`, `UND_ERR_SOCKET`, or status `503` → busy. Any other fetch failure → offline. Address recovery runs only for an offline error, only when `recover` is true, `host` ends in `.local`, and the target has an `id` and a `mac`, and only one time. Read the body as a stream and stop after 1 MB.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add WLED device client and fake device for tests`

### Task 5: mDNS functions

review: no

**Files:**
- Create: `server/mdns.ts`
- Modify: `server/server.ts` (pass the real `mdns` to `buildApp`), `package.json` (add `bonjour-service@1.4.4`, `multicast-dns@7.2.5`, `@types/multicast-dns@7.2.4` with the `^` ranges the template uses)
- Test: `server/mdns.test.ts`

**Interfaces:**
- Consumes: `AppDeps` (Task 1).
- Produces: `browseWled(windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]>` and `resolveA(host: string, timeoutMs: number): Promise<string | null>`, as "Verified external API" describes. Both create their sockets per call and destroy them before they return. Both resolve (never reject) when the network has no mDNS.

- [ ] **Step 1: Write the test.** `browseWled(50)` resolves to an array in less than 500 ms. `resolveA("strand-test-nonexistent.local", 100)` resolves to `null`. These tests check that the functions end and clean up. They do not need a real device.
- [ ] **Step 2: Implement.** Keep only IPv4 addresses. In `resolveA`, ignore answers whose `name` is not the requested host. If `pnpm install` reports a blocked build script for either package, the package needs no build; leave it blocked.
- [ ] **Step 3: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/mdns.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit.** `feat(server): add mDNS browse and A-record lookup`

### Task 6: Device routes: list, probe, add, delete

review: yes (public API, input handling)

**Files:**
- Create: `server/routes/devices.ts`
- Modify: `server/app.ts` (register `devicesRoutes`)
- Test: `server/routes/devices.test.ts`

**Interfaces:**
- Consumes: `deviceRequest`, `fetchInfo`, `DeviceTarget`, `makeTestApp`, `startFakeWled`, `seeds` (Task 4); `devices`, `DeviceRow` (Task 3); `ApiError`, `messages`, `Device`, `DiscoveredDevice` (Task 2); `AppDeps` (Task 1).
- Produces: `devicesRoutes(app, deps)`. It also exports:
  - `normalizeHost(input: string, defaultPort: number): { host: string; port: number } | null`.
  - `toDevice(row: DeviceRow, live: { online: boolean; locked: boolean }, now: Date): Device`.
  - `targetOf(row: DeviceRow): DeviceTarget`.
  - `lockCheck(deps: AppDeps, target: DeviceTarget, recover?: boolean): Promise<boolean>` (true when locked).

- [ ] **Step 1: Write the failing tests.**
  - `GET /api/devices` with three saved fakes (Backyard; Front Roof with PIN `1234`; Desk Lamp in `"timeout"`): three devices in insert order. Backyard is `online: true, pinLocked: false`. Front Roof is `pinLocked: true`. Desk Lamp is `online: false, pinLocked: false`, and `lastSeen` is the stored value.
  - Review Focus 4: with Desk Lamp in `"timeout"`, the response arrives in less than `2 × deviceTimeoutMs + 300` ms.
  - `GET /api/devices` updates `name` and `last_seen` of each online device.
  - `normalizeHost` (Review Focus 2), with `defaultPort` 80:
    - `"HTTP://192.168.1.42/"` → `{ host: "192.168.1.42", port: 80 }`.
    - `"192.168.1.42:8080"` → port 8080.
    - `"Wled-Backyard"` → `{ host: "wled-backyard", port: 80 }`.
    - `"wled-backyard.local"` → the same name, port 80.
    - `"  "`, `"a b"`, `"1.2.3.4?x="`, `"user@host"`, `"host#x"`, `"[::1]"`, `"host:0"`, `"host:99999"`, `"host:ab"`, and a 254-character name → `null`.
  - `POST /api/devices/probe { host: "127.0.0.1:<port>" }` → `DiscoveredDevice` with `alreadyAdded: false` and `ip: "127.0.0.1"`.
  - Probe of a bare name, with `wledPort` set to the fake's port: `"wled-backyard"`, where `resolveA("wled-backyard.local")` returns `127.0.0.1` → success, `host: "wled-backyard.local"`.
  - Probe of a closed port → `404 no_device`, message with the typed host.
  - Probe of a fake with `infoOverride: { brand: "Other" }` → `404 no_device`.
  - Probe `{ host: "a b" }`, `{}`, `{ host: 5 }` → `400 invalid_request`.
  - `POST /api/devices` → 201 `Device`, and the row has `lastIp: "127.0.0.1"` (the reached address, Plan decision 2), not the seed's `info.ip`. The same host again → `409 already_added`, message "Backyard is already in your devices.".
  - `DELETE /api/devices/:id` → 204. Again → `404 not_found`.
- [ ] **Step 2: Run** `pnpm test server/routes/devices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.2.
  - The list sends, for each device at the same time (`Promise.allSettled`), one `deviceRequest` for `/json/info` with `recover: false`, then the lock check with `recover: false`. Recovery is off in the list so that one moved device does not slow the dashboard. Discovery and every single-device endpoint still recover the address.
  - `normalizeHost` accepts only an IPv4 address or an RFC 1123 host name (letters, digits, `-` and `.`, at most 253 characters), and an optional port from 1 to 65535.
  - A host name that is not an IP is resolved: `.local` names through `resolveA`, other names through `node:dns/promises` `lookup` (IPv4). A bare name with no dot tries `<name>.local` first.
  - Use a Fastify JSON schema for each body: `{ host: string, maxLength 300 }`, `additionalProperties: false`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/devices.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add device list, probe, add and delete endpoints`

### Task 7: Discovery

review: no

**Files:**
- Create: `server/routes/discovery.ts`
- Modify: `server/app.ts` (register `discoveryRoutes`)
- Test: `server/routes/discovery.test.ts`

**Interfaces:**
- Consumes: `AppDeps.mdns.browseWled`, `AppDeps.wledPort` (Task 1); `deviceRequest`, `fetchInfo`, `isPrivateIpv4`, `makeTestApp`, `startFakeWled`, `seeds` (Task 4); `devices` (Task 3); `DiscoveredDevice` (Task 2); `targetOf` (Task 6).
- Produces: `discoveryRoutes(app, deps)`.

- [ ] **Step 1: Write the failing tests.**
  - `browse` returns Garage and Backyard (two fakes). Backyard is saved. The result has both, and only Backyard has `alreadyAdded: true`. `host` is `"wled-garage.local"` for Garage.
  - `browse` returns `[]`. A saved fake has `nodes: [{ ip: "127.0.0.1" }]`, and `wledPort` is the port of a second fake. The result has the second fake.
  - `browse` returns an address that does not answer, an address that is not WLED, and a public address (`8.8.8.8`). The result leaves out all three, and the server sends no request to `8.8.8.8`.
  - `browse` returns 100 addresses. The server sends at most 64 `/json/info` requests. This test and the `8.8.8.8` test spy on `globalThis.fetch` to count the requests.
  - The same MAC found through mDNS and through nodes appears once.
  - A saved device found at a new address gets its `last_ip` updated.
  - A device whose `id.mdns` is `""`: `host` is its IP.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.2.2. Run `browseWled` and the `/json/nodes` requests at the same time. Keep only private IPv4 addresses (`isPrivateIpv4`). Remove duplicate candidates by `ip:port` (the tests run all fakes on `127.0.0.1` with different ports), and keep at most 64. After the info requests, remove duplicate devices by MAC. Then run every `fetchInfo` at the same time. The `/json/info` reply has no mDNS name. Take it from the browse result (`service.host`). For an address that came from nodes, send `GET /json/cfg` and read `id.mdns`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/discovery.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add WLED discovery endpoint`

### Task 8: Read-only settings endpoints and the capabilities parser

review: yes (the parser reads text from the device)

**Files:**
- Create: `server/wled/capabilities.ts`, `server/routes/settings.ts`
- Modify: `server/app.ts` (register `settingsRoutes`), `shared/apiTypes.ts` (remove `Preset`; `WledConfig.def` becomes `{ on: boolean; bri: number }`), `test/fixtures/seeds.ts` (the seed config type keeps `def.ps`, because the device has it)
- Test: `server/wled/capabilities.test.ts`, `server/routes/settings.test.ts`

**Interfaces:**
- Consumes: `deviceRequest`, `makeTestApp`, `startFakeWled`, `seeds`, the `sjs*.txt` fixtures (Task 4); `targetOf`, `lockCheck` (Task 6); `devices`, `DeviceRow` (Task 3); `ApiError`, `messages`, `Capabilities`, `PinInfo`, `WledInfo`, `WledConfig`, `WledConfigFull`, `WifiNetwork` (Task 2).
- Produces:
  - `parseCapabilities(text: string): (Capabilities & { maxGpio: number }) | null`.
  - `pinsFromCapabilities(caps: Capabilities & { maxGpio: number }, cfg: WledConfigFull): PinInfo[]`. GPIOs `0` to `maxGpio - 1`, without `reservedPins`. `c` has 0x20 for `inputOnlyPins`. `a: true, n: "LEDs"` for each pin in `hw.led.ins[].pin`, and `n: "Button"`, `"IR"`, `"Relay"` for `hw.btn.ins[].pin`, `hw.ir.pin`, `hw.relay.pin` when they are 0 or more.
  - `settingsRoutes(app, deps)` with the read endpoints: `GET info`, `GET config`, `GET capabilities`, `GET pins`, `POST networks/scan`. There is no `GET presets` (Decision 1). Task 9 adds the write endpoints to the same file.
  - `loadDevice(deps: AppDeps, id: string): DeviceRow`. It throws `404 not_found`.
  - `readInfo(deps: AppDeps, row: DeviceRow): Promise<WledInfo>`. It sends `GET /json/info` and calls `devices.recordSeen` (spec §7).

- [ ] **Step 1: Write the failing tests.** They use the `sjs*.txt` fixtures from Task 4.
  - `parseCapabilities` on `sjsV015.txt` → `limits` `{ maxLedsPerOutput: 2048, ledMemoryBytes: 87040, maxLeds: 16384, maxDigitalOutputs: 16, maxPwmPins: 16 }`, `reservedPins` `[6,…,11]`, `inputOnlyPins` `[34,…,39]`, `maxGpio: 40`, three `ledTypes` with `i`, `c`, `t`, `n`.
  - `sjsV17.txt` → the same `limits`.
  - `sjsEthernet.txt` → `reservedPins` `[6,7,8]`.
  - `sjsUnsupported.txt` → `null`. A text with no `d.ledTypes` → `null`. A text with `d.ledTypes=[{i:1,c:` (cut off) → `null`.
  - `pinsFromCapabilities` with the Backyard config → GPIO 16 and 17 are `a: true, n: "LEDs"`, GPIO 6 is absent, GPIO 34 has `c & 0x20`.
  - `GET capabilities` on a locked fake → `401 pin_required`. On a fake with `sjs: sjsUnsupported` → `502 device_error`, and the message says the firmware version is not supported.
  - `GET pins` on a v17 fake → the fake's `pins`. On a v0.15 fake → the list from `pinsFromCapabilities`. On a locked v0.15 fake → `401 pin_required`.
  - `GET config` returns only the keys `id, nw, ap, def, light, hw, if`, with `def` = `{ on, bri }` (no `ps`), `hw` = `{ led }` and `if` = `{ sync }`.
  - `GET info` returns `WledInfo` and updates `last_seen`.
  - `GET /api/devices/:id/presets` → `404 not_found` (the `/api` 404).
  - `POST networks/scan`: the fake returns `[]` two times, then the seed's `networks` → the five networks. With `scanEmptyCalls: 99` → `{ networks: [] }` after 10 requests.
  - Each endpoint for an unknown `:id` → `404 not_found`. For an offline device → `504 device_offline`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.3 and "Verified external API". The parser does not run the text. The scan waits `deps.scanDelayMs` between requests. Remove `Preset` from `shared/apiTypes.ts`, and `ps` from `WledConfig.def` (Decisions 2 and 3). In `test/fixtures/seeds.ts`, change the type of `Seed.config` to `WledConfig & { def: WledConfig["def"] & { ps: number } }`, so the fake's `/json/cfg` still has `def.ps`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled/capabilities.test.ts server/routes/settings.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add settings read endpoints and capabilities parser`

### Task 9: Config write, pending reboot, reboot, unlock

review: yes (writes device configuration; data integrity)

**Files:**
- Create: `server/wled/configMerge.ts`
- Modify: `server/routes/settings.ts`
- Test: `server/wled/configMerge.test.ts`, `server/routes/settings.test.ts`

**Interfaces:**
- Consumes: `loadDevice`, `readInfo` (Task 8); `deviceRequest`, `makeTestApp`, `startFakeWled` (Task 4); `targetOf`, `lockCheck` (Task 6); `devices.addPendingReboot`, `devices.clearPendingReboot` (Task 3); `ApiError`, `messages`, `WledConfig`, `WledConfigFull`, `ConfigPatch` (Task 2).
- Produces:
  - `CONFIG_KEYS = ["id", "nw", "ap", "def", "light", "hw", "if"] as const`.
  - `checkUnsupported(current: WledConfigFull, patch: ConfigPatch): string | null`. It returns a message, or `null`.
  - `mergeConfigPatch(current: WledConfigFull, patch: ConfigPatch): WledConfigFull`. Objects merge deeply. Arrays and scalars in `patch` replace. It skips the keys `__proto__`, `constructor` and `prototype`.
  - `topLevelBody(merged: WledConfigFull, patch: ConfigPatch): WledConfigFull`. For each top-level key of `patch`, the full merged subtree.
  - `classifyChanges(before: WledConfigFull, after: WledConfigFull, patch: ConfigPatch): { reconnect: boolean; reboot: string[] }`. The rules are spec §8.3 step 7, which copies `wifiChanged` (design line 759) and `getPendingReboot` (line 929). Names: `"hostname"`, `"static IP"`.
  - Routes: `PATCH config`, `POST unlock`, `POST reboot`, `GET pending-reboot`.

- [ ] **Step 1: Write the failing unit tests** for `configMerge.ts`:
  - `topLevelBody` of the patch `{ hw: { led: { maxpwr: 850 } } }` contains the full `hw`, with `btn`, `ir`, `relay`, and `led.ins` unchanged.
  - A patch with `hw.led.ins` of one entry replaces a list of two.
  - `mergeConfigPatch` with `JSON.parse('{"__proto__":{"x":1}}')` does not change `Object.prototype`.
  - `checkUnsupported`: 2 current networks and a patch with 1 → message. A client entry `psk: ""` where `pskl > 0` → message. `ap.psk: ""` → `null`.
  - `classifyChanges`: a new SSID → `reconnect`. A `psk` on an entry → `reconnect`. `ap.chan` changed → `reconnect`. `id.mdns` changed → `reboot: ["hostname"]`. A static IP added → `reboot: ["static IP"]`. `def.bri` changed → neither.
- [ ] **Step 2: Write the failing route tests** against the fake. Use `makeTestApp({ now })` with a clock the test moves.
  - `PATCH config { hw: { led: { maxpwr: 850 } } }` → exactly one `POST /json/cfg` in `fake.requests`, whose body has the full `hw` object and no other key. The response is the re-read config, with `maxpwr: 850`.
  - `PATCH config` with a new SSID → `fake.requests` is exactly `GET /json/cfg`, `POST /json/cfg`, `GET /json/cfg`, `POST /json/state {"rb":true}`. `pending_reboot` is empty afterward.
  - The same, with `fake.failNext("timeout", { method: "POST", path: "/json/state" })` → 200 with the config, and `GET pending-reboot` includes `"Wi-Fi"` (Plan decision 7).
  - `PATCH config { id: { mdns: "porch" } }` → no reboot request. `GET pending-reboot` → `["hostname"]`. Move the clock forward 10 s, call `fake.restart()`, and `GET pending-reboot` → `[]`, and the DB value is cleared.
  - `GET pending-reboot` with nothing pending → `[]`, and the fake gets no request.
  - `GET pending-reboot` while the device is offline → the stored list.
  - Review Focus 5: a locked fake → `401 pin_required`, no `rb` request, and `pending_reboot` does not change. The same for a fake in `"timeout"` → `504`.
  - The write succeeds but the re-read times out (`fake.failNext("timeout", { method: "GET", path: "/json/cfg", skip: 1 })`) → `504 device_offline`, and no `rb` request.
  - A shorter `nw.ins` → `422 unsupported_change`, and the fake gets no `POST`.
  - A body `{ ota: { lock: false } }`, `[]`, `{ hw: 5 }`, `{ def: { ps: 250 } }`, or `{ def: { on: true, ps: 1 } }` → `400 invalid_request`, and the fake gets no `POST`.
  - `PATCH config { def: { bri: 200 } }` → the `POST /json/cfg` body has the full `def`, with the device's current `ps` unchanged.
  - `POST unlock { pin: "1234" }` on a locked fake → 204, then `PATCH config` succeeds. `{ pin: "0000" }` → `401 wrong_pin`. On a fake with no PIN → 204. `{}`, `{ pin: "12" }`, `{ pin: 1234 }` → `400 invalid_request`.
  - `POST reboot` → 204, the fake got `{"rb":true}`, and `pending_reboot` is cleared.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** by spec §8.3 "Config write", "Pending reboot", "Unlock" and "Reboot".
  - Check the body first: a plain object whose keys are all in `CONFIG_KEYS` and whose values are plain objects, and a `def` (if present) whose keys are only `on` and `bri` (Decision 4). Otherwise, `400 invalid_request`.
  - If the re-read in step 6 fails, return that device error and send no reboot.
  - If the reboot in step 8 fails, return 200 with the config, and add `"Wi-Fi"` to `pending_reboot`.
  - The device "started after `pending_since`" when `deps.now() - info.uptime * 1000 > pending_since`. `GET pending-reboot` reads info through `readInfo`.
  - Unlock body schema: `{ pin: string, pattern ^[0-9]{4}$ }`, `additionalProperties: false`.
- [ ] **Step 5: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled/configMerge.test.ts server/routes/settings.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(server): add config write, unlock, reboot and pending reboot`

### Task 10: Control and preferences endpoints

review: no

**Files:**
- Create: `server/routes/control.ts`, `server/routes/preferences.ts`
- Modify: `server/app.ts` (register both), `shared/apiTypes.ts` (add `StatePatch`)
- Test: `server/routes/control.test.ts`, `server/routes/preferences.test.ts`

**Interfaces:**
- Consumes: `loadDevice` (Task 8); `targetOf` (Task 6); `deviceRequest`, `makeTestApp`, `startFakeWled`, `seeds` (Task 4); `preferences` (Task 3); `ApiError`, `messages`, `Effect`, `Palette` (Task 2).
- Produces: `controlRoutes(app, deps)` (`GET state`, `PATCH state`, `GET effects`, `GET palettes`); `preferencesRoutes(app, deps)` (`GET /api/preferences`, `PUT /api/preferences/:key`); `StatePatch = { on?: boolean; bri?: number }` in `shared/apiTypes.ts` (Decision 5).

- [ ] **Step 1: Write the failing tests.**
  - `PATCH state { on: false }` → the fake got exactly `{ on: false, v: true }`. The response is the fake's full state.
  - `PATCH state { bri: 128 }` → the fake got exactly `{ bri: 128, v: true }`.
  - `PATCH state` with `{}`, `{ pin: "1234" }`, `{ rb: true }`, `{ ps: 1 }`, `{ seg: [{ id: 0, on: false }] }`, `{ on: false, tt: 0 }`, `{ on: "false" }`, `{ bri: 256 }`, `{ bri: 1.5 }` or `[1]` → `400 invalid_request`, and the fake gets no `POST`.
  - `GET effects` with names `["Solid","RSVD","Blink"]` and fxdata `["","","!,;!;"]` → `[{id:0,name:"Solid",meta:""},{id:2,name:"Blink",meta:"!,;!;"}]`.
  - `GET palettes` → `{ id, name }[]` by index.
  - `PUT /api/preferences/fav { value: ["Chase"] }` → 204, then `GET` → `{ fav: ["Chase"] }`. Key `"a b"` → 400. A value over 64 KB → 400. A 257th new key → 400. A `PUT` on an existing key when there are 256 keys → 204.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by spec §8.4 and §8.5. `PUT /api/preferences/:key` uses `bodyLimit: 71680`.
  - Check the `PATCH state` body in the handler: a plain object with at least one key, each key `on` or `bri`, `on` a boolean, `bri` an integer from 0 to 255. Otherwise, `400 invalid_request`. `buildApp` sets the Ajv options `coerceTypes: false` and `removeAdditional: false` (Task 6), so a body schema rejects unknown keys and wrong types. The handler check stays for the rules a schema does not state (at least one key).
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/control.test.ts server/routes/preferences.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add light control and preferences endpoints`

### Task 11: Browser API client

review: no

**Files:**
- Create: `src/api/client.ts`, `src/store/slices/devices.ts`
- Modify: `src/store/createApiThunk.ts` (read the `{ error, message }` body and use the client's `ApiError`), `src/entryClient.tsx` and `src/store/index.ts` (replace the placeholder `app` reducer with `devices`)
- Test: `src/api/client.test.ts`, `src/store/createApiThunk.test.ts`, `src/store/slices/devices.test.ts`

**Interfaces:**
- Consumes: `shared/apiTypes.ts` (Task 2; `StatePatch` from Task 10); `createApiThunk`, `makeStore` (Task 1).
- Produces:
  - `export const api` with the functions of the design's mock `api` object, with the same names: `listDevices`, `discover`, `probeHost`, `addDevice`, `removeDevice`, `getInfo`, `getState`, `patchState`, `getConfig`, `patchConfig`, `unlock`, `getCapabilities`, `getPins`, `scanNetworks`, `reboot`. Also `getPendingReboot`, `getEffects`, `getPalettes`, `getPreferences`, `putPreference`. There is no `getPresets`. `patchState(id: string, patch: StatePatch)` sends only `on` and `bri`. The mock's Lights, scene and look functions belong to a separate plan (Decision 6).
  - `export class ApiError extends Error { status: number; code: ErrorCode }`. It is the only `ApiError` in `src/`.
  - `devicesSlice` (`{ list: Device[]; status: "idle" | "loading" | "ok" | "error" }`) and the `fetchDevices` thunk (through `createApiThunk`) that fills `list`.

- [ ] **Step 1: Write the failing tests** with a stubbed `fetch`:
  - A table with one row per function: the method, the path (for example `getConfig("a/b")` → `GET /api/devices/a%2Fb/config`), and the body.
  - Every request has `X-Strand-Request: 1`. A request with a body has `Content-Type: application/json`. A request with no body has no `Content-Type`.
  - A `401 {"error":"pin_required","message":"m"}` reply throws `ApiError` with `status 401`, `code "pin_required"`, `message "m"`.
  - A `502` reply with an HTML body throws `ApiError` with `status 502`, `code "device_error"`, and a generic message.
  - A `204` reply resolves to `undefined`.
  - URLs are absolute paths with no origin.
  - `createApiThunk` turns an `ApiError` into a rejected action whose payload is `{ status, code, message }`.
  - The initial `devices` state is `{ list: [], status: "idle" }`. `fetchDevices` fulfilled → `status: "ok"` and the list.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** One private `request<T>(method, path, body?)`. Encode `:id` with `encodeURIComponent`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add typed API client`

### Task 12: Docker image and compose file

review: no

**Files:**
- Create: `Dockerfile`, `compose.yaml`, `.dockerignore`
- Modify: `CLAUDE.md` (the Docker commands)

**Interfaces:**
- Consumes: the package scripts `build`, `build:server`, `start` (Task 1).

- [ ] **Step 1: Write `.dockerignore`:** `node_modules`, `dist`, `dist-server`, `data`, `.tmp-data`, `.git`, `docs`, `*.db`, `.DS_Store`.
- [ ] **Step 2: Write the Dockerfile.**
  - Build stage `node:24`: copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. Install pnpm at the version in `packageManager` with `npm install -g`, as the template's Dockerfile does. `pnpm install --frozen-lockfile`. Copy the source. `pnpm build && pnpm build:server`.
  - Runtime stage `node:24-slim`: copy the three manifests. Install pnpm the same way. `pnpm install --prod --frozen-lockfile --ignore-scripts`. Copy `dist/` and `dist-server/` from the build stage as siblings. `ENV DATA_DIR=/data`. `RUN mkdir -p /data && chown node:node /data`, and after that line, `VOLUME /data`. `USER node`. `EXPOSE 3000`. `CMD ["node", "dist-server/server.js"]`.
- [ ] **Step 3: Write `compose.yaml`**, the same as PRD §5, with `build: .`, `image: strand`, and a commented `ALLOWED_HOSTS` line with a one-line explanation (Plan decision 1).
- [ ] **Step 4: Verify.** `docker build -t strand .` succeeds. `docker run --rm -p 3000:3000 -v "$PWD/.tmp-data:/data" strand` starts. `curl -s -H 'Host: localhost' localhost:3000/api/devices` returns `[]`. `curl -s localhost:3000/` returns the HTML. `.tmp-data/strand.db` exists. Remove `.tmp-data` afterward. (`network_mode: host` does not work on Docker Desktop for macOS. This check uses `-p` only to prove that the image runs.)
- [ ] **Step 5: Commit.** `build(docker): add Docker image and compose file`

## Pre-merge checks (for the PR body)

These need a real device and cannot run in the build:

- `GET /api/devices/:id/capabilities` and `GET pins` against a real WLED 0.15 device and a 17.0.0-dev device.
- A Wi-Fi change through `PATCH config` on a real device: the device reboots and is found again through mDNS.
- Discovery with `network_mode: host` on Linux finds real devices.
