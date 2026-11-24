# Lights and Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Lights and Presets tabs: the server's strand model over WLED segments, the Lights, scene and look endpoints, the two short device timers, and the React device page with its Lights and Presets tabs.

**Architecture:** A pure layout module (`server/lights/layout.ts`) translates between WLED segments and strands, ranges, patterns and slots. Routes read the device, call the layout module, send the smallest WLED change, and answer with a new `LightsView`. A per-process runtime (`server/lights/runtime.ts`) holds the 3-second flash timer and the 5-second startup-preset timer. The browser keeps a `lights` Redux slice with optimistic edits, one request in flight per strand, and rollback. The browser never builds WLED JSON.

**Tech Stack:** Node 24, TypeScript, Fastify 5, `node:sqlite`, vitest, fast-check 4 (new dev dependency), React 19, Redux Toolkit + recompose, Tailwind v4, Radix (`radix-ui`), Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-23-lights-presets-design.md` (approved). UI and API contract: `docs/design/strand-wled-spec.html`, the "MOCK APP SERVER" comment (lines 601-648), the block "MOCK APP SERVER: LIGHTS AND PRESETS" (lines 1059-1666), SCREEN 3 (lines 2766-2840), SCREEN 5 (lines 4234-5084), SLOT EDITOR (lines 5085-5376), POINTER DRAGS AND KEYBOARD (lines 5377-5545), SCREEN 6 (lines 5546-5846), and LIGHTS AND PRESETS DIALOGS (lines 5847-6031). Prior plan: `docs/superpowers/plans/2026-10-23-app-server.md` (its Tasks 1-12 are built before this plan runs). Read the spec, the design lines that a task names, and the prior plan's interfaces before you start a task.

## Pipeline State

| Field         | Value                                                              |
|---------------|--------------------------------------------------------------------|
| stage         | 2 (plan review)                                                    |
| class         | large (new schema, new public API, new screens, in-memory timers)  |
| profile       | frontend + backend + seam                                          |
| branch        | feat/app-server                                                    |
| pr            | #1                                                                 |
| design assets | docs/design/strand-wled-spec.html                                  |
| gate          | pending                                                            |
| round         | 0                                                                  |
| decisions     | 0                                                                  |

## Plan decisions

The spec does not make these choices, or the plan changes what the spec says. Each one is here so the owner sees it at the gate.

1. **The startup preset has no top-level `on` or `bri`** (spec §6.7 lists them). At boot the firmware sets the brightness from `def.on`/`def.bri` and then applies the boot preset, so a preset `on`/`bri` overrides the Settings "turn on at boot" value (`wled00/wled.cpp:683-691`). Segment `on` and `bri` stay in the preset, so per-strand power survives a reboot. Global power changes do not schedule a startup write.
2. **The startup preset lists every segment ID from 0 to `maxseg − 1` in order.** A listed segment is its full body. An unlisted ID is `{"id":k,"stop":0}`. A `psave` body is applied as live state before it is saved (`json.cpp:466-506`), and at boot a request ID at or above the vector size is appended at the end (`json.cpp:79-84`). This list makes the boot load reproduce the layout whatever segments the firmware made at boot, and it changes nothing live. The server builds it from a fresh `GET /json/state` when the timer fires.
3. **Segment name tags are `Patio 1/3` and `Patio paint`** (spec §6.2). Spec §12 item 1 writes `·2/3` and `·paint`. §6.2 is the normative section, so the plan uses its form.
4. **Every N needs `(N − 1) · G < len`** (a spec gap). Slot k starts at `s + k·G`. When that is at or past the range end, the segment has no LEDs and the firmware makes it inactive (`json.cpp:185-191`), so the layout does not read back. The server rejects such a layout (`422 invalid_layout`), the N and G steppers and the boundary handles stop at this limit, and a look skips a range that is too short.
5. **A removed segment's ID is reused first, as an overwrite.** `writeStrand` overwrites a removed segment with a new body instead of a delete plus a create. Then it uses the spec §6.2 order (unlisted IDs below the highest listed ID, then `max + 1`, `max + 2`). This sends fewer deletes, so the purge rule triggers less often.
6. **`writeStrand` returns `seg: SegPatch[][]`** (one array per request) and paint entries keyed by segment name. The route resolves the paint IDs after it reads the state again (spec §6.2 rule 3). `applyScene` and `applyLook` return the next strand content (`StrandPatch`), and the route writes one strand at a time, so two strands never get the same new ID.
7. **Effect and palette shapes follow the contract** (mock lines 645-647), not the prior plan's `{ id, name, meta }`. Task 3 changes `GET effects` to `{ id, name, pal, sliders, checks, colors }` and `GET palettes` to `{ id, name, stops }`. `stops` come from `/json/palx`.
8. **Error codes and statuses come from the mock:** `strand_changed` 409, `shared` 409, `segment_budget` 422 (body also has `need`), `invalid_layout` 422, `invalid_name` 422, `not_adjacent` 422, `too_many` 422, `painted` 422.
9. **`LightsView` has `matrix: boolean`.** On a 2D device (`info.leds.matrix` present, `json.cpp:734-735`) the view has no strands and the tab shows the spec §3 message. Every write gets `422 invalid_layout`.
10. **Strand brightness is 1-255.** Segment `bri: 0` turns the segment off and reads back as 255 (`json.cpp:193-197`, `:597`). The design's Slider is 1-255 by default (line 2316).
11. **Range names are 1-64 characters and unique in a strand.** A device segment with no name reads as `Range <k>` (k is the range's 1-based position). The spec's "strand name for an unnamed range" rule is not needed, because every range has a name.
12. **`PATCH state` with `on: true` also sends the paint again.** The design's header switch calls `api.patchState` (line 2623), and spec §6.4 asks for paint on every Strand power-on. `PATCH state` and `PATCH lights` share one power function.
13. **`GET lights` deletes leftover flash segments only when this server has no flash timer for that device**, so opening the tab does not cut a flash short.
14. **Strand names are the preference `strandNames.<deviceId>`** (CLAUDE.md). `DELETE /api/devices/:id` deletes that preference too.
15. **`PATCH strand` ranges must cover the strand exactly.** Every view covers every LED (gaps read as off All ranges), so no screen sends gaps.
16. **A shared strand accepts `on`, `bri`, and a one-All-range `ranges` that edits the shared segment's slot.** Any other `ranges` gets `409 shared` (mock `patchStrand`, line 1349).
17. **Toasts are a Redux slice.** The shadcn `sonner` toaster calls hooks, which CONVENTIONS.md §3 bans.
18. **The Settings tab** links to `/devices/:id/settings`. Until the settings screens exist, that route shows the device page with a Settings panel that has only the "Open WLED Advanced UI" link (`http://<host>/settings`, new tab). The "Settings locked" badge and the PIN dialog belong to the settings screens.
19. **Do not port the prototype's placeholders** or its reviewer-only "Prototype controls" panel (`prototype` object, lines 1488-1666). The React app has no "Designed in the next round" placeholder, so there is nothing to remove.
20. **`fast-check` 4** is added as a dev dependency for the round-trip property test.

## Global Constraints

Binding rules this change can touch:

- The browser calls only the app server, never a device, and never builds or sends WLED JSON. No polling of lighting state (CLAUDE.md, "Architecture constraints"; spec §3 anti-goals).
- React hooks only in `src/lib/withRouter.tsx`. Enforced by `eslint.config.js` (CONVENTIONS.md §3). Only top-level screens `connect()` (§3).
- API client and thunks: CONVENTIONS.md §4.
- Server routes, `ApiError`, device requests through `server/wled/deviceClient.ts` only: CONVENTIONS.md §5.
- Migrations are append-only: CONVENTIONS.md §6.
- UI primitives, design tokens, a colocated `*.stories.tsx` for every component: CONVENTIONS.md §7.
- camelCase file names: CONVENTIONS.md §8.
- Conventional Commits, no co-author or attribution trailers, stage by path: CONVENTIONS.md §9.
- Testing guide: CONVENTIONS.md §10. One behavior, one test, at the outermost surface. Each test has a one-line comment that names the production change that makes it fail.
- Chained calls align `.method()` with the line above: CONVENTIONS.md §11.
- Task gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test <task paths>`. The full suite runs once, at commit review.
- This plan departs from CONVENTIONS.md §5, which says: "The server keeps no device state, connection or queue in memory between requests." Task 7 replaces that sentence (spec §4).
- Never log a request body, a PIN, or paint data.

**Frontend tokens and checks (every UI task):**

- Tokens: the CSS variables in `src/index.css` (from the design): `primary`, `background`, `card`, `muted`, `accent`, `warning`, `warning-muted`, `danger`, `success`. Type: Geist Variable (display and body), Geist Mono Variable (hosts, hex, LED numbers). Layout: the design's `page()` container (`max-w-6xl`, 16 px gutters, line 2459). Signature element: the LED strip with draggable range boundaries.
- Class strings: copy them from the design's "SHADCN/UI CLASS STRINGS" block (lines 1825-1949) and the line ranges each task names. No hard-coded colors except LED and paint colors.
- Breakpoints: render without horizontal overflow at 375, 768 and 1440 px. The slot sheet is a bottom sheet below 900 px and a right side sheet at 900 px and up (Tailwind `min-[900px]:`).
- Keyboard: every control is reachable with Tab and has a visible focus ring. Range handles, the paint strip and the color area are `role="slider"` with the keys in the design (lines 5487-5545).
- Reduced motion: animations use `motion-safe:`.
- States: each tab has loading (skeleton), error (with "Try again"), offline, empty, and success states as the design shows.

## Verified external API (do not re-derive)

WLED source `~/Code/WLED` at `nightly-522-g3cdb5108` (17.0.0-dev). The same code paths exist in `v0.15.0` (`json.cpp:27`, `:386`, `:435`, `:443`). The prior plan's section has the endpoints it pinned.

- **Segment create:** a `seg` element whose `id` is at or above the vector size is appended at the end and gets ID `size − 1`. If its `stop` is 0 or absent, it is ignored (`json.cpp:79-84`). A new segment gets `col[0]` = `[255,160,0]` (`json.cpp:89`). An `id` below the size edits that slot, also an empty one.
- **Segment delete:** `{"id":n,"stop":0}` empties the slot. `/json/state` lists only active segments (`json.cpp:684-700`, `FX.h:671`). In a `seg` array, if the vector has more than 3 slots and the deleted count is at least `size / 2`, the firmware purges empty slots and renumbers every segment (`json.cpp:488`).
- **Name:** `n` sets the name. Without `n`, a change of `start` or `stop` clears the name (`json.cpp:144-151`). The name limit is 32 bytes on ESP8266 and 64 on ESP32 (`const.h:175-180`). Strand uses 32 bytes.
- **Geometry:** `grp` and `spc` are `uint8_t` (`FX.h:470`). `c3` is clamped to 0-31 (`json.cpp:305`). Segment `bri: 0` turns the segment off and keeps its opacity (`json.cpp:193-197`). The state reports opacity 0 as 255 (`json.cpp:597`).
- **Paint (`i`):** integers set a start and an optional stop; a color (hex string or array) fills `[start, stop)` or one LED, relative to the segment start, with no grouping or spacing (`json.cpp:314-361`). The first `i` freezes the segment and clears it only if it was not frozen (`json.cpp:323-326`).
- **Power-on unfreeze:** when global brightness goes from 0 to more than 0, every segment is unfrozen before `seg` is applied (`json.cpp:390-395`), so `i` in the same request freezes the segment again.
- **API preset:** `{"psave":250,"o":true,...}` applies the whole body as state first, then saves it at once as preset 250, without `o`, `v`, `time`, `error`, `psave`, and without `bootps` (`json.cpp:466-506`, `presets.cpp:238-265`). `bootps` sets the boot preset and writes the config (`presets.cpp:238-243`), and `/json/cfg` reports it as `def.ps` (`cfg.cpp:1102`). IDs above 250 are refused (`json.cpp:506`).
- **Boot:** the firmware sets brightness from `def.on`/`def.bri`, then applies the boot preset (`wled.cpp:683-691`).
- **`/json/info`:** `leds.maxseg` is the segment limit (`json.cpp:728`). `leds.matrix` exists only on a 2D device (`json.cpp:734-735`).
- **`/json/palx?page=N`:** `{"m": maxPage, "p": {"<id>": entries}}`, 8 palettes per page (5 on ESP8266). An entry is `[pos, r, g, b]`, or a string `"r"`, `"c1"`, `"c2"`, `"c3"` for palettes 1-5 (`json.cpp:983-1058`).
- **Effect metadata:** `docs/wled-ui-audit/main-ui/effects-palettes.md` §2 (fields, `!` defaults, `c3` 0-31) and §1 (Solid's metadata is treated as `";!;"`).
- **fast-check 4:** `fc.assert(fc.property(arb, (x) => { ... }), { numRuns, seed })`. Arbitraries: `fc.integer({ min, max })`, `fc.boolean()`, `fc.constantFrom(...)`, `fc.array(arb, { minLength, maxLength })`, `fc.record({...})`, `.chain()`, `.filter()`.

## API contract (seam)

Task 1 puts these types in `shared/apiTypes.ts`. The server tasks produce them, and Task 13 consumes them. The endpoint list, request bodies and results are spec §9 and mock lines 601-648. This section adds what those leave open.

```ts
// spec §8 and §9, verbatim, plus:
type LightsView = { on: boolean; bri: number; strands: StrandView[]; segments: { used: number; max: number };
                    notices: string[]; matrix: boolean };
type LightsPatch = { on?: boolean; bri?: number };                 // bri 0-255
type StrandPatch = { on?: boolean; bri?: number; ranges?: RangeView[] }; // bri 1-255
type Scene = { id: string; name: string; strandKey: string; ledCount: number; summary: string;
               createdAt: string; updatedAt: string };
type LookRecord = { id: string; name: string; look: Look; createdAt: string; updatedAt: string };
type LookTarget = { strandKey: string; range?: string };
type ApplyResult = { view: LightsView; warnings: string[] };
type Effect = { id: number; name: string; pal: boolean; sliders: string[]; checks: string[]; colors: string[] };
type Palette = { id: number; name: string; stops: string[] };     // "#RRGGBB"
type ApiErrorBody = { error: ErrorCode; message: string; need?: number };
```

- `sliders[k]` labels `["sx","ix","c1","c2","c3"][k]`, `checks[k]` labels `["o1","o2","o3"][k]`, `colors[k]` labels `col[k]`. `""` means hidden. Trailing `""` entries are removed.
- Input `RangeView` and `SlotView` values are checked by the server. The server ignores `fxName` and `palName` on input and writes the device's names in the result.
- Validation for `ranges` (`422 invalid_layout`, message "That layout doesn't fit this strand."): sorted by `start`, they cover `[0, len)` with no gap and no overlap; `len ≥ 1`; names 1-64 characters after trim, unique; `all` and `individual` have one slot; `every` has `2 ≤ n ≤ 16`, `1 ≤ group ≤ 255`, `(n − 1) · group ≤ 255`, `(n − 1) · group < len`, and `n` slots; `individual` has `paint` of `len` items matching `^#[0-9A-Fa-f]{6}$`; slot `col` has 1-3 colors of 3 or 4 integers 0-255; `fx` is an index of the device's effect list; `sx`, `ix`, `c1`, `c2`, `pal` 0-255; `c3` 0-31; `o1`-`o3`, `on` booleans. A body with an unknown key, a wrong type, `{}`, or `bri` out of range gets `400 invalid_request`. `PATCH strand` takes bodies up to 256 KB.
- Error statuses and messages (texts from the mock):

| Code | Status | Message |
|---|---|---|
| `strand_changed` | 409 | "That strand isn't on this controller any more." |
| `shared` | 409 | "`<strand>` shares a segment with another strand. Choose Split or Combine on the Lights tab first." |
| `segment_budget` | 422 | "This needs `<n>` more segment(s) and `<free>` is/are free. Remove a range first." (mock `checkBudget`, line 1259; body `need: n`) |
| `invalid_layout` | 422 | "That layout doesn't fit this strand.", or "2D matrix layouts aren't supported yet." |
| `invalid_name` | 422 | "Names need 1 to 64 characters." |
| `not_adjacent` | 422 | "Only strands whose LEDs touch can be combined." |
| `too_many` | 422 | "A device can keep 256 scenes." / "A device can keep 256 looks." |
| `painted` | 422 | "A range with painted LEDs can't be saved as a look." |
| `not_found` | 404 | "That scene was deleted." / "That look was deleted." / "That range isn't on the strand any more. Pick it again." |

- Scene `summary`: `` `${plural(n, "range")} · ${on ? `${briToPct(bri)}%` : "off"}` `` (mock `sceneOut`, line 1295; `briToPct` line 209, `plural` line 243).
- Notice when a saved combination no longer touches: "A combined strand was separated because its LED outputs no longer touch."
- Warnings: "The strand has `<len>` LEDs now, not `<ledCount>`. The ranges were fitted to the new length." · "`<fxName>` isn't on this controller. Solid is used instead." · "`<palName>` isn't on this controller. Default is used instead." · "`<range>` is too short for Every `<n>` now, so it uses All." · "`<range>` is too short for this look."

---

## File structure

```
shared/apiTypes.ts                 + lights, scene, look types; Effect and Palette change; new error codes
server/
  app.ts                           + flashMs, startupDelayMs in AppDeps; ServerDeps; lights runtime; new routes
  errors.ts                        ApiError gets optional `need`
  db/migrations.ts                 + entry 2: scenes, looks, strand_groups
  db/scenes.ts, db/looks.ts, db/strandGroups.ts   row access
  db/preferences.ts                + get, remove
  wled/effectMeta.ts               parseEffectMeta, palxStops
  lights/layout.ts                 strandsFromConfig, readLayout, writeStrand, validateRanges, names, paint codec
  lights/snapshots.ts              snapshotStrand, lookFromRange, fitRanges, resolveSlot, applyScene, applyLook
  lights/startup.ts                buildStartupPreset
  lights/runtime.ts                flash and startup timers, last-sent paint
  lights/deviceLights.ts           read a device into a LightsView; write a LayoutWrite and read back
  routes/lights.ts                 lights, strands, resolve, flash, strand-groups, strand-names
  routes/presets.ts                scenes and looks
  routes/control.ts                PATCH state power-on paint; effects and palettes shapes
test/
  wledSim.ts                       pure firmware segment simulator (shared by the fake and the property test)
  fakeWled.ts                      segments through wledSim, psave, palx, `port`, `applyState`
  demoDevices.ts                   `node test/demoDevices.ts`: three fakes with the design's layouts
src/
  api/client.ts                    + lights, groups, names, scenes, looks functions
  lights/model.ts                  pure helpers ported from the design
  store/slices/lights.ts, presets.ts, devicePage.ts, preferences.ts, toasts.ts
  components/ui/                   + switch, slider, sheet, dropdownMenu, badge, skeleton, stepper, toaster; button, dialog, icon restyled
  components/device/               deviceHeader, deviceBanners, settingsPanel
  components/lights/               lightsTab, strandPicker, strandPanel, strip, rangeCard, patternControls, slotRows,
                                   paintEditor, slotSheet, lightsDialogs
  components/presets/              presetsTab, presetsDialogs
  screens/deviceScreen.tsx         the only connected component of the device page
```

**Running the app for screenshots** (every UI task and Task 23): `node test/demoDevices.ts` (fakes on 127.0.0.1 ports 18081 Backyard, 18082 Front Roof, 18083 Garage). In a second terminal: `pnpm build && pnpm build:server && DATA_DIR=.tmp-data pnpm start`. Add each fake with `curl -s -X POST -H 'Host: localhost' -H 'X-Strand-Request: 1' -H 'Content-Type: application/json' -d '{"host":"127.0.0.1:18081"}' localhost:3000/api/devices`, and open `http://localhost:3000/devices/<id>`. Delete `.tmp-data` afterward.

---

### Task 1: Shared types, error codes, migration and repositories

review: yes (migration, cascade deletes)

**Files:**
- Modify: `shared/apiTypes.ts`, `server/errors.ts`, `server/db/migrations.ts`, `server/db/preferences.ts`
- Create: `server/db/scenes.ts`, `server/db/looks.ts`, `server/db/strandGroups.ts`
- Test: `server/db/database.test.ts`, `server/db/scenes.test.ts`, `server/db/looks.test.ts`, `server/db/strandGroups.test.ts`, `server/db/preferences.test.ts`, `server/errors.test.ts`

**Interfaces:**
- Consumes: `openDb`, `runMigrations`, `devices` (prior Task 3); `ApiError`, `registerErrorHandler` (prior Task 2).
- Produces:
  - In `shared/apiTypes.ts`: `SlotLook`, `Pattern`, `Look`, `RangeSnapshot`, `StrandSnapshot` (spec §8), `SlotView`, `RangeView`, `StrandView`, `LightsView`, `LightsPatch`, `StrandPatch`, `Scene`, `LookRecord`, `LookTarget`, `ApplyResult` (API contract). `ErrorCode` adds `strand_changed`, `shared`, `segment_budget`, `invalid_layout`, `invalid_name`, `not_adjacent`, `too_many`, `painted`. `ApiErrorBody` adds `need?: number`.
  - `ApiError` constructor: `(status, code, message, extra?: { need: number })`. The handler adds `need` to the body when it is set.
  - `migrations[1]`: the spec §8 SQL, verbatim.
  - `scenes`: `type SceneRow = { id: string; deviceId: string; name: string; strandKey: string; ledCount: number; content: StrandSnapshot; createdAt: string; updatedAt: string }`; `list(db, deviceId): SceneRow[]` (order `created_at, rowid`); `get(db, deviceId, id): SceneRow | undefined`; `count(db, deviceId): number`; `insert(db, row: { deviceId; name; strandKey; ledCount; content }, now: Date): SceneRow`; `rename(db, deviceId, id, name, now): SceneRow | undefined`; `remove(db, deviceId, id): boolean`.
  - `looks`: the same functions with `type LookRow = { id; deviceId; name; look: Look; createdAt; updatedAt }` and `insert(db, row: { deviceId; name; look }, now)`.
  - `strandGroups`: `list(db, deviceId): string[]` (order `rowid`); `replace(db, deviceId, keys: string[]): void` (one transaction).
  - `preferences.get(db, key): unknown | undefined`; `preferences.remove(db, key): void`.

- [ ] **Step 1: Write the failing tests.**
  - `openDb(":memory:")` → `user_version` 2.
  - `scenes.insert` then `get`, `list` (insert order with the same `now`), `count` → 1. `rename` returns the new name and a new `updatedAt`. `remove` → `true`, then `false`. `get` with another device's ID → `undefined`. `content` round-trips as an object.
  - The same for `looks`.
  - `strandGroups.replace(db, id, ["o0+o1"])` then `list` → `["o0+o1"]`. `replace(db, id, [])` → `[]`.
  - Cascade: a device with one scene, one look and one group; `devices.remove` → each `list` is `[]`.
  - `preferences.get(db, "x")` → `undefined`; after `put` → the value; after `remove` → `undefined`.
  - A route that throws `new ApiError(422, "segment_budget", "m", { need: 3 })` → body `{ error: "segment_budget", message: "m", need: 3 }`.
- [ ] **Step 2: Run** `pnpm test server/db server/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prepared statements only. Store `content` and `look` as JSON text. IDs from `crypto.randomUUID()`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/db server/errors.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add lights types and scenes, looks and strand group tables`

### Task 2: Firmware segment simulator and fake device support

review: no

**Files:**
- Create: `test/wledSim.ts`, `test/demoDevices.ts`
- Modify: `test/fakeWled.ts`
- Test: `server/wled/wledSim.test.ts`, `server/wled/fakeWled.test.ts` (vitest includes only `server/` and `src/`)

**Interfaces:**
- Consumes: `startFakeWled`, `FakeWled`, `FakeOpts`, `seeds` (prior Task 4).
- Produces, in `test/wledSim.ts` (pure, no imports except types):
  - `type SimSeg = { start: number; stop: number; grp: number; spc: number; of: number; on: boolean; frz: boolean; bri: number; col: number[][]; fx: number; sx: number; ix: number; c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean; pal: number; sel: boolean; rev: boolean; mi: boolean; n?: string; pixels: (string | null)[] }`.
  - `type SimState = { on: boolean; bri: number; mainseg: number; slots: (SimSeg | null)[]; maxseg: number; ledCount: number; presets: Record<string, unknown>; bootps: number }`. A `null` slot is an empty slot.
  - `simFromState(state: { on; bri; seg: object[] }, maxseg: number, ledCount: number): SimState`.
  - `applyPost(sim: SimState, body: Record<string, unknown>): void`. It follows "Verified external API": global `on`/`bri` with the power-on unfreeze, `seg` arrays and objects by `id`, append, delete, purge, name clearing, the default color, byte wrap of `grp`/`spc`, `c3` clamp, `i` paint (pixels as `"#RRGGBB"`), and `psave` (apply, then store the cleaned body at `presets[id]`, and `bootps`).
  - `listState(sim: SimState): { on: boolean; bri: number; mainseg: number; seg: object[] }`. Each listed segment has `id`, `start`, `stop`, `len`, `grp`, `spc`, `of`, `on`, `frz`, `bri` (255 when 0), `col`, `fx`, `sx`, `ix`, `pal`, `c1`-`c3`, `o1`-`o3`, `sel`, `rev`, `mi`, and `n` when set.
- Produces, in `test/fakeWled.ts`: the fake keeps a `SimState` built from the seed. `POST /json/state` and `POST /json` call `applyPost`. `GET /json/state` returns `listState`. `GET /presets.json` returns the seed presets merged with `sim.presets`. A `psave` with `bootps` sets `cfg.def.ps`. New: `FakeOpts.port?: number`; `FakeWled.applyState(body: Record<string, unknown>): void` (a change made by another client); `FakeWled.state` becomes a getter that returns `listState(sim)`; `GET /json/palx?page=N` (8 per page; palettes 1-5 as the firmware strings; others `[[0,r,g,b],[255,r2,g2,b2]]` from a fixed color table); `info.leds.maxseg` stays from the seed.
- Imports between runtime files in `test/` use the `.ts` extension, so `node test/demoDevices.ts` runs under Node 24 type stripping.
- Produces, `test/demoDevices.ts`: starts Backyard on 18081, Front Roof on 18082, Garage on 18083, and applies the design's layouts (mock `lightSeed`, lines 1084-1180) as segment posts: Backyard o0 "Patio" Every 2 group 2 over 0-59, "Kitchen" All 60-119 (Rainbow), "Rest" All 120-149; o1 "Fence" All 150-269 and a foreign segment "Porch light" 270-299 with `grp: 2`; Front Roof "Gutter" All 0-199 and "Peak paint" 200-299 with candy-cane paint (mock `candyPaint`); Garage one All segment. It prints the three URLs and runs until killed.

- [ ] **Step 1: Write the failing tests** (`server/wled/wledSim.test.ts`, with a sim of one segment 0-300, `maxseg` 32):
  - `{seg:[{id:3,start:0,stop:10}]}` → listed IDs `[0, 1]` (appended at the end), and the new segment's `col[0]` is `[255,160,0]`.
  - `{seg:[{id:0,stop:0}]}` → nothing listed; `slots.length` stays 1. Then `{seg:[{id:0,start:0,stop:5,n:"A"}]}` → ID 0 listed again with `n: "A"`.
  - Six active segments, then one array that deletes three → listed IDs are `0, 1, 2` (purge).
  - `{seg:[{id:0,start:5}]}` on a segment named "A" → no `n`.
  - `{seg:[{id:0,grp:300}]}` → `grp` 44.
  - `{seg:[{id:0,i:[0,2,"FF0000"]}]}` → `frz: true`, pixels 0-1 `"#FF0000"`. Then `{on:false}`, `{on:true}` → `frz: false`.
  - `{psave:250,o:true,n:"Strand: startup",bootps:250,seg:[{id:0,n:"X"}]}` → `presets["250"]` is `{n:"Strand: startup",seg:[{id:0,n:"X"}]}`, `bootps` 250, and listed segment 0 has `n: "X"`.
  - `server/wled/fakeWled.test.ts`: `GET /json/palx?page=0` on Backyard → `m: 1` and 8 keys in `p`; key `"2"` is `["c1"]`. `startFakeWled(seed, { port: 18999 })` listens on 18999. After a `psave` with `bootps`, `GET /json/cfg` has `def.ps` 250.
- [ ] **Step 2: Run** `pnpm test server/wled/wledSim.test.ts server/wled/fakeWled.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the simulator, the fake changes and the demo script.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled server/routes`. The existing route tests use the fake, so they must still pass. `node test/demoDevices.ts` prints three URLs, and `curl -s 127.0.0.1:18081/json/state` lists six segments (Patio 1/2, Patio 2/2, Kitchen, Rest, Fence, Porch light).
- [ ] **Step 5: Commit.** `test(server): simulate WLED segments and presets in the fake device`

### Task 3: Effect metadata and palette previews

review: no

**Files:**
- Create: `server/wled/effectMeta.ts`
- Modify: `shared/apiTypes.ts` (`Effect` and `Palette` become the contract shapes), `server/routes/control.ts`
- Test: `server/wled/effectMeta.test.ts`, `server/routes/control.test.ts`

**Interfaces:**
- Consumes: `/json/palx` in the fake (Task 2); `controlRoutes`, `deviceRequest`, `loadDevice` (prior Tasks 4, 8, 10).
- Produces:
  - `parseEffectMeta(id: number, meta: string): Pick<Effect, "pal" | "sliders" | "checks" | "colors">`. Default labels: sliders `Speed`, `Intensity`, `Custom 1`, `Custom 2`, `Custom 3`; checks `Option 1`-`Option 3`; colors `Fx`, `Bg`, `Cs`. ID 0 uses `";!;"`. An empty string means "no metadata": sliders `["Speed","Intensity"]`, colors `["Fx","Bg","Cs"]`, `pal: true`. Palette field: `""` or numeric → `false`; `!` or other text → `true`.
  - `Effect` and `Palette` in `shared/apiTypes.ts`, as in "API contract". `src/api/client.ts` needs no code change.
  - `palxStops(entries: unknown[]): string[]`. `[pos, r, g, b]` → `"#RRGGBB"` in entry order; string entries are skipped.
  - `GET effects` → `Effect[]` without `RSVD`. `GET palettes` → `Palette[]`: names from `/json/palettes`, stops from `/json/palx` pages 0 to `m`, read one after another.

- [ ] **Step 1: Write the failing tests.**
  - `parseEffectMeta(1, "!,Duty cycle;!,!;!;01")` → `{ pal: true, sliders: ["Speed","Duty cycle"], checks: [], colors: ["Fx","Bg"] }`.
  - `parseEffectMeta(7, "!,!,,,,Smooth;;!")` → sliders `["Speed","Intensity"]`, checks `["Smooth"]`, colors `[]`, `pal: true`.
  - `parseEffectMeta(4, "!;;!")` → sliders `["Speed"]`, colors `[]`, `pal: true`.
  - `parseEffectMeta(0, "")` → `{ pal: false, sliders: [], checks: [], colors: ["Fx"] }`.
  - `parseEffectMeta(30, "")` → sliders `["Speed","Intensity"]`, colors `["Fx","Bg","Cs"]`, `pal: true`.
  - `parseEffectMeta(5, "!,,Delay;;4")` → sliders `["Speed","","Delay"]`, `pal: false`.
  - `palxStops([[0,255,0,0],[255,0,0,255]])` → `["#FF0000","#0000FF"]`; `palxStops(["c1","c2"])` → `[]`.
  - Route: `GET effects` on Backyard → 10 effects; Blink has `sliders: ["Speed","Duty cycle"]`. `GET palettes` → 13 palettes; `fake.requests` has `/json/palx?page=0` and `/json/palx?page=1`; palette 2 has `stops: []`.
- [ ] **Step 2: Run** `pnpm test server/wled/effectMeta.test.ts server/routes/control.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the prior `meta` field.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled/effectMeta.test.ts server/routes/control.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): parse effect metadata and palette previews`

### Task 4: Layout read

review: no

**Files:**
- Create: `server/lights/layout.ts`
- Test: `server/lights/layoutRead.test.ts`

**Interfaces:**
- Consumes: `WledConfigFull`, `LightsView`, `StrandView`, `RangeView`, `SlotView` (Task 1).
- Produces, in `server/lights/layout.ts`:
  - `type WledSeg = { id: number; start: number; stop: number; grp: number; spc: number; of: number; on: boolean; frz: boolean; bri: number; col: number[][]; fx: number; sx: number; ix: number; c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean; pal: number; n?: string }`.
  - `type WledState = { on: boolean; bri: number; seg: WledSeg[] }`.
  - `type Strand = { key: string; name: string; pins: number[]; start: number; len: number; members: string[] }`.
  - `type PaintMap = Record<string, string[]>` (segment name → `"#RRGGBB"` per LED).
  - `type Lists = { effects: string[]; palettes: string[] }`.
  - `const FLASH_NAME = "Strand flash"`; `const NAME_BYTES = 32`.
  - `strandsFromConfig(cfg: WledConfigFull, groupKeys: string[], names: Record<string, string>): { strands: Strand[]; dropped: string[] }`. One strand per `hw.led.ins` entry, key `o<index>`, sorted by `start`. Default name `Strand <index + 1>`. A valid group replaces its members; its name is `names[key]` or the member names joined with `" + "`. A group is valid when it has two or more members that exist and touch in key order (`a.start + a.len === b.start`). Invalid groups go to `dropped`.
  - `segmentName(base: string, tag: "" | "paint" | { k: number; n: number }): string`. Tags: `""`, `" paint"`, `` ` ${k}/${n}` ``. The base is cut by bytes on a UTF-8 character boundary to `NAME_BYTES − bytes(tag)`.
  - `decodePaint(i: unknown[], len: number): string[]` (firmware semantics, `json.cpp:314-358`; unset LEDs are `"#000000"`) and `encodePaint(paint: string[]): (number | string)[]` (each run as `start, stop, "RRGGBB"`).
  - `readLayout(state: WledState, strands: Strand[], lists: Lists, paint: PaintMap, maxseg: number): Omit<LightsView, "notices" | "matrix">`.
  - Internal, exported for Task 5: `readStrand(state: WledState, strand: Strand, lists: Lists, paint: PaintMap): { view: StrandView; segIds: number[][]; inside: number[]; crossing: number[] }`. `segIds[r][k]` is the segment ID of slot k of range r (empty for a gap range).

**The read algorithm** (spec §6.2 "Reading a layout back"; the implementer may not reorder these steps):

1. Ignore segments named `FLASH_NAME`. `crossing` = segments that overlap the strand but do not lie inside it. If there is one, the strand is `shared`: `with` = the other strands that crossing segments touch, and `ranges` = one All range `"Range 1"` over the strand with the first crossing segment's slot. Stop.
2. `inside` = segments with `start ≥ strand.start` and `stop ≤ strand.start + strand.len`, by ID.
3. Tag groups: names matching `/^(.*) (\d+)\/(\d+)$/`. A group with base B and count N is an Every range when it has each k from 1 to N once, `2 ≤ N ≤ 16`, the same `stop`, the same `grp` G, `spc = (N − 1)·G`, and `start_k = start_1 + (k − 1)·G`. The name is B.
4. Paint: a segment named `` `${B} paint` `` with `frz: true`, `grp 1`, `spc 0` is an Individual range named B. Its paint is `paint[name]`, else `col[0]` for every LED.
5. Geometry groups among the rest: runs of N ≥ 2 segments with the same `stop`, the same `grp` G, `spc = (N − 1)·G`, and starts G apart. The name is the first segment's name, else `Range <k>`.
6. Every other segment is an All range over `[start, stop)`, named by its `n`, else `Range <k>`. It sets `normalize` when its `grp ≠ 1`, `spc ≠ 0` or `of ≠ 0`.
7. Accept ranges in the order of their lowest segment ID. A range that overlaps an accepted range is left out and sets `normalize`.
8. Each uncovered LED run is an All range named `Range <k>` with a slot that is off (`on: false`, `col [[0,0,0],[0,0,0],[0,0,0]]`, `fx 0`, `pal 0`, other fields 128 or `false`, `c3` 16). It sets `normalize`.
9. Sort ranges by `start`; make `start` relative to the strand. Strand `on` = any segment of the strand is on. Strand `bri` = the `bri` of its lowest-start segment, else 255. `fxName` and `palName` come from `lists`.

`segments.used` = the number of listed segments (flash included). `segments.max` = `maxseg`.

- [ ] **Step 1: Write the failing tests** (Backyard config unless the test says otherwise):
  - `strandsFromConfig(cfg, [], {})` → `[{ key: "o0", name: "Strand 1", pins: [16], start: 0, len: 150, members: ["o0"] }, { key: "o1", name: "Strand 2", pins: [17], start: 150, len: 150, members: ["o1"] }]`.
  - Groups `["o0+o1"]` → one strand `o0+o1`, name "Strand 1 + Strand 2", pins `[16, 17]`, len 300. With names `{ o0: "Eaves" }` → "Eaves + Strand 2". With `{ "o0+o1": "Roof" }` → "Roof".
  - Groups `["o0+o1"]` with o1 `start` 160 → two strands, `dropped: ["o0+o1"]`.
  - The seed state (one segment 0-300) → both strands `shared`; o0 `with: ["o1"]`; one All range "Range 1", len 150.
  - "Patio 1/2" `{start 0, stop 60, grp 2, spc 2}` and "Patio 2/2" `{start 2, stop 60, grp 2, spc 2}`, plus an All segment 60-150 "Rest" → ranges Patio `{ start 0, len 60, pattern { kind: "every", n: 2, group: 2 } }` with 2 slots, and Rest; `normalize: false`.
  - The same two segments with no names → one Every range named "Range 1".
  - A segment 0-150 with `grp 3, spc 1`, named "Porch" → All "Porch", `normalize: true`.
  - Segments covering 0-100 only → a second range `{ name: "Range 2", start: 100, len: 50 }` whose slot has `on: false`; `normalize: true`.
  - Segment ID 1 over 0-150 and ID 2 over 50-60 → one range; `normalize: true`.
  - Front Roof, "Peak paint" 200-300 `frz: true`, with `paint["Peak paint"]` of 100 colors → an Individual range with that paint. Without the map entry → 100 copies of `col[0]` as hex.
  - A segment named "Strand flash" is not in any range.
  - `segmentName("Küche Fenster Nord Süd Ost West Garten", { k: 1, n: 2 })` → at most 32 bytes, ends with `" 1/2"`, and `Buffer.from(name).toString() === name`.
  - `decodePaint([0, 2, "FF0000", "00FF00"], 4)` → `["#FF0000","#FF0000","#00FF00","#000000"]`. `encodePaint(["#FF0000","#FF0000","#FFFFFF"])` → `[0, 2, "FF0000", 2, 3, "FFFFFF"]`.
- [ ] **Step 2: Run** `pnpm test server/lights/layoutRead.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by the algorithm above.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights/layoutRead.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): read WLED segments as strands, ranges and patterns`

### Task 5: Layout write and the round-trip property

review: yes (device writes; spec §3 anti-goals; segment ID allocation)

**Files:**
- Modify: `server/lights/layout.ts`, `package.json` (`pnpm add -D fast-check@^4`)
- Test: `server/lights/layoutWrite.test.ts`, `server/lights/layoutRoundTrip.test.ts`

**Interfaces:**
- Consumes: `readStrand`, `segmentName`, `encodePaint`, `WledState`, `Strand` (Task 4); `applyPost`, `simFromState`, `listState` (Task 2) in the tests only.
- Produces:
  - `type SegPatch = { id: number } & Partial<Omit<WledSeg, "id">> & { rev?: boolean; mi?: boolean; i?: (number | string)[] }`.
  - `type LayoutWrite = { seg: SegPatch[][]; paint: { name: string; i: (number | string)[] }[] }`.
  - `class LayoutError extends Error { code: "segment_budget" | "invalid_layout" | "shared"; need?: number; free?: number }` (fields assigned in the constructor; no parameter properties).
  - `validateRanges(strand: Strand, ranges: RangeView[], effectCount: number): string | null` (the rules in "API contract").
  - `segmentsNeeded(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap): number` (creates minus removes).
  - `writeStrand(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap, maxseg: number): LayoutWrite`.

**The write algorithm:**

1. Read the current strand with `readStrand`. If it is `shared` and `next.ranges` is not one All range over the strand, throw `LayoutError("shared")`. Otherwise patch the slot fields and `on`/`bri` on the crossing segments and the inside segments, and stop.
2. `on` and `bri` alone: one patch per segment of the strand. With `on: true`, add a paint entry for each Individual range.
3. With `ranges`: if `normalize` is set, every inside segment is removed and every next range is new. Otherwise match each next range to a current range with the same `start`, `len` and pattern (`kind`, `n`, `group`). For a match: patch only the slot fields that differ (`col`, `fx`, `sx`, `ix`, `c1`, `c2`, `c3`, `o1`, `o2`, `o3`, `pal`, `on`); patch `n` on every segment of the range when the name differs; add a paint entry when the paint differs. Unmatched current ranges are removed; unmatched next ranges are new.
4. New segment bodies (spec §6.2 geometry table): `start`, `stop`, `grp`, `spc`, `of: 0`, `rev: false`, `mi: false`, `frz` (`true` only for Individual), `n` from `segmentName`, `on`, `bri` (strand value), and every slot field. Each new Individual range gets a paint entry.
5. IDs (Plan decision 5): new segments take, in order, the removed IDs (ascending, as overwrites), then unlisted IDs below the highest listed ID (ascending), then `max + 1`, `max + 2`, and so on. Removed IDs that are not reused get `{ id, stop: 0 }`.
6. Budget: `need = new − removed`, `free = maxseg − listed`. If `need > free`, throw `LayoutError("segment_budget")` with `need`, `free`, and the contract message.
7. Requests: `sizeMin = max(highest listed ID, highest assigned ID) + 1`. If `sizeMin > 3`, each request has fewer than `floor(sizeMin / 2)` deletes. Deletes come first, in as many requests as needed. Overwrites, creates and patches go in the last request.
8. Never put `sel` or `mainseg` in a patch. Never patch a segment that is not inside or crossing the strand.

- [ ] **Step 1: Write the failing tests** (`layoutWrite.test.ts`). State "split Backyard" = segment 0 over 0-150 "Range 1" and segment 1 over 150-300 "Range 1", `maxseg` 32.
  - Anti-goal: write o0 as All "A" 0-75 and All "B" 75-150 → no patch has `id: 1`; segment 0 is overwritten as A; B gets ID 2; no patch has a `sel` or `mainseg` key.
  - Then change only B's color to blue → `seg` is `[[{ id: 2, col: [[0,0,255],[0,0,0],[0,0,0]] }]]`, `paint` is `[]`.
  - Rename an Every 2 range "Patio" to "Deck" → patches `{ id, n: "Deck 1/2" }` and `{ id, n: "Deck 2/2" }` only.
  - Every 3 group 2 over strand LEDs 10-40 → new segments with `start` 10, 12, 14, `stop` 40, `grp` 2, `spc` 4, names "X 1/3", "X 2/3", "X 3/3".
  - Listed IDs `[0, 2, 5]` and a write that adds 4 segments and removes none → assigned IDs `[1, 3, 4, 6]`.
  - A strand with 8 segments (IDs 0-7) written as one All range → every request has at most 3 `stop: 0` entries; the last request holds the overwrite of ID 0; the union of deletes is IDs 1-7.
  - `maxseg` 16 with 15 listed, a write that needs 2 more → `LayoutError` `segment_budget`, `need` 2, `free` 1, message "This needs 2 more segments and 1 is free. Remove a range first."
  - A strand marked `normalize` (one `grp 3` segment) and a next layout equal to its view → the old segment is overwritten with `grp 1`, `spc 0`.
  - Individual "Peak" with paint 5 × `#FF0000` + 5 × `#FFFFFF` → `paint: [{ name: "Peak paint", i: [0, 5, "FF0000", 5, 10, "FFFFFF"] }]`.
  - `{ on: true }` on a strand with an Individual range → one patch per segment with `on: true`, and one paint entry.
  - `validateRanges`: a 4-LED range Every 3 group 2 → reason (Review Focus 1). A gap, an overlap, two ranges named "A", `c3: 32`, a 65-character name, a paint of the wrong length → reason. A valid layout → `null`.
  - Review Focus 2: a range named "Küche Fenster Nord Süd Ost West Garten" with Every 2 → each segment `n` is at most 32 bytes, ends with `" 1/2"` or `" 2/2"`, and decodes as valid UTF-8.
- [ ] **Step 2: Write the failing property test** (`layoutRoundTrip.test.ts`), `fc.assert(..., { numRuns: 300, seed: 4242 })`:
  - Device: two strands (o0 len `1..300`, o1 len 50), `maxseg` 32, effects and palettes from the Backyard seed.
  - Arbitrary layout L for o0: ranges that partition `[0, len)`; names unique, `/^[A-Z][a-z]{0,10}$/`; patterns All, Every (with `n`, `group` inside every contract limit), Individual (random paint); slots with `fx < 10`, `c3 ≤ 31`; one `bri` 1-255 for the strand. Strand `on` = any slot on. Filter: total segments of L ≤ 32 − (o1 segments).
  - Start state: either the seed state split by strand, or the result of writing another arbitrary layout L0 first (so the diff path runs). o1 has 1-3 arbitrary segments.
  - Property: apply each request of `writeStrand(state, o0, { on, bri, ranges: L }, ...)` with `applyPost`, then apply the paint entries by name. `readLayout` of `listState` (paint map from the sent paint) gives o0 ranges deep-equal to L, `on` and `bri` equal, `normalize: false`; o1's listed segments are deep-equal to before; no request has `sel` or `mainseg`; listed count ≤ 32.
- [ ] **Step 3: Run** `pnpm test server/lights/layoutWrite.test.ts server/lights/layoutRoundTrip.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** by the algorithm above. When fast-check reports a counterexample, fix the code, not the generator, unless the counterexample breaks a contract limit.
- [ ] **Step 5: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights`. Expected: PASS.
- [ ] **Step 6: Commit.** Stage `package.json` and `pnpm-lock.yaml` too. `feat(server): write strand layouts as WLED segments`

### Task 6: Scene and look snapshots

review: no

**Files:**
- Create: `server/lights/snapshots.ts`
- Test: `server/lights/snapshots.test.ts`

**Interfaces:**
- Consumes: `Strand`, `Lists`, `validateRanges` (Tasks 4, 5); `StrandSnapshot`, `Look`, `RangeView`, `StrandView`, `StrandPatch`, `LookTarget` (Task 1).
- Produces:
  - `snapshotStrand(view: StrandView): StrandSnapshot` (slots lose `on`; strand `on` and `bri` kept).
  - `lookFromRange(range: RangeView): Look` (throws `LayoutError("invalid_layout")` for Individual; the route maps it to `painted`).
  - `fitRanges(ranges: RangeSnapshot[], len: number): { ranges: RangeSnapshot[]; warnings: string[] }`. Shorter: drop ranges that start at or past `len`, cut the last one. Longer: the last range grows to the end; its paint repeats its last color. An Every range that becomes too short (Plan decision 4) turns into All with its first slot and a warning.
  - `resolveSlot(slot: SlotLook, lists: Lists): { slot: SlotLook; warnings: string[] }`. Keep `fx` when `lists.effects[fx] === fxName`; else use `indexOf(fxName)`; else 0 "Solid" with a warning. The same for `pal` with 0 "Default".
  - `sceneToPatch(snapshot: StrandSnapshot, ledCount: number, strand: Strand, lists: Lists): { next: StrandPatch; warnings: string[] }`. It adds the LED-count warning when `strand.len !== ledCount`. Slots get `on` = `snapshot.on`.
  - `lookToPatches(look: Look, targets: { strand: StrandView; range?: string }[], lists: Lists): { patches: { key: string; next: StrandPatch }[]; warnings: string[] }`. A target with no `range` covers every range of the strand. Each target range keeps `name`, `start` and `len`, takes the look's pattern and slots (`on: true`), and loses `paint`. A range too short for the look is skipped with a warning.

- [ ] **Step 1: Write the failing tests.**
  - `fitRanges` of `[A 0-100, B 100-150]` to 120 → `[A 0-100, B 100-120]`; to 90 → `[A 0-90]`; to 200 → B is 100-200.
  - An Individual last range grown by 2 → its paint ends with two copies of its last color.
  - Every 4 group 2 over 10 LEDs fitted to 6 → All with slot 0, warning "Patio is too short for Every 4 now, so it uses All."
  - `resolveSlot` with `fxName: "Rainbow"` at `fx 2` and `lists.effects[9] === "Rainbow"` → `fx 9`. With `fxName: "Twinkle"` (missing) → `fx 0`, `fxName "Solid"`, warning "Twinkle isn't on this controller. Solid is used instead." With `palName: "Ocean"` missing → `pal 0`, warning "Ocean isn't on this controller. Default is used instead."
  - `sceneToPatch` with `ledCount` 150 and a strand of 100 → `warnings[0]` is "The strand has 100 LEDs now, not 150. The ranges were fitted to the new length."
  - `lookToPatches` with Every 2 group 3 on targets `[{ strand: o0 }]` (ranges Patio, Kitchen) → both ranges Every 2 group 3, names and positions kept. On a 3-LED range → skipped, warning "Rest is too short for this look."
  - `lookFromRange` of an Individual range → throws.
- [ ] **Step 2: Run** `pnpm test server/lights/snapshots.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights/snapshots.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): snapshot strands as scenes and ranges as looks`

### Task 7: Lights runtime, startup preset and device lights service

review: yes (in-memory timers, writes to device flash)

**Files:**
- Create: `server/lights/startup.ts`, `server/lights/runtime.ts`, `server/lights/deviceLights.ts`
- Modify: `server/app.ts` (AppDeps, ServerDeps, onClose), `server/server.ts`, `test/testApp.ts`, `CONVENTIONS.md` §5
- Test: `server/lights/startup.test.ts`, `server/lights/runtime.test.ts`

**Interfaces:**
- Consumes: `deviceRequest`, `DeviceRow`, `targetOf`, `devices`, `strandGroups`, `preferences` (prior tasks, Task 1); layout functions (Tasks 4, 5).
- Produces:
  - `AppDeps` adds `flashMs: number` (3000 in `server.ts`) and `startupDelayMs: number` (5000). `makeTestApp` options add `flashMs?` and `startupDelayMs?`, both default `60_000`, so other tests never see a timer fire.
  - `type ServerDeps = AppDeps & { lights: LightsRuntime }`. `buildApp` creates the runtime, passes `ServerDeps` to route plugins that need it, and calls `lights.close()` in an `onClose` hook.
  - `const STARTUP_ID = 250`; `buildStartupPreset(state: WledState, paint: PaintMap, maxseg: number): Record<string, unknown>` → `{ psave: 250, o: true, n: "Strand: startup", bootps: 250, seg }` with `seg` as Plan decision 2 says. A listed segment body has every `WledSeg` field, plus `i` (from `encodePaint`) when its name ends in `" paint"` and `paint` has it. A segment named `FLASH_NAME` is written as `{ id, stop: 0 }`. No top-level `on` or `bri` (Plan decision 1).
  - `createLightsRuntime(deps: AppDeps): LightsRuntime` with:
    - `afterWrite(row: DeviceRow): void`. It restarts the device's startup timer at `startupDelayMs`. When it fires, it sends `GET /json/state`, `GET /json/info` (for `maxseg`), and one `POST /json/state` with `buildStartupPreset`, using `paintFor`. If a save for this device is in flight, it starts the timer again. A failure is logged with the device ID only. After a save succeeds, the device's paint memory is cleared.
    - `rememberPaint(deviceId: string, paint: PaintMap): void` (merge) and `paintFor(deviceId: string): PaintMap`.
    - `startFlash(deviceId: string, end: () => Promise<void>): void`. It cancels the device's previous flash timer without running its `end`, and runs `end` after `flashMs`.
    - `flashActive(deviceId: string): boolean`; `close(): void` (clears every timer).
  - In `deviceLights.ts`:
    - `type DeviceLights = { row: DeviceRow; state: WledState; info: WledInfo; lists: Lists; strands: Strand[]; paint: PaintMap; view: LightsView }`.
    - `readDeviceLights(deps: ServerDeps, row: DeviceRow): Promise<DeviceLights>`. Requests in this order: `/json/cfg`, `/json/state`, `/json/info`, `/json/effects`, `/json/palettes`, then `/presets.json` only when a listed segment name ends in `" paint"`. Paint = preset 250's `i` arrays by segment name (`decodePaint`), overridden by `paintFor`. It deletes dropped groups from `strand_groups` and adds the notice. With `info.leds.matrix`, the view is `{ ..., strands: [], matrix: true }`.
    - `writeLayout(deps: ServerDeps, d: DeviceLights, write: LayoutWrite): Promise<DeviceLights>`. It posts each `seg` request, reads `/json/state` again, posts each paint entry as `{ seg: { id, i } }` with the ID found by name (chunks of at most 256 runs), remembers the paint, calls `afterWrite`, and returns `readDeviceLights`.
    - `setDevicePower(deps: ServerDeps, row: DeviceRow, patch: LightsPatch): Promise<void>`. With `on: true`, it reads `/json/state` and the paint, and sends one `POST /json/state` with `on`, `bri` (when given) and `seg: [{ id, i }]` for each painted segment. Otherwise it sends only `on` and `bri`. It does not call `afterWrite`.
    - `deviceError(e: LayoutError, strandName: string): ApiError` (maps to the contract statuses and messages).

- [ ] **Step 1: Write the failing tests.**
  - `buildStartupPreset` with listed IDs 0 and 2, `maxseg` 4, and paint for "Peak paint" (ID 2) → `seg` is `[{id:0,...}, {id:1,stop:0}, {id:2,...,i:[...]}, {id:3,stop:0}]`; the object has no `on` and no `bri` key.
  - Review Focus 3: a listed segment "Strand flash" at ID 3 → `seg[3]` is `{ id: 3, stop: 0 }`. With `rememberPaint` set and no paint in `/presets.json`, the fired `psave` body has the remembered `i`.
  - Runtime against a fake, `startupDelayMs` 80: `afterWrite` twice, 30 ms apart → no `psave` before 80 ms after the second call, and exactly one `psave` request after 200 ms.
  - Apply the startup preset body to a fresh sim (one boot segment over all LEDs, and also a sim with two auto segments) with `applyPost` → `listState` has the same segments, geometry and names as the state it was built from.
  - `close()` after `afterWrite` → no `psave` after 200 ms.
  - `startFlash` twice, 10 ms apart, `flashMs` 50 → the first `end` never runs; the second runs once.
- [ ] **Step 2: Run** `pnpm test server/lights/startup.test.ts server/lights/runtime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the CONVENTIONS.md §5 sentence "The server keeps no device state, connection or queue in memory between requests." with: "The server keeps no state that must survive a restart. `server/lights/runtime.ts` holds the only in-memory state: the 3-second flash timer, the 5-second startup-preset timer, and the paint it last sent, per device."
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights server/app.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add the lights runtime and the startup preset`

### Task 8: Lights read, device power and flash endpoints

review: no

**Files:**
- Create: `server/routes/lights.ts`
- Modify: `server/app.ts` (register `lightsRoutes`), `server/routes/control.ts` (`PATCH state` uses `setDevicePower`)
- Test: `server/routes/lights.test.ts`, `server/routes/control.test.ts`

**Interfaces:**
- Consumes: `readDeviceLights`, `writeLayout`, `setDevicePower`, `deviceError`, `ServerDeps` (Task 7); `loadDevice` (prior Task 8); `FLASH_NAME`, `readStrand` (Task 4).
- Produces: `lightsRoutes(app: FastifyInstance, deps: ServerDeps)` with `GET lights`, `PATCH lights`, `POST lights/flash`. Tasks 9 and 10 add the other Lights endpoints to this file.
  - `GET lights`: when `flashActive` is false and a listed segment is named `FLASH_NAME`, first send `{ seg: [{ id, stop: 0 }] }` for each, then read.
  - `PATCH lights`: `setDevicePower`, then `readDeviceLights`.
  - `POST lights/flash { strandKey, led }`: `led` is an integer in `[0, strand.len)`. The ID is the highest ID below `maxseg` that is not listed (spec §6.6, "the highest free ID"; a lower free ID never overwrites a live segment). One `POST /json/state` deletes every listed flash segment and creates `{ id, start, stop: start + 1, fx: 0, col: [[255,255,255]], bri: 255, on: true, n: "Strand flash" }` (`start` = strand start + `led`). Then `startFlash` with an `end` that reads the state and deletes the segments named `FLASH_NAME`. Answer 204. No free segment → `422 segment_budget`, `need` 1.

- [ ] **Step 1: Write the failing tests.**
  - `GET lights` on Backyard → 200; two strands, both `shared`; `segments: { used: 1, max: 32 }`; `notices: []`; `matrix: false`. The fake got `/json/cfg`, `/json/state`, `/json/info`, `/json/effects`, `/json/palettes` and no `POST`.
  - A leftover "Strand flash" segment (`fake.applyState`) → the fake got a `POST` that deletes it, and no range shows it.
  - `infoOverride: { leds: { ...seed.info.leds, matrix: { w: 16, h: 16 } } }` → `matrix: true`, `strands: []`.
  - A stored group `o0+o1` and a config where o1 starts at 160 → `notices: ["A combined strand was separated because its LED outputs no longer touch."]` and `strandGroups.list` is `[]`.
  - `PATCH lights { on: false }` → the fake got one `POST` with exactly `{ on: false }`; the response has `on: false`.
  - Review Focus 5: on Front Roof, `PATCH strands/o0` with "Gutter" All 0-200 and "Peak" Individual 200-300 (candy-cane paint), then `PATCH lights { on: false }`. `PATCH state { on: true }` → one `POST` whose body has `on: true` and `seg: [{ id, i: [...] }]`; afterward the fake segment "Peak paint" has `frz: true` and its pixels equal the paint. The same for `PATCH lights { on: true }`.
  - `PATCH lights` with `{}`, `{ on: "true" }`, `{ bri: 256 }`, `{ seg: [] }` → `400 invalid_request`; no `POST`.
  - Split Backyard, `flashMs` 60: `POST flash { strandKey: "o1", led: 0 }` → 204; the fake got `{ id: 31, start: 150, stop: 151, fx: 0, col: [[255,255,255]], bri: 255, on: true, n: "Strand flash" }` in a `seg` array; 200 ms later no listed segment is "Strand flash".
  - A second flash 10 ms after the first → its `POST` deletes the first flash segment; one flash segment is listed.
  - `led: 150` on o1 → 400. `strandKey: "o9"` → `409 strand_changed`. All 32 IDs listed → `422 segment_budget` with `need: 1`.
- [ ] **Step 2: Run** `pnpm test server/routes/lights.test.ts server/routes/control.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Validate bodies in the handler (the prior plan's Task 10 note on Fastify's Ajv options applies).
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lights.test.ts server/routes/control.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add lights view, device power and LED flash endpoints`

### Task 9: Strand edit and shared-segment endpoints

review: no

**Files:**
- Modify: `server/routes/lights.ts`, `server/lights/layout.ts`
- Test: `server/routes/lightsStrand.test.ts`

**Interfaces:**
- Consumes: `writeStrand`, `validateRanges`, `LayoutError` (Task 5); `readStrand` (Task 4); `readDeviceLights`, `writeLayout`, `deviceError` (Task 7).
- Produces:
  - `PATCH lights/strands/:key` (`bodyLimit: 262144`): validate the body, find the strand (`409 strand_changed`), `validateRanges` (`422 invalid_layout`), `writeStrand`, `writeLayout`. Answer the new `LightsView`.
  - `POST lights/strands/:key/resolve { action: "split" | "combine" }`. The strand must be `shared`; else answer the current view. `combine`: save the group of the strand and every strand in `shared.with`, joined with `+` in LED order (`strandGroups.replace` with the other groups kept), with no device write. `split`: `splitShared`, then `writeLayout`.
  - In `server/lights/layout.ts`: `splitShared(state: WledState, touched: Strand[], maxseg: number): LayoutWrite`. One request: the first crossing segment is overwritten as the first touched strand's All range "Range 1" (`grp 1`, `spc 0`, its old slot fields); each other touched strand gets a new segment with the same slot (IDs by the Task 5 rule); every other crossing or inside segment of the touched strands is deleted. Budget as in Task 5.

- [ ] **Step 1: Write the failing tests.**
  - Backyard seed: `PATCH strands/o0` with two ranges → `409 shared`, message "Strand 1 shares a segment with another strand. Choose Split or Combine on the Lights tab first."
  - `PATCH strands/o0 { bri: 90 }` on the seed → the shared segment gets `bri: 90`.
  - `resolve { action: "split" }` → listed segments are 0-150 "Range 1" and 150-300 "Range 1", each with the old `col`, `fx` and `pal`.
  - `resolve { action: "combine" }` → `strandGroups.list` is `["o0+o1"]`; the view has one strand `o0+o1` with one All range; the fake got no `POST`.
  - After split, `PATCH strands/o0` with "A" All 0-75 and "B" Every 2 group 1 75-150 → the response ranges equal the request ranges (names, positions, patterns, slots); o1's segment is deep-equal to before.
  - With `startupDelayMs` 50: 200 ms after that write, the fake got one `psave` request.
  - Review Focus 1: a range of 4 LEDs with Every 3 group 2 → `422 invalid_layout`, no `POST`.
  - A layout that needs more segments than are free → `422 segment_budget` with `need`.
  - `{}`, `{ ranges: "x" }`, `{ bri: 0 }`, `{ on: true, x: 1 }` → `400 invalid_request`.
  - A strand with a foreign `grp 3` segment → its first `PATCH` overwrites that segment with `grp 1`.
- [ ] **Step 2: Run** `pnpm test server/routes/lightsStrand.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lightsStrand.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add strand edit and shared segment endpoints`

### Task 10: Strand groups and strand names

review: no

**Files:**
- Modify: `server/routes/lights.ts`, `server/routes/devices.ts` (delete the name preference)
- Test: `server/routes/lightsGroups.test.ts`, `server/routes/devices.test.ts`

**Interfaces:**
- Consumes: `strandGroups`, `preferences.get`, `preferences.put`, `preferences.remove` (Task 1); `readDeviceLights`, `writeStrand`, `writeLayout` (Tasks 5, 7).
- Produces:
  - `GET strand-groups` → `string[]`.
  - `PUT strand-groups { keys: string[] }` → `LightsView`. Each key names two or more existing outputs that touch in key order, and no output is in two keys; else `422 not_adjacent`. For each group that is removed: if a range of the combined strand crosses a member boundary, cut the ranges at the boundaries (each piece keeps the name, pattern and slots; paint is cut by position), and call `writeStrand` once on the combined strand with the cut ranges before the groups change. Do not call `validateRanges` on the cut ranges (the two pieces share a name). Then save the groups. A new group needs no device write.
  - `PUT strand-names { names: Record<string, string> }` → `LightsView`. Each key must be a current strand key (`409 strand_changed`). A trimmed empty value deletes the name; more than 64 characters → `422 invalid_name`. Stored as the preference `strandNames.<deviceId>`.
  - `DELETE /api/devices/:id` also removes `strandNames.<id>`.

- [ ] **Step 1: Write the failing tests** (split Backyard):
  - `PUT strand-groups { keys: ["o0+o1"] }` → view with strand `o0+o1`; `GET strand-groups` → `["o0+o1"]`; no device `POST`.
  - `["o0+o2"]`, `["o0"]`, `["o1+o0"]` → `422 not_adjacent`.
  - Combined strand with "Middle" All 100-200 → `PUT { keys: [] }` → listed segments include "Middle" 100-150 and "Middle" 150-200.
  - `PUT strand-names { names: { o0: "Eaves" } }` → strand o0 name "Eaves". `{ o0: "" }` → "Strand 1". `{ o9: "x" }` → `409 strand_changed`. A 65-character name → `422 invalid_name`.
  - `DELETE /api/devices/:id` → `preferences.get(db, "strandNames.<id>")` is `undefined`.
- [ ] **Step 2: Run** `pnpm test server/routes/lightsGroups.test.ts server/routes/devices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lightsGroups.test.ts server/routes/devices.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add strand combinations and strand names`

### Task 11: Scene endpoints

review: no

**Files:**
- Create: `server/routes/presets.ts`
- Modify: `server/app.ts` (register `presetsRoutes`)
- Test: `server/routes/scenes.test.ts`

**Interfaces:**
- Consumes: `scenes` (Task 1); `snapshotStrand`, `sceneToPatch` (Task 6); `writeStrand`, `segmentsNeeded` (Task 5); `readDeviceLights`, `writeLayout`, `deviceError` (Task 7).
- Produces: `presetsRoutes(app, deps: ServerDeps)` with the scene endpoints of spec §9. `toScene(row: SceneRow): Scene` computes `summary`. `GET`, `PATCH` and `DELETE` use only the database. `POST` and `apply` need the device. Content over 65536 bytes of JSON → `422 invalid_layout` "This setup is too large to save." Apply on a shared strand → `409 shared`.

- [ ] **Step 1: Write the failing tests** (split Backyard):
  - `POST scenes { name: "Party", strandKey: "o0" }` → 201 `{ name: "Party", strandKey: "o0", ledCount: 150, summary: "1 range · 100%" }` (the split segment has `bri` 255). `GET scenes` → one scene.
  - `name: ""`, `"  "`, 65 characters → `422 invalid_name`, "Names need 1 to 64 characters." The 257th scene → `422 too_many`, "A device can keep 256 scenes." `strandKey: "o9"` → `409 strand_changed`.
  - `PATCH` → new name. `DELETE` → 204. `DELETE` again → `404 not_found`, "That scene was deleted."
  - Save, change o0 to two ranges, `apply` → 200, `warnings: []`; the view's o0 equals the saved strand; the fake's o0 segments are one segment 0-150.
  - Config o0 `len` 100 (o1 `start` 100): `apply` → `warnings[0]` is "The strand has 100 LEDs now, not 150. The ranges were fitted to the new length."
  - A saved `fxName` that the device no longer has → `warnings` contains "<name> isn't on this controller. Solid is used instead."
  - `GET scenes` while the device is offline → 200.
- [ ] **Step 2: Run** `pnpm test server/routes/scenes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/scenes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add scene endpoints`

### Task 12: Look endpoints

review: no

**Files:**
- Modify: `server/routes/presets.ts`
- Test: `server/routes/looks.test.ts`

**Interfaces:**
- Consumes: `looks` (Task 1); `lookFromRange`, `lookToPatches` (Task 6); `segmentsNeeded`, `writeStrand` (Task 5); `readDeviceLights`, `writeLayout` (Task 7).
- Produces: the look endpoints of spec §9. `apply { targets: LookTarget[] }` (1-64 targets): every strand key must exist (`409 strand_changed`) and not be shared (`409 shared`); a named range must exist (`404 not_found`, "That range isn't on the strand any more. Pick it again."). Check the total `segmentsNeeded` against the free count before any write (`422 segment_budget`). Then write the strands one at a time. Answer `{ view, warnings }`.

- [ ] **Step 1: Write the failing tests** (split Backyard, o0 with "Patio" Every 2 group 2 0-60 and "Rest" All 60-150):
  - `POST looks { name: "Candy", strandKey: "o0", range: "Patio" }` → 201; `look.pattern` is `{ kind: "every", n: 2, group: 2 }`; slots have no `on`.
  - `range: "Nope"` → `404 not_found`. An Individual range → `422 painted`, "A range with painted LEDs can't be saved as a look." The 257th look → `422 too_many`.
  - `apply { targets: [{ strandKey: "o0" }] }` → Patio and Rest are Every 2 group 2 with the look's colors; names and positions kept.
  - `apply { targets: [{ strandKey: "o1", range: "Range 1" }] }` → only o1 changes.
  - Targets whose total need exceeds the free count → `422 segment_budget`, and the fake got no `POST`.
  - Backyard seed (shared) → `409 shared`.
- [ ] **Step 2: Run** `pnpm test server/routes/looks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/looks.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add look endpoints`

### Task 13: Browser API client additions

review: no

**Files:**
- Modify: `src/api/client.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**
- Consumes: the contract types (Task 1); the private `request<T>` and `ApiError` (prior Task 11).
- Produces, on `api`, with the mock's names (lines 605-633): `getLights(id): Promise<LightsView>`, `patchLights(id, body: LightsPatch)`, `patchStrand(id, key, body: StrandPatch)`, `resolveShared(id, key, action: "split" | "combine")`, `flash(id, strandKey, led): Promise<void>`, `getStrandGroups(id): Promise<string[]>`, `putStrandGroups(id, keys)`, `putStrandNames(id, names: Record<string, string>)`, `getScenes(id)`, `createScene(id, body: { name: string; strandKey: string }): Promise<Scene>`, `renameScene(id, sceneId, name)`, `deleteScene(id, sceneId)`, `applyScene(id, sceneId): Promise<ApplyResult>`, `getLooks(id)`, `createLook(id, body: { name: string; strandKey: string; range: string }): Promise<LookRecord>`, `renameLook(id, lookId, name)`, `deleteLook(id, lookId)`, `applyLook(id, lookId, targets: LookTarget[]): Promise<ApplyResult>`. Every path segment goes through `encodeURIComponent`.

- [ ] **Step 1: Write the failing tests.** Add one table row per function: method, path and body. Examples: `patchStrand("a/b", "o0+o1", { on: true })` → `PATCH /api/devices/a%2Fb/lights/strands/o0%2Bo1`, body `{"on":true}`. `resolveShared("d", "o0", "split")` → `POST /api/devices/d/lights/strands/o0/resolve`, body `{"action":"split"}`. `flash("d", "o1", 5)` → `POST /api/devices/d/lights/flash`, body `{"strandKey":"o1","led":5}`, resolves `undefined` on 204. `applyLook("d", "l", [{ strandKey: "o0" }])` → body `{"targets":[{"strandKey":"o0"}]}`.
- [ ] **Step 2: Run** `pnpm test src/api/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/api/client.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add lights, scene and look API functions`

### Task 14: Design-system primitives, icons and toasts

review: no

**Files:**
- Modify: `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/icon.tsx`, `src/store/index.ts` (add `toasts`), their stories
- Create: `src/components/ui/switch.tsx`, `slider.tsx`, `sheet.tsx`, `dropdownMenu.tsx`, `badge.tsx`, `skeleton.tsx`, `stepper.tsx`, `toaster.tsx`, each with a `*.stories.tsx`; `src/store/slices/toasts.ts`
- Test: `src/components/ui/primitives.test.tsx`, `src/store/slices/toasts.test.ts`

**Interfaces:**
- Consumes: the design's class strings (lines 1825-1949) and `ICON_PATHS` (lines 143-197).
- Produces:
  - `Button` props: `variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "destructive-outline" | "destructive-ghost"`, `size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "inline"` (the design's `button()`, line 1857). `Dialog*` restyled with the design's `DIALOG_*` strings; keep Radix.
  - `Icon` takes the lucide names that the design uses (`ICON_PATHS` keys). Keep the existing names that current components use.
  - `Switch({ checked, onCheckedChange, "aria-label", disabled })` (`role="switch"`, design `SWITCH`).
  - `Slider({ value, min = 1, max = 255, onValueChange, onValueCommit, "aria-label", id, disabled })`: a native `input type="range"` with the design's track, range and thumb. `onValueCommit` runs on `change` (release, or each key press).
  - `Sheet`, `SheetContent` (Radix Dialog; bottom below 900 px, right side at `min-[900px]:`), `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`.
  - `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` (Radix; an item with `reason` is `aria-disabled` with `title={reason}` and does not run).
  - `Badge({ variant: "default" | "info" | "warning" | "danger" | "success" })`, `Skeleton({ className })`, `Stepper({ id, label, value, decReason, incReason, onStep(dir: -1 | 1), unit })` (design lines 4685-4703).
  - `toastsSlice` (`{ items: { id: number; kind: "success" | "error" | "info"; title: string; desc: string }[] }`, at most 3), and the thunk `toast(kind, title, desc?)` that adds an item and removes it after 4200 ms. `Toaster({ items })` renders them in an `aria-live="polite"` region.
- No component file calls a React hook. `pnpm lint` enforces it.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - `Slider` value 10, `ArrowRight` → `onValueCommit(11)`.
  - `Switch` click → `onCheckedChange(true)`, and `aria-checked` follows `checked`.
  - `Stepper` with `incReason` "x" → the plus button has `aria-disabled="true"`, `title="x"`, and a click does not call `onStep`.
  - `DropdownMenuItem` with `reason` → a click does not call `onSelect`.
  - Toasts: with fake timers, `toast("error", "A")` four times → 3 items; after 4200 ms → 0 items.
- [ ] **Step 2: Run** `pnpm test src/components/ui/primitives.test.tsx src/store/slices/toasts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add Radix parts from the installed `radix-ui` package. Write each story. Change every existing use of the old `Button` variants (`primary`, `subtle`) and sizes (`md`) in `src/` to the new names.
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/ui src/store`. Open `pnpm storybook` and check each new story in light and dark: tokens match the design, focus rings show, and the sheet is a bottom sheet at 375 px and a side sheet at 1440 px.
- [ ] **Step 5: Commit.** `feat(web): add the design's switch, slider, sheet, menu and toast primitives`

### Task 15: Lights model helpers

review: no

**Files:**
- Create: `src/lights/model.ts`
- Test: `src/lights/model.test.ts`

**Interfaces:**
- Consumes: `RangeView`, `StrandView`, `SlotView`, `Pattern`, `Effect`, `Palette`, `LightsView` (Task 1).
- Produces (typed ports of the design functions; the implementer ports each one as written, except where this block says otherwise):
  - From lines 4253-4330: `SLOT_COLORS`, `COLOR_NAMES`, `COLOR_SLOT_LABELS`, `LOCKED`, `colorName(hex)`, `segsOf(ranges)`, `freeSegs(view)`, `needMsg(need, free)`, `patternText(p)`, `rangeSummary(r)`, `usesPalette(fxs: Effect[], slot)`, `slotColorAt(fxs, pals, slot, t)` (empty `stops` → `col[0]`), `slotBackground`, `slotText(fxs, slot)`, `ledColors(fxs, pals, strand)`, `rangeColors`, `nextRangeName(ranges)`, `newSlot(slots)`, `withPattern(fxs, pals, r, p)`, `everyPreview(n, g)`; and `rangeLabel(r)` (line 1758), `pinLabel(pins)` (line 1753), `briToPct` (line 209), `plural` (line 243).
  - From lines 4917-5045: `splitRange(rs, i, name)` (Add range), `mergeInto(fxs, pals, rs, keep, drop)`, `moveBoundary(rs, i, led): RangeView[] | null`.
  - From lines 4530-4540 and 5854-5860: `adjacentPairs(view)`, `cutRanges(ins: LedOutput[], strand)`.
  - New: `minLen(r: RangeView): number` = `(n − 1) · group + 1` for Every, else 1. `moveBoundary` clamps the boundary to `[a.start + minLen(a), b.start + b.len − minLen(b)]`.
  - New: `stepReasons(r, free): { nDown: string; nUp: string; gDown: string; gUp: string }` (design lines 4740-4752) plus two length reasons: `nUp` "This range is too short for another slot." when `n · g ≥ len`; `gUp` "This range is too short for a bigger group." when `(n − 1)(g + 1) ≥ len`.
  - New: `kindReason(r, kind, free, locked): string` (design lines 4710-4716).

- [ ] **Step 1: Write the failing tests.**
  - `everyPreview(2, 2)` → `"1 1 2 2 1 1 2 2 …"`.
  - `withPattern` of an All range with slot `#FFB46B` to Every 2 → two slots; slot 2's `col[0]` is `[255,0,0]` (the first unused `SLOT_COLORS` entry).
  - `withPattern` to Individual → `paint` is `rangeColors` of the old range.
  - `splitRange` of a 5-LED range → lengths 2 and 3.
  - `moveBoundary` with an Every 3 group 2 range at 0-10 and a next range → a target of 3 clamps to 5.
  - `stepReasons` with n 16 → `nUp` "A range can have at most 16 slots."; n 3 g 100 → `gUp` "With 3 slots, a group can be at most 127 LEDs."; Every 2 group 2 over 4 LEDs → `nUp` "This range is too short for another slot."
  - `ledColors` for Every 2 group 2 with red and blue slots over 8 LEDs → `R R B B R R B B` as hex.
  - `needMsg(2, 1)` → "This needs 2 more segments and 1 is free. Remove a range first."
- [ ] **Step 2: Run** `pnpm test src/lights/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/lights/model.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add pure lights model helpers`

### Task 16: Lights store with the write queue

review: yes (optimistic writes, one request in flight per strand, rollback)

**Files:**
- Create: `src/store/slices/lights.ts`, `src/store/slices/preferences.ts`
- Modify: `src/store/index.ts`
- Test: `src/store/slices/lights.test.ts`, `src/store/slices/preferences.test.ts`

**Interfaces:**
- Consumes: `api` (Task 13); `toast` (Task 14); `segsOf`, `freeSegs`, `needMsg` (Task 15); `createApiThunk` (prior Task 1).
- Produces:
  - `type ApiErrorPayload = { status?: number; code?: string | number; message: string }` (the rejected payload of `createApiThunk`).
  - State: `{ devices: Record<string, { view: LightsView | null; status: "idle" | "loading" | "ok" | "error"; error: ApiErrorPayload | null; effects: Effect[] | null; palettes: Palette[] | null; selected: string | null; selRange: Record<string, number>; flash: { key: string; led: number } | null }>; writes: Record<string, { busy: boolean; base: LightsView | null; dirty: ("on" | "bri" | "ranges")[]; hold: boolean }> }`. Write key: `` `${deviceId}|${strandKey}` ``.
  - Thunks: `loadLights(id)`, `loadFxLists(id)` (effects and palettes), `editStrand({ id, key, patch: Partial<Pick<StrandView, "on" | "bri" | "ranges">> }): boolean`, `beginPaint({ id, key })`, `endPaint({ id, key })`, `flashLed({ id, key, led })`, `resolveShared({ id, key, action })`, `setStrandGroups({ id, keys })`, `setStrandName({ id, key, name })`, `adoptView({ id, view })`.
  - Actions: `selectStrand({ id, key })`, `selectRange({ id, key, i })`, `paintCells({ id, key, i, from, to, color })`.
  - Selectors: `selectLights(state, id)`, `selectedStrand(state, id)` (the selected strand, else the first).
  - Preferences slice: `{ recentColors: string[]; favoriteEffects: string[]; loaded: boolean }`; thunks `loadPreferences()` (keys `recentColors`, `favorites.effects`), `pushRecentColor(hex)` (front, unique, at most 8, then `putPreference`), `toggleFavoriteEffect(name)`.

**The queue** (port of design lines 4335-4440, without module-level state):

1. `editStrand` computes `need = segsOf(next.ranges) − segsOf(current.ranges)` for a `ranges` patch on a strand that is not shared. If `need > freeSegs(view)`, it dispatches `toast("error", "Not enough segments", needMsg(need, free))`, sends nothing, and returns `false`.
2. Otherwise it applies the patch to the view at once (and adds `need` to `segments.used`), records `base` when the channel has none, and adds the fields to `dirty`. If the channel is not busy and not on `hold`, it starts the pump.
3. The pump sets `busy`, builds the body from the current view's values for the `dirty` fields, clears `dirty`, and calls `api.patchStrand`. When it ends, if `dirty` is not empty and `hold` is false, it sends again. Otherwise it clears `base` and adopts the answer: every strand of the answer, except strands whose own channel is busy, which keep their current view.
4. On an error: restore `base`, clear the channel, and dispatch `toast("error", "Couldn't change the lights", e.message)`. On `strand_changed`, also `loadLights(id)`.
5. `beginPaint` sets `hold` and records `base`. `endPaint` clears `hold`, adds `ranges` to `dirty`, and starts the pump.
6. `flashLed` calls `api.flash`, sets `flash`, and clears it after 3000 ms if it is still the same flash. On an error: `toast("error", "Couldn't flash the LED", e.message)`.

- [ ] **Step 1: Write the failing tests** (a real store; `api` functions stubbed with controllable promises):
  - Review Focus 4: edit o0's ranges twice while the first `patchStrand` is pending → still one call; after it resolves, exactly one more call whose body has the second edit's ranges; the final view is the second answer.
  - The first call rejects with `ApiError(504, "device_offline", "m")` → the view equals the view before both edits; `dirty` is empty; the toasts have "Couldn't change the lights".
  - An edit on o1 is in flight when o0's answer arrives → o1 keeps its optimistic view.
  - `free` 1 and an edit that needs 2 → returns `false`, no API call, toast "Not enough segments".
  - `strand_changed` rejection → `getLights` is called again.
  - `beginPaint`, three `paintCells`, `endPaint` → one `patchStrand` call with the painted ranges.
  - `pushRecentColor` nine times → 8 colors, newest first; `putPreference("recentColors", ...)` called.
- [ ] **Step 2: Run** `pnpm test src/store/slices/lights.test.ts src/store/slices/preferences.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the queue state in the slice. The pump is a thunk that reads `getState()`.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/store`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add the lights store with optimistic strand writes`

### Task 17: Device page shell

review: no

**Files:**
- Create: `src/screens/deviceScreen.tsx`, `src/store/slices/devicePage.ts`, `src/components/device/deviceHeader.tsx`, `src/components/device/deviceBanners.tsx`, `src/components/device/settingsPanel.tsx`, `src/components/appHeader.tsx`, stories for each component
- Modify: `src/router.tsx`, `src/store/index.ts`
- Test: `src/screens/deviceScreen.test.tsx`, `src/store/slices/devicePage.test.ts`

**Interfaces:**
- Consumes: `fetchDevices`, `devicesSlice` (prior Task 11); `api.getState`, `api.patchState`, `api.getInfo`, `api.getPendingReboot`, `api.reboot`; `adoptView`, `lights` thunks (Task 16); primitives (Task 14); `withRouter`.
- Produces:
  - Routes: `devices/:id` and `devices/:id/settings/*` → `DeviceScreen`.
  - `devicePageSlice`: `{ byId: Record<string, { state: { on: boolean; bri: number } | null; info: WledInfo | null; pending: string[] }> }`; thunks `loadDeviceState(id)`, `loadInfo(id)`, `loadPending(id)`, `setPower({ id, on })` (optimistic on both this slice and the lights view; rollback and toast on error), `rebootNow(id)`, `retryDevice(id)`.
  - `DeviceScreen`: `compose(withRouter, connect(...), withActions(...), lifecycle(...))`. It loads the device list, then the state, info and pending list for an online device. It renders `AppHeader`, `DeviceHeader`, `DeviceBanners`, the tab list, and the tab panel: `LightsTab` (Task 18), `PresetsTab` (Task 22), or `SettingsPanel`. The tab comes from the path and `?tab=presets`.
  - Layout and copy: design lines 2775-2867 (`DevicePage`, `HeaderPower`, `OfflineBanner`, `PendingRebootBanner`) and `StatusText` (line 2418). The tabs are links with `role="tab"` and `aria-selected`, classes `TABS_LIST` and `TABS_TRIGGER` (lines 1910-1912). "Reboot now" opens a confirm dialog with the title "Reboot <name>?" and the buttons Cancel and Reboot.
  - `SettingsPanel`: a card with "Open WLED Advanced UI" (`href="http://<host>/settings"`, `target="_blank"`, `rel="noreferrer"`) (Plan decision 18).
  - `AppHeader`: the design's `Header()` (line 2462) without the theme menu, and the `StrandMark` (line 2439). It renders `Toaster`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`; a real store, `fetch` stubbed):
  - `/devices/<id>` → heading "Backyard", "Online", the host, three tabs; "Lights" has `aria-selected="true"`.
  - `/devices/<id>?tab=presets` → "Presets" is selected. `/devices/<id>/settings` → "Settings" is selected and the "Open WLED Advanced UI" link has `href` `http://wled-backyard.local/settings`.
  - Unknown ID → "This device isn't in Strand" and a "Back to devices" link.
  - An offline device → "Backyard is offline" and a Retry button; no header switch.
  - `info.live: true` → "Receiving live data from another source. Changes may not be visible until it stops."
  - Pending `["hostname"]` → "The new hostname takes effect after a reboot."
  - The header switch → `PATCH /api/devices/<id>/state` with `{"on":false}`; the switch shows off before the reply.
- [ ] **Step 2: Run** `pnpm test src/screens/deviceScreen.test.tsx src/store/slices/devicePage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/screens src/store`. Run the app ("Running the app for screenshots"). Screenshot the device page at 375, 768 and 1440 px: no horizontal scroll; tabs fill the width below 640 px; Tab reaches the back link, the switch and each tab with a visible focus ring.
- [ ] **Step 5: Commit.** `feat(web): add the device page with lights, presets and settings tabs`

### Task 18: Lights tab, strand panel and strip

review: no

**Files:**
- Create: `src/components/lights/lightsTab.tsx`, `strandPicker.tsx`, `strandPanel.tsx`, `strip.tsx`, with stories
- Modify: `src/screens/deviceScreen.tsx` (pass lights props)
- Test: `src/components/lights/strip.test.tsx`, `src/components/lights/lightsTab.test.tsx`

**Interfaces:**
- Consumes: the lights slice and thunks (Task 16); model helpers (Task 15); primitives (Task 14).
- Produces:
  - `LightsTab({ device, lights, prefs, actions })`: the offline panel (`TabOffline`, line 4500, "The lights are"), the skeleton (line 4504), the load error with "Try again" (line 4513), notices, the matrix message "2D matrix layouts aren't supported yet." with the "Open WLED Advanced UI" link, `StrandPicker`, `StrandPanel`, and the range list (Task 19).
  - `StrandPicker`: design lines 4540-4562. Hidden when there is one strand.
  - `StrandPanel`: design lines 4565-4612 (name, strand menu with Rename strand and Separate, switch, brightness slider 1-255 that commits on release, `SharedBanner`, strip, Add range with its reason, "Splits <range> in two", "Segments used N of M", the flash line in an `aria-live` region).
  - `Strip`: design lines 4615-4655. Cells: `min(len, 120)`, `gap-px` from `sm:` up. Each boundary between touching ranges is a `role="slider"` with `aria-valuemin` = `a.start + minLen(a)`, `aria-valuemax` = `b.start + b.len − minLen(b)`, `aria-valuenow`, `aria-valuetext="LED <n>"`, label "Boundary between <a> and <b>". Pointer: `onPointerDown` calls `setPointerCapture` when the element has it, and `onPointerMove`/`onPointerUp` on the same element compute the LED from `getBoundingClientRect`. Keys: arrows ±1, Shift ±10, Home, End. Each move calls `editStrand` with `moveBoundary`. A shared strand's handles are `aria-disabled` and `tabIndex={-1}`.
  - Add range: `splitRange`, then `toast("info", "Added <name>", "Drag the new boundary on the strip to move it.")` and focus the new handle.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - A handle at LED 60 between "Patio" (Every 2 group 2, 0-60) and "Kitchen" (60-120): `ArrowRight` → `editStrand` with Patio len 61; `Shift+ArrowRight` → 70; `Home` → `aria-valuemin` 3; `ArrowLeft` at the minimum → no call.
  - A pointer drag from x = 50% to 75% over a 150-LED strip → the last `editStrand` sets the boundary at LED 112 or 113.
  - A single-strand device → no "Strands" group.
  - A shared strand → the banner "Strand 1 and Strand 2 share one segment." with "Split by strand" and "Combine strands"; Add range has `aria-disabled="true"` and the title "Choose Split by strand or Combine strands first."
  - "Segments used 7 of 32" shows the view's numbers.
- [ ] **Step 2: Run** `pnpm test src/components/lights/strip.test.tsx src/components/lights/lightsTab.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app against the demo devices. On Backyard (two strands): screenshot at 375, 768 and 1440 px. Check: no overflow; the strip colors match the ranges; dragging a handle moves the boundary and the fake's segments change (`curl -s 127.0.0.1:18081/json/state`); Tab reaches each handle and the arrows move it; the flash pulse is `motion-safe:` only.
- [ ] **Step 5: Commit.** `feat(web): add the lights tab strand panel and LED strip`

### Task 19: Range cards, pattern controls and lights dialogs

review: no

**Files:**
- Create: `src/components/lights/rangeCard.tsx`, `patternControls.tsx`, `slotRows.tsx`, `lightsDialogs.tsx`, with stories
- Test: `src/components/lights/rangeCard.test.tsx`, `src/components/lights/lightsDialogs.test.tsx`

**Interfaces:**
- Consumes: Tasks 14-16 and 18.
- Produces:
  - `RangeCard`: design lines 4658-4704 (collapsed summary, swatches, Flash start and Flash end with the reason "Flashing needs one free segment. Remove a range first.", the range menu Rename, Merge with next, Delete with reasons). The first card is open by default. Delete runs `mergeInto` and `toast("info", "Deleted <name>", "Its LEDs are part of <into> now.")`.
  - `PatternControls`: design lines 4706-4760, with `kindReason` and `stepReasons` (Task 15).
  - `SlotRows`: design lines 4762-4776. A row opens the slot sheet (Task 20).
  - `LightsDialogs`: `rename` (range or strand; range errors "A range needs a name.", "Use 64 characters or fewer.", "Another range on this strand has that name."; strand help text line 4999), `combine` (lines 5876-5897), `separate` (lines 5898-5917; the cut list uses `api.getConfig` and `cutRanges`). Each uses `Dialog`. Combine calls `setStrandGroups` with the other existing groups plus the new key, then selects it and toasts "Combined <a> and <b>". Separate toasts "Strands separated".

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - Every 16 group 1: the N plus button has the title "A range can have at most 16 slots."
  - Every 2 group 2 over 4 LEDs: the N plus button has the title "This range is too short for another slot." (Review Focus 1).
  - Click "Every N" on an All range with `free` 0 → the button is `aria-disabled`, with the title from `needMsg(1, 0)`.
  - Delete "Kitchen" → `editStrand` merges it into the previous range; a toast "Deleted Kitchen".
  - Rename a range to the name of another range → "Another range on this strand has that name." and no `editStrand`.
  - The combine dialog on Backyard after split → one radio "Strand 1 + Strand 2", "300 LEDs · GPIO 16, 17"; Combine → `PUT /api/devices/<id>/strand-groups` with `{"keys":["o0+o1"]}`.
  - The separate dialog with "Middle" over 100-200 of `o0+o1` → "This range crosses the join and will be cut in two:" and "Middle".
- [ ] **Step 2: Run** `pnpm test src/components/lights/rangeCard.test.tsx src/components/lights/lightsDialogs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app: screenshot an open Every N card at 375 and 1440 px; disabled steppers show their reason on hover and to a screen reader (`aria-describedby`); the range menu opens with Enter and moves with the arrow keys; each dialog traps focus and returns it to its trigger.
- [ ] **Step 5: Commit.** `feat(web): add range cards, pattern controls and lights dialogs`

### Task 20: Slot editor sheet

review: no

**Files:**
- Create: `src/components/lights/slotSheet.tsx`, with a story
- Test: `src/components/lights/slotSheet.test.tsx`

**Interfaces:**
- Consumes: Tasks 14-16; `effects` and `palettes` from the lights slice; the preferences slice.
- Produces: `SlotSheet({ target: { key: string; r: number; s: number } | null, ... })`, design lines 5093-5375:
  - Color: the color slot buttons when the effect has more than one color (labels "Main", "Background", "Accent"); "<effect> takes its colors from the palette." when it has none; the hue and saturation area (`role="slider"`, arrows ±5° and ±5 %, Shift ±30° and ±20 %); the brightness slider 0-100; the hex field with the error "Enter 6 hex digits, like FF8800."; Recent colors (hidden when the list is empty).
  - Effect: search, "Favorites" (stars, by name), "All effects" (Solid first, then by name, `RSVD` removed), "No effects match “<q>”.", then one slider per non-empty `sliders` label (`c3` max 31, others 255) and one checkbox per non-empty `checks` label.
  - Palette: only when `Effect.pal`; search; a gradient swatch from `stops` (empty `stops` → the slot's color); "No palettes match “<q>”."
  - Footer: "Apply to all slots" (more than one slot; toast "<fx> is on N other slot(s) too", "Their colors stay as they were.") and "Done".
  - Each change calls `editStrand` with the changed slot at once; sliders on release. A color commit calls `pushRecentColor`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - Effects `Solid`, `Blink`, `RSVD`, `Breathe` → list order Solid, Blink, Breathe; no RSVD.
  - Pick Blink (colors Fx, Bg) → the color slot group shows "Main" and "Background".
  - Effect Colorloop (`pal: true`, no colors) → "Colorloop takes its colors from the palette." and the Palette section.
  - Type `GG0000` in Hex → "Enter 6 hex digits, like FF8800." and no `editStrand`. Type `00FF00` → `editStrand` with `col[0]` `[0,255,0]`.
  - The `c3` slider has `max="31"`.
  - On the hue area, `ArrowRight` → `editStrand` with a new color.
  - "Apply to all slots" on Every 3 → one `editStrand` that copies `fx`, `pal` and the parameters to the other two slots, not `col`.
- [ ] **Step 2: Run** `pnpm test src/components/lights/slotSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app: open a slot at 375 px (bottom sheet) and 1440 px (side sheet); Escape closes it and focus returns to the slot row; the effect list scrolls inside the sheet; the lights change at once on the fake.
- [ ] **Step 5: Commit.** `feat(web): add the slot editor sheet`

### Task 21: Individual paint editor

review: no

**Files:**
- Create: `src/components/lights/paintEditor.tsx`, with a story
- Test: `src/components/lights/paintEditor.test.tsx`

**Interfaces:**
- Consumes: `beginPaint`, `paintCells`, `endPaint`, `editStrand`, `pushRecentColor` (Task 16).
- Produces: `PaintEditor`, design lines 4778-4846 and 5380-5405: the brush (`input type="color"` and up to 6 recent colors), "Fill range", "Clear", and the paint strip (`role="slider"`, cells `min(len, 96)`, cursor cell, help text "Tap or drag to paint. The lights change when you let go. With a keyboard: arrow keys move, Space paints."). A pointer drag calls `beginPaint` once, `paintCells` per move (it fills the cells a fast drag skips), and `endPaint` on release. Space or Enter paints the cursor cell as one begin, paint, end.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - A drag over cells 0-4 with brush `#FF8800` → no `patchStrand` before release; one after release, whose paint has `#FF8800` at LEDs 0-4.
  - `ArrowRight` twice, then Space → LED 2 painted; one `patchStrand`.
  - "Fill range" → every paint item is the brush color. "Clear" → every item is `#000000`.
- [ ] **Step 2: Run** `pnpm test src/components/lights/paintEditor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app on Front Roof: paint with a drag at 375 and 1440 px; the fake segment "Peak paint" has the pixels; reload the tab and the paint is still there.
- [ ] **Step 5: Commit.** `feat(web): add the individual paint editor`

### Task 22: Presets tab and dialogs

review: yes (destructive delete with confirmation; apply changes the lights)

**Files:**
- Create: `src/store/slices/presets.ts`, `src/components/presets/presetsTab.tsx`, `src/components/presets/presetsDialogs.tsx`, with stories
- Modify: `src/store/index.ts`, `src/screens/deviceScreen.tsx`
- Test: `src/store/slices/presets.test.ts`, `src/components/presets/presetsTab.test.tsx`

**Interfaces:**
- Consumes: `api` scene and look functions (Task 13); `adoptView`, `loadLights`, `selectStrand` (Task 16); primitives (Task 14); `patternText`, `rangeLabel` (Task 15).
- Produces:
  - `presetsSlice`: `{ byDevice: Record<string, { scenes: Scene[] | null; looks: LookRecord[] | null; status: "idle" | "loading" | "ok" | "error"; error: ApiErrorPayload | null; applying: string | null }> }`; thunks `loadPresets(id)` (lights, scenes and looks), `createScene`, `renameScene`, `deleteScene`, `applyScene`, `createLook`, `renameLook`, `deleteLook`, `applyLook`. An apply adopts `view` into the lights slice and selects the scene's strand.
  - `PresetsTab`: design lines 5556-5626 (offline, skeleton, error, both lists, both empty-state texts, "LED count changed" badge, "Strand not found" with Apply disabled and its reason).
  - `PresetsDialogs`: `saveScene`, `saveLook`, `applyLook`, `sceneWarn`, `deletePreset`, `rename` (design lines 5918-6029 and the actions in lines 5628-5845). The look range select disables Individual ranges with " (painted LEDs can't be a look)". The apply-look tree has strand checkboxes with `aria-checked="mixed"`, and a shared strand is disabled with its text. Delete is a confirm dialog: title "Delete <name>?", text "The <kind> is removed from Strand. The lights don't change.", a `destructive` Delete button, focus starts on Cancel.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`, `fetch` stubbed):
  - No scenes and no looks → "No scenes yet. Save the current strand setup to come back to it." and "No looks yet. Save a range's colors and effects to use them on any strand."
  - Save scene with an empty name → "Give the scene a name." and no request. With "Party" → `POST /api/devices/<id>/scenes` with `{"name":"Party","strandKey":"o0"}` (the selected strand), then a toast "Saved Party".
  - A scene with `ledCount` 150 and a strand of 100 → Apply opens "Apply <name>?" with "Strand fits its ranges to the new length: ranges past the end are cut."; "Apply anyway" sends the apply.
  - A scene whose strand is missing → "Strand not found" and Apply has `aria-disabled="true"`.
  - Apply to… with one of two ranges of o0 checked → the strand checkbox is `aria-checked="mixed"`; the button says "Apply to 1 range"; the body is `{"targets":[{"strandKey":"o0","range":"Patio"}]}`.
  - Delete → the confirm dialog; Cancel sends nothing; Delete sends `DELETE` and toasts "Deleted <name>".
  - A `422 invalid_name` on save → the dialog shows "Names need 1 to 64 characters."
- [ ] **Step 2: Run** `pnpm test src/store/slices/presets.test.ts src/components/presets`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/store src/components/presets`. Run the app: screenshot the Presets tab empty and with two scenes and two looks at 375, 768 and 1440 px; every dialog traps focus and returns it; the destructive button is reachable with Tab; Escape cancels.
- [ ] **Step 5: Commit.** `feat(web): add the presets tab with scenes and looks`

### Task 23: End-to-end seam test

review: no

**Files:**
- Create: `src/screens/deviceScreen.seam.test.tsx`

**Interfaces:**
- Consumes: `makeTestApp`, `startFakeWled`, `seeds` (prior Task 4, Task 2); `DeviceScreen`, `makeStore`, `reducers` (Tasks 16, 17, 22).
- Produces: one jsdom test file that drives the real UI against the real server and a fake device. `fetch` is replaced for the test: a URL that starts with `/` goes to `t.inject({ method, url, headers, payload })` and returns `new Response(body, { status, headers })` (`null` body for 204); any other URL goes to the real `fetch`, so the server still reaches the fake.

- [ ] **Step 1: Write the test** with Backyard (`startupDelayMs` 50), rendered at `/devices/<id>` in a `MemoryRouter`:
  - The shared banner shows; click "Split by strand" → the fake lists segments 0-150 and 150-300.
  - Click "Add range" → the fake lists a segment named "Range 2" inside 0-150, and no segment of 150-300 changed.
  - Open "Range 1", click "Every N" → the fake lists "Range 1 1/2" and "Range 1 2/2" with `grp` 1, `spc` 1.
  - Wait 200 ms → the fake got one `psave` with `bootps` 250, and `GET /presets.json` has key `"250"`.
  - Presets tab: save scene "Two" for Strand 1; Lights tab: Merge "Range 1" with next; Presets tab: Apply "Two" → the fake's o0 segments are again "Range 1 1/2", "Range 1 2/2" and "Range 2".
  - Change "Range 2" to Individual and click "Fill range" → the fake segment "Range 2 paint" has `frz: true` and every pixel is the brush color.
  - `fake.setMode("timeout")`, then press `ArrowRight` on a range handle → after the reply the handle is back at its old `aria-valuenow`, and the toast "Couldn't change the lights" shows.
- [ ] **Step 2: Run** `pnpm test src/screens/deviceScreen.seam.test.tsx`. Expected: PASS. A failure here is a defect in an earlier task; fix it there.
- [ ] **Step 3: Drive the real app.** Use "Running the app for screenshots" and the `verify` skill. On Backyard: split, add a range, set Every N, open a slot and pick an effect, paint, save a scene, apply it, apply a look. After each action, `curl -s 127.0.0.1:18081/json/state` shows the change. Restart the server and reload: the tab shows the same layout.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/screens`. Expected: PASS.
- [ ] **Step 5: Commit.** `test(web): drive the lights and presets tabs end to end`

## Review Focus

These five conditions are the most likely to hurt a user, and the spec's examples do not test them. The owning task has a test for each.

1. **Every N on a range too short for its slots** (`(N − 1) · G ≥ len`), from the steppers, a boundary drag, a scene fit or a look. Expected: the server rejects it with `422 invalid_layout`; the steppers and handles stop at the limit with a reason; a scene turns the range into All; a look skips it with a warning (Tasks 5, 6, 9, 15, 19).
2. **A long or multi-byte range name** whose tagged segment name passes 32 bytes. Expected: the name is cut on a UTF-8 boundary, the tag stays whole, and the layout still reads back (Tasks 4, 5).
3. **A startup write that fires while a flash is lit, or before `presets.json` has the newest paint.** Expected: the preset has no flash segment and has the last paint that Strand sent (Task 7).
4. **Fast edits on one strand while a request is in flight, then a failure.** Expected: one request at a time, the newest value sent last, a rollback to the view before the edits, an error toast, and other strands' in-flight edits kept (Task 16).
5. **The header switch turns a painted device on.** Expected: the paint goes in the same `POST` as `on: true`, so the painted range does not fall back to its color (Task 8).

## Pre-merge checks (for the PR body)

These need a real device and cannot run in the build:

- On a WLED 0.15 device and a 17.0.0-dev device: write a layout with All, Every N and Individual ranges, reboot the device, and check that the lights and the Lights tab show the same layout.
- Check that "Turn on at boot" off in WLED's settings still keeps the lights off at boot with the startup preset set.
- Check a 300-LED Individual paint with random colors on an ESP8266 device (request size).
