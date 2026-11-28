# Lights and Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Lights and Presets tabs: the server's strand model over WLED segments, the Lights, scene and look endpoints, the two short device timers, and the React device page with its Lights and Presets tabs.

**Architecture:** Two pure layout modules translate between WLED segments and strands, ranges, patterns and slots: `server/lights/layoutRead.ts` reads, `server/lights/layoutWrite.ts` writes. Endpoints read the device, call the layout modules, send the smallest WLED change, and answer with a new `LightsView`. A per-process runtime (`server/lights/runtime.ts`) holds the 3-second flash timer and the 5-second startup-preset timer. The browser keeps a `lights` Redux slice with optimistic edits, one request in flight per strand, and rollback. The browser never builds WLED JSON.

**Tech Stack:** Node 24, TypeScript, Fastify 5, `node:sqlite`, vitest, fast-check 4 (new dev dependency), React 19, Redux Toolkit + recompose, Tailwind v4, shadcn/ui and Radix (`radix-ui`), Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-23-lights-presets-design.md` (approved). UI and API contract: `docs/design/strand-wled-spec.html`, the "MOCK APP SERVER" comment (lines 601-648), the block "MOCK APP SERVER: LIGHTS AND PRESETS" (lines 1059-1666), SCREEN 3 (lines 2766-2840), SCREEN 5 (lines 4234-5084), SLOT EDITOR (lines 5085-5376), POINTER DRAGS AND KEYBOARD (lines 5377-5545), SCREEN 6 (lines 5546-5846), and LIGHTS AND PRESETS DIALOGS (lines 5847-6031). Prior plan: `docs/superpowers/plans/2026-10-23-app-server.md` (its Tasks 1-12 are built before this plan runs). Read the spec, the design lines that a task names, and the prior plan's interfaces before you start a task.

## Global Constraints

Binding rules this change can touch:

- Browser talks only to the app server; no WLED JSON in the browser; no polling of lighting state: CLAUDE.md "Architecture constraints"; spec §3 anti-goals.
- React hooks ban and `connect()` only in top-level screens: CONVENTIONS.md §3, enforced by `eslint.config.js`.
- API client and thunks: CONVENTIONS.md §4.
- Server endpoints, `ApiError`, device requests through `server/wled/deviceClient.ts` only: CONVENTIONS.md §5.
- Body validation: JSON schemas with `additionalProperties: false`. `server/app.ts` sets Ajv `coerceTypes: false` and `removeAdditional: false`, so a schema rejects unknown keys and wrong types (prior plan Task 10, Step 3). A handler checks only the rules a schema cannot state.
- No log of a request body or a PIN: CONVENTIONS.md §5. This plan adds paint data to that list. Every log call uses named fields only.
- Migrations are append-only: CONVENTIONS.md §6.
- shadcn CLI for new primitives, design tokens, a colocated `*.stories.tsx` for every component: CONVENTIONS.md §7.
- camelCase file names: CONVENTIONS.md §8.
- Commits: CONVENTIONS.md §9.
- Testing guide: CONVENTIONS.md §10. Test files are `<file>.test.ts(x)` next to the file they cover. Every test carries the one-line comment that §10 requires; the implementer writes it.
- Chained calls: CONVENTIONS.md §11.
- Task gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test <task paths>`. The full suite runs once, at commit review.
- This plan departs from CONVENTIONS.md §5, which says: "The server keeps no device state, connection or queue in memory between requests." It also departs from CLAUDE.md "Stack", which says: "The server is stateless in memory". Task 7 replaces both sentences (spec §4).

**Frontend tokens and checks (every UI task):**

- Tokens: the CSS variables in `src/index.css` (from the design): `primary`, `background`, `card`, `muted`, `accent`, `warning`, `warning-muted`, `danger`, `success`. Type: Geist Variable (display and body), Geist Mono Variable (hosts, hex, LED numbers). Layout: the design's `page()` container (`max-w-6xl`, 16 px gutters, line 2459). Signature element: the LED strip with draggable range boundaries.
- Class strings: copy them from the design's "SHADCN/UI CLASS STRINGS" block (lines 1825-1949) and the line ranges each task names. No hard-coded colors except LED and paint colors.
- Breakpoints: render without horizontal overflow at 375, 768 and 1440 px. The slot sheet is a bottom sheet below 900 px and a right side sheet at 900 px and up (Tailwind `min-[900px]:`).
- Keyboard: every control is reachable with Tab and has a visible focus ring. Range handles, the paint strip and the color area are `role="slider"` with the keys in the design (lines 5487-5545).
- A control that is disabled with a reason stays focusable, has `aria-disabled="true"`, and has `aria-describedby` that points to the reason text. Keyboard focus, hover and a tap each show the reason. `title` alone is not enough.
- Pointer drags end on `pointerup` and on `pointercancel`.
- Reduced motion: animations use `motion-safe:`.
- States: each tab has loading (skeleton), error (with "Try again"), offline, empty, and success states as the design shows.

## Pipeline State

| Field         | Value                                                              |
|---------------|--------------------------------------------------------------------|
| stage         | 5 (PR feedback loop)                                               |
| class         | large (new schema, new public API, new screens, in-memory timers)  |
| profile       | frontend + backend + seam                                          |
| branch        | feat/app-server                                                    |
| pr            | #1                                                                 |
| design assets | docs/design/strand-wled-spec.html                                  |
| gate          | approved 2026-11-24                                                |
| round         | 0                                                                  |
| decisions     | 8 (see Decisions below)                                            |

### Decisions

1. Task 7: the plan said the power-on paint goes in the same request as `on: true`. Strand sends it in chunks of 256 runs, and the first chunk carries `on`/`bri`. One body with every paint run can exceed the device's JSON buffer (ESP8266 10240 bytes).
2. Task 7: the plan did not say what happens when the startup preset is too large. Strand first saves it without paint, with the notice "Painted colors won't survive a restart: there are too many painted LEDs to save on this controller." If it is still too large, Strand skips the save and shows the notice "Your setup is too large to keep after a restart." The check uses the parsed size against the device's JSON buffer (server/wled/jsonLimits.ts), not the text bytes.
3. Task 7 and stage 4: every device write goes through one per-device queue (`runtime.run`), and layout writes read the device and plan inside it. Without the queue, a startup save could revert a concurrent write, and two strands edited at once could take the same new segment ID.
4. Task 10: paint memory is keyed by `paintKey(start, name)`, not by segment name. Range names repeat across strands (for example after a separate).
5. Task 5: `validateRanges` accepts an effect or palette ID that is not in the device lists when it equals the value the device already has for that slot. An unknown ID read back from the device must not block edits.
6. Task 8: `PATCH /api/devices/:id/state` takes only `{ on?, bri? }`. The browser never sends WLED JSON (CLAUDE.md architecture constraints).
7. Task 21 and stage 4: the paint strip has `min(len, 48)` cells below 900 px and `min(len, 120)` at 900 px and above, as the design does (design `S.desktop ? 120 : 48`). The plan said `min(len, 96)`.
8. Task 23: the seam test checks for at least one `psave` with `bootps` 250, not exactly one. The 50 ms test timer can fire between two UI steps on a slow runner.

## Plan decisions

The spec does not make these choices, or the plan changes what the spec says. Each one is here so the owner sees it at the gate. Task 1 writes the decisions that change the spec into the spec and into the design's contract comment.

1. **The startup preset has no top-level `on` or `bri`** (spec §6.7 lists them). At boot the firmware sets the brightness from `def.on`/`def.bri` and then applies the boot preset, so a preset `on`/`bri` overrides the Settings "turn on at boot" value (`wled00/wled.cpp:683-691`). Segment `on` and `bri` stay in the preset, so per-strand power survives a reboot. Global power changes do not schedule a startup write.
2. **The startup preset lists every segment ID from 0 to `maxseg − 1` in order.**
   - A listed segment is its full body. An unlisted ID is `{"id":k,"stop":0}`.
   - Why: the firmware applies a `psave` body as live state before it saves it (`json.cpp:466-506`). At boot, it appends a request ID at or above the vector size at the end (`json.cpp:79-84`).
   - Result: the boot load gives the same layout, whatever segments the firmware made at boot. The live state does not change.
   - The server builds the list from a fresh `GET /json/state` when the timer fires.
3. **Segment name tags are `Patio 1/3` and `Patio paint`** (spec §6.2). Spec §12 item 1 writes `·2/3` and `·paint`. §6.2 is the normative section, so the plan uses its form.
4. **Every N needs `(N − 1) · G < len`** (a spec gap).
   - Slot k starts at `s + k·G`. When that start is at or past the range end, the segment has no LEDs. The firmware then makes it inactive (`json.cpp:185-191`), and the layout does not read back.
   - The server rejects such a layout with `422 invalid_layout`.
   - The N and G steppers and the boundary handles stop at this limit.
   - A look skips a range that is too short.
5. **The write reuses a removed segment's ID first, as an overwrite.**
   - `writeStrand` overwrites a removed segment with a new body. It does not send a delete and a create.
   - For the remaining new segments, it uses the spec §6.2 order: unlisted IDs below the highest listed ID, then `max + 1`, `max + 2`.
   - This sends fewer deletes, so the purge rule occurs less often.
6. **`writeStrand` returns `seg: SegPatch[][]`** (one array per request) and paint entries keyed by segment name. The endpoint finds the paint IDs after it reads the state again (spec §6.2 rule 3). `sceneToPatch` and `lookToPatches` return the next strand content (`StrandPatch`), and the endpoint writes one strand at a time, so two strands never get the same new ID.
7. **Effect and palette shapes follow the contract** (mock lines 645-647), not the prior plan's `{ id, name, meta }`. Task 3 changes `GET effects` to `{ id, name, pal, sliders, checks, colors }` and `GET palettes` to `{ id, name, stops }`. `stops` come from `/json/palx`.
8. **Error codes and statuses come from the mock:** `strand_changed` 409, `shared` 409, `segment_budget` 422 (body also has `need`), `invalid_layout` 422, `invalid_name` 422, `not_adjacent` 422, `too_many` 422, `painted` 422.
9. **`LightsView` has `matrix: boolean`.** On a 2D device (`info.leds.matrix` present, `json.cpp:734-735`) the view has no strands and the tab shows the spec §3 message. Every write gets `422 invalid_layout`.
10. **Strand brightness is 1-255.** Segment `bri: 0` turns the segment off and reads back as 255 (`json.cpp:193-197`, `:597`). The design's Slider is 1-255 by default (line 2316).
11. **Range names are 1-64 characters and unique in a strand.** A device segment with no name reads as `Range <k>` (k is the range's 1-based position). When two ranges read back with the same name, the later one gets a suffix (`Porch 2`). The spec's "strand name for an unnamed range" rule is not necessary, because every range has a name.
12. **`PATCH state` with `on: true` also sends the paint again.** The design's header switch calls `api.patchState` (line 2623), and spec §6.4 asks for paint on every Strand power-on. `PATCH state` and `PATCH lights` share one power function.
13. **`GET lights` writes nothing** (spec §6.6 and the §9 table say that it deletes leftover flash segments first). A read must not change the device or the database. The view leaves out leftover "Strand flash" segments and dropped combinations. The next Lights write to that device deletes them.
14. **Strand names are the preference `strandNames.<deviceId>`** (CLAUDE.md). `DELETE /api/devices/:id` deletes that preference too. `PUT /api/preferences/:key` refuses keys that start with `strandNames.`, so only `PUT strand-names` writes them.
15. **`PATCH strand` ranges must cover the strand exactly.** Every view covers every LED (gaps read as off All ranges), so no screen sends gaps.
16. **A shared strand accepts `on`, `bri`, and a one-All-range `ranges` that edits the shared segment's slot.** Any other `ranges` gets `409 shared` (mock `patchStrand`, line 1349).
17. **Toasts are a Redux slice.** The shadcn `sonner` toaster calls hooks, which CONVENTIONS.md §3 bans.
18. **The Settings tab** links to `/devices/:id/settings`. Until the settings screens exist, that page shows the device page with a Settings panel that has only the "Open WLED Advanced UI" link (`http://<host>/settings`, new tab). The "Settings locked" badge and the PIN dialog belong to the settings screens.
19. **Do not port the prototype's placeholders** or its reviewer-only "Prototype controls" panel (`prototype` object, lines 1488-1666). The React app has no "Designed in the next round" placeholder, so there is nothing to remove.
20. **`fast-check` 4** is added as a dev dependency for the round-trip property test.
21. **`DELETE` of a scene or a look is idempotent.** It answers 204 when the record is already gone, as the contract says.

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
- **JSON request size:** the `/json` handler accepts a body of at most `JSON_BUFFER_SIZE` bytes (`wled_server.cpp:476`): 10240 on ESP8266, 24576 on ESP32-S2, 32767 on other ESP32 (`const.h:656-664`).
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
// WledInfo.leds adds: matrix?: { w: number; h: number }
```

- `sliders[k]` labels `["sx","ix","c1","c2","c3"][k]`, `checks[k]` labels `["o1","o2","o3"][k]`, `colors[k]` labels `col[k]`. `""` means hidden. Trailing `""` entries are removed.
- The server checks input `RangeView` and `SlotView` values. The server ignores `fxName` and `palName` on input and writes the device's names in the result.
- Validation for `ranges` (`422 invalid_layout`, message "That layout doesn't fit this strand."):
  - Sorted by `start`, the ranges cover `[0, len)` with no gap and no overlap. `len ≥ 1`.
  - Names are 1-64 characters after trim and unique in the strand.
  - `all` and `individual` have one slot. `every` has `2 ≤ n ≤ 16`, `1 ≤ group ≤ 255`, `(n − 1) · group ≤ 255`, `(n − 1) · group < len`, and `n` slots.
  - `individual` has `paint` of `len` items that match `^#[0-9A-Fa-f]{6}$`.
  - Slot `col` has 1-3 colors of 3 or 4 integers 0-255. `fx` is an index of the device's effect list. `sx`, `ix`, `c1`, `c2`, `pal` are 0-255. `c3` is 0-31. `o1`-`o3` and `on` are booleans.
- A body with an unknown key, a wrong type, `{}`, or `bri` out of range gets `400 invalid_request`. `PATCH strand` takes bodies up to 256 KB.
- Error statuses and messages (texts from the mock; Task 1 adds each one to `messages` in `server/errors.ts`):

| Code | Status | Message |
|---|---|---|
| `strand_changed` | 409 | "That strand isn't on this controller any more." |
| `shared` | 409 | "`<strand>` shares a segment with another strand. Choose Split or Combine on the Lights tab first." |
| `segment_budget` | 422 | "This needs `<n>` more segment(s) and `<free>` is/are free. Remove a range first." (mock `checkBudget`, line 1259; body `need: n`) |
| `invalid_layout` | 422 | "That layout doesn't fit this strand.", "2D matrix layouts aren't supported yet.", or "This setup is too large to save." |
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
CLAUDE.md, CONVENTIONS.md          "Stack" and §5: the in-memory lights runtime
vitest.config.ts                   + test/**/*.test.ts
shared/apiTypes.ts                 + lights, scene, look types; Effect and Palette change; WledInfo.leds.matrix; new error codes
server/
  app.ts                           + flashMs, startupDelayMs in AppDeps; ServerDeps; lights runtime; new endpoints
  errors.ts                        ApiError gets optional `need`; new messages
  db/migrations.ts                 + entry 2: scenes, looks, strand_groups
  db/scenes.ts, db/looks.ts, db/strandGroups.ts   row access
  db/preferences.ts                + get, remove
  wled/effectMeta.ts               parseEffectMeta, palxStops
  lights/layoutRead.ts             shared types, parseState, strandsFromConfig, readStrand, readLayout, names, paint codec
  lights/layoutWrite.ts            validateRanges, segmentsNeeded, writeStrand, splitShared, LayoutError
  lights/snapshots.ts              snapshotStrand, lookFromRange, fitRanges, resolveSlot, sceneToPatch, lookToPatches
  lights/startup.ts                buildStartupPreset
  lights/runtime.ts                flash and startup timers, last-sent paint
  lights/deviceLights.ts           read a device into a LightsView; clear leftovers; write a LayoutWrite; device power
  routes/lights.ts                 lights, strands, resolve, flash, strand-groups, strand-names
  routes/presets.ts                scenes and looks
  routes/control.ts                PATCH state power-on paint; effects and palettes shapes
  routes/preferences.ts            refuses `strandNames.` keys
  routes/devices.ts                DELETE also removes strand names and the device's timers
test/
  wledSim.ts                       pure firmware segment simulator (shared by the fake and the property test)
  fakeWled.ts                      segments through wledSim, psave, boot, palx, body limit, `port`, `applyState`, `afterPost`
  demoDevices.ts                   `node test/demoDevices.ts`: three fakes with the design's layouts
src/
  api/client.ts                    + lights, groups, names, scenes, looks functions
  lights/model.ts                  pure helpers ported from the design
  store/slices/lights.ts, presets.ts, devicePage.ts, preferences.ts, toasts.ts
  components/ui/                   + switch, sheet, dropdownMenu, badge, skeleton (shadcn CLI); slider, stepper, toaster (by hand);
                                   button, dialog, icon restyled
  components/device/               deviceHeader, deviceBanners, settingsPanel
  components/lights/               lightsTab, strandPicker, strandPanel, strip, rangeCard, patternControls, slotRows,
                                   paintEditor, slotSheet, lightsDialogs
  components/presets/              presetsTab, presetsDialogs
  screens/deviceScreen.tsx         the only connected component of the device page
```

**Running the app for screenshots** (every UI task and Task 23): `node test/demoDevices.ts` (fakes on 127.0.0.1 ports 18081 Backyard, 18082 Front Roof, 18083 Garage). In a second terminal: `pnpm build && pnpm build:server && DATA_DIR=.tmp-data pnpm start`. Add each fake with `curl -s -X POST -H 'Host: localhost' -H 'X-Strand-Request: 1' -H 'Content-Type: application/json' -d '{"host":"127.0.0.1:18081"}' localhost:3000/api/devices`, and open `http://localhost:3000/devices/<id>`. Delete `.tmp-data` afterward.

---

### Task 1: Shared types, error codes, migration, repositories and spec alignment

review: yes (migration, cascade deletes)

**Files:**
- Modify: `shared/apiTypes.ts`, `server/errors.ts`, `server/db/migrations.ts`, `server/db/preferences.ts`, `docs/superpowers/specs/2026-11-23-lights-presets-design.md`, `docs/design/strand-wled-spec.html` (the "MOCK APP SERVER" comment only)
- Create: `server/db/scenes.ts`, `server/db/looks.ts`, `server/db/strandGroups.ts`
- Test: `server/db/database.test.ts`

**Interfaces:**
- Consumes: `openDb`, `runMigrations`, `devices` (prior Task 3); `ApiError`, `messages`, `registerErrorHandler` (prior Task 2); `WledInfo` (existing `shared/apiTypes.ts`).
- Produces:
  - In `shared/apiTypes.ts`: `SlotLook`, `Pattern`, `Look`, `RangeSnapshot`, `StrandSnapshot` (spec §8), `SlotView`, `RangeView`, `StrandView`, `LightsView`, `LightsPatch`, `StrandPatch`, `Scene`, `LookRecord`, `LookTarget`, `ApplyResult` (API contract). `ErrorCode` adds `strand_changed`, `shared`, `segment_budget`, `invalid_layout`, `invalid_name`, `not_adjacent`, `too_many`, `painted`. `ApiErrorBody` adds `need?: number`. `WledInfo.leds` adds `matrix?: { w: number; h: number }`.
  - `ApiError` constructor: `(status, code, message, extra?: { need: number })`. The handler adds `need` to the body when it is set.
  - `messages` adds: `strandChanged()`, `shared(strand: string)`, `segmentBudget(need: number, free: number)`, `invalidLayout()`, `matrixLayout()`, `contentTooLarge()`, `invalidName()`, `notAdjacent()`, `tooManyScenes()`, `tooManyLooks()`, `painted()`, `sceneGone()`, `lookGone()`, `rangeGone()`. Each returns the text in the "API contract" table. `segmentBudget` uses the mock's plural rule (line 1259).
  - `migrations[1]`: the spec §8 SQL, verbatim.
  - `scenes`: `type SceneRow = { id: string; deviceId: string; name: string; strandKey: string; ledCount: number; content: StrandSnapshot; createdAt: string; updatedAt: string }`; `list(db, deviceId): SceneRow[]` (order `created_at, rowid`); `get(db, deviceId, id): SceneRow | undefined`; `count(db, deviceId): number`; `insert(db, row: { deviceId; name; strandKey; ledCount; content }, now: Date): SceneRow`; `rename(db, deviceId, id, name, now): SceneRow | undefined`; `remove(db, deviceId, id): boolean`.
  - `looks`: the same functions with `type LookRow = { id; deviceId; name; look: Look; createdAt; updatedAt }` and `insert(db, row: { deviceId; name; look }, now)`.
  - `strandGroups`: `list(db, deviceId): string[]` (order `rowid`); `replace(db, deviceId, keys: string[]): void` (one transaction).
  - `preferences.get(db, key): unknown | undefined`; `preferences.remove(db, key): void`.
- The endpoint tests of Tasks 8-12 cover the repositories, `need` in the error body, and the messages. This task tests only what no endpoint reaches.

- [ ] **Step 1: Write the failing tests** (`server/db/database.test.ts`):
  - `openDb(":memory:")` → `user_version` 2.
  - Cascade: a device with one scene, one look and one group; `devices.remove` → `scenes.list`, `looks.list` and `strandGroups.list` are each `[]`.
- [ ] **Step 2: Run** `pnpm test server/db/database.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prepared statements only. Store `content` and `look` as JSON text. IDs from `crypto.randomUUID()`.
- [ ] **Step 4: Update the spec.** In `docs/superpowers/specs/2026-11-23-lights-presets-design.md`, write the plan decisions that change the spec:
  - §12 item 1: the tags `Patio 1/3` and `Patio paint` (Plan decision 3).
  - §6.2: the Every N minimum length rule `(N − 1) · G < len` (Plan decision 4), and unique range names with a suffix on read (Plan decision 11).
  - §6.6 and the §9 table: `GET lights` writes nothing; the next Lights write deletes leftover flash segments and dropped combinations (Plan decision 13).
  - §6.7: no top-level `on` or `bri` in the startup preset, and the segment list from 0 to `maxseg − 1` (Plan decisions 1, 2).
  - §9: `LightsView.matrix` (Plan decision 9); strand `bri` 1-255 (Plan decision 10); the `Effect` and `Palette` shapes (Plan decision 7); the error codes table from "API contract" (Plan decision 8); `invalid_name` on `PUT strand-names`; `DELETE` of a scene or a look answers 204 when the record is already gone (Plan decision 21); the layout module signatures of Tasks 4 and 5.
- [ ] **Step 5: Update the contract comment.** In `docs/design/strand-wled-spec.html`, change only the "MOCK APP SERVER" comment (lines 601-648): add `matrix` to `LightsView`; add `422 invalid_name` to `PUT strand-names`; add one line per adopted error code with its status (Plan decision 8). Do not change the mock code.
- [ ] **Step 6: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/db server/errors.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit.** Stage the code files: `feat(server): add lights types and scenes, looks and strand group tables`. Then stage the two docs: `docs: align the lights and presets design with the plan`.

### Task 2: Firmware segment simulator and fake device support

review: no

**Files:**
- Create: `test/wledSim.ts`, `test/demoDevices.ts`
- Modify: `test/fakeWled.ts`, `vitest.config.ts` (add `test/**/*.test.ts` to `include`)
- Test: `test/wledSim.test.ts`, `test/fakeWled.test.ts`

**Interfaces:**
- Consumes: `startFakeWled`, `FakeWled`, `FakeOpts`, `seeds` (prior Task 4).
- Produces, in `test/wledSim.ts` (pure, no imports except types):
  - `type SimSeg = { start: number; stop: number; grp: number; spc: number; of: number; on: boolean; frz: boolean; bri: number; col: number[][]; fx: number; sx: number; ix: number; c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean; pal: number; sel: boolean; rev: boolean; mi: boolean; n?: string; pixels: (string | null)[] }`.
  - `type SimState = { on: boolean; bri: number; mainseg: number; slots: (SimSeg | null)[]; maxseg: number; ledCount: number; presets: Record<string, unknown>; bootps: number }`. A `null` slot is an empty slot.
  - `simFromState(state: { on; bri; seg: object[] }, maxseg: number, ledCount: number): SimState`.
  - `applyPost(sim: SimState, body: Record<string, unknown>): void`. It follows "Verified external API": global `on`/`bri` with the power-on unfreeze, `seg` arrays and objects by `id`, append, delete, purge, name clearing, the default color, byte wrap of `grp`/`spc`, `c3` clamp, `i` paint (pixels as `"#RRGGBB"`), and `psave` (apply, then store the cleaned body at `presets[id]`, and `bootps`).
  - `bootSim(sim: SimState, def: { on: boolean; bri: number }, opts?: { outputs?: { start: number; len: number }[] }): void`. It models `wled.cpp:683-691`: one segment over `[0, ledCount)`, or with `opts.outputs` one auto segment per output (`[start, start + len)`), `on` and `bri` from `def`, then `applyPost` of `presets[bootps]` when `bootps > 0`.
  - `listState(sim: SimState): { on: boolean; bri: number; mainseg: number; seg: object[] }`. Each listed segment has `id`, `start`, `stop`, `len`, `grp`, `spc`, `of`, `on`, `frz`, `bri` (255 when 0), `col`, `fx`, `sx`, `ix`, `pal`, `c1`-`c3`, `o1`-`o3`, `sel`, `rev`, `mi`, and `n` when set.
- Produces, in `test/fakeWled.ts`:
  - The fake keeps a `SimState` built from the seed. `POST /json/state` and `POST /json` call `applyPost`. `GET /json/state` returns `listState`. `GET /presets.json` returns the seed presets merged with `sim.presets`. A `psave` with `bootps` sets `cfg.def.ps`. `restart()` also calls `bootSim` with `cfg.def`.
  - New: `FakeOpts.port?: number`; `FakeOpts.maxBody?: number` (default 10240, the ESP8266 limit). A `POST` body over `maxBody` bytes gets `400` and changes nothing.
  - New: `FakeWled.applyState(body: Record<string, unknown>): void` (a change made by another client); `FakeWled.afterPost(fn: () => void): void` (runs `fn` once, after the next `POST /json/state` is applied); `FakeWled.state` becomes a getter that returns `listState(sim)`.
  - `GET /json/palx?page=N` (8 per page; palettes 1-5 as the firmware strings; others `[[0,r,g,b],[255,r2,g2,b2]]` from a fixed color table); `info.leds.maxseg` stays from the seed.
- Imports between runtime files in `test/` use the `.ts` extension, so `node test/demoDevices.ts` runs under Node 24 type stripping.
- Produces, `test/demoDevices.ts`: starts Backyard on 18081, Front Roof on 18082, Garage on 18083, and applies the design's layouts (mock `lightSeed`, lines 1084-1180) as segment posts: Backyard o0 "Patio" Every 2 group 2 over 0-59, "Kitchen" All 60-119 (Rainbow), "Rest" All 120-149; o1 "Fence" All 150-269 and a foreign segment "Porch light" 270-299 with `grp: 2`; Front Roof "Gutter" All 0-199 and "Peak paint" 200-299 with candy-cane paint (mock `candyPaint`); Garage one All segment. It prints the three URLs and runs until killed.

- [ ] **Step 1: Write the failing tests** (`test/wledSim.test.ts`, with a sim of one segment 0-300, `maxseg` 32):
  - `{seg:[{id:3,start:0,stop:10}]}` → listed IDs `[0, 1]` (appended at the end), and the new segment's `col[0]` is `[255,160,0]`.
  - `{seg:[{id:0,stop:0}]}` → nothing listed; `slots.length` stays 1. Then `{seg:[{id:0,start:0,stop:5,n:"A"}]}` → ID 0 listed again with `n: "A"`.
  - Six active segments, then one array that deletes three → listed IDs are `0, 1, 2` (purge).
  - `{seg:[{id:0,start:5}]}` on a segment named "A" → no `n`.
  - `{seg:[{id:0,grp:300}]}` → `grp` 44.
  - `{seg:[{id:0,i:[0,2,"FF0000"]}]}` → `frz: true`, pixels 0-1 `"#FF0000"`. Then `{on:false}`, `{on:true}` → `frz: false`.
  - `{psave:250,o:true,n:"Strand: startup",bootps:250,seg:[{id:0,n:"X"}]}` → `presets["250"]` is `{n:"Strand: startup",seg:[{id:0,n:"X"}]}`, `bootps` 250, and listed segment 0 has `n: "X"`.
  - `test/fakeWled.test.ts`: `GET /json/palx?page=0` on Backyard → `m: 1` and 8 keys in `p`; key `"2"` is `["c1"]`. `startFakeWled(seed, { port: 18999 })` listens on 18999. After a `psave` with `bootps`, `GET /json/cfg` has `def.ps` 250. A `POST /json/state` body of 10241 bytes → `400`, and `state` does not change.
- [ ] **Step 2: Run** `pnpm test test/wledSim.test.ts test/fakeWled.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the simulator, the fake changes and the demo script.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test test server/wled server/routes`. The existing endpoint tests use the fake, so they must still pass. `node test/demoDevices.ts` prints three URLs, and `curl -s 127.0.0.1:18081/json/state` lists six segments (Patio 1/2, Patio 2/2, Kitchen, Rest, Fence, Porch light).
- [ ] **Step 5: Commit.** `test(server): simulate WLED segments and presets in the fake device`

### Task 3: Effect metadata and palette previews

review: no

**Files:**
- Create: `server/wled/effectMeta.ts`
- Modify: `shared/apiTypes.ts` (`Effect` and `Palette` become the contract shapes), `server/routes/control.ts`
- Test: `server/wled/effectMeta.test.ts`, `server/routes/control.test.ts`

**Interfaces:**
- Consumes: `/json/palx` in the fake (Task 2); `controlRoutes` (prior Task 10); `deviceRequest` (prior Task 4); `loadDevice` (prior Task 8).
- Produces:
  - `parseEffectMeta(id: number, meta: string): Pick<Effect, "pal" | "sliders" | "checks" | "colors">`. Default labels: sliders `Speed`, `Intensity`, `Custom 1`, `Custom 2`, `Custom 3`; checks `Option 1`-`Option 3`; colors `Fx`, `Bg`, `Cs`. ID 0 uses `";!;"`. An empty string means "no metadata": sliders `["Speed","Intensity"]`, colors `["Fx","Bg","Cs"]`, `pal: true`. Palette field: `""` or numeric → `false`; `!` or other text → `true`.
  - `Effect` and `Palette` in `shared/apiTypes.ts`, as in "API contract". `src/api/client.ts` needs no code change.
  - `palxStops(entries: unknown[]): string[]`. An entry `[pos, r, g, b]` where each of the four is an integer 0-255 becomes `"#RRGGBB"` (uppercase), in entry order. Every other entry (a string, a wrong length, a non-integer, a value out of range) is dropped. The output has only `#RRGGBB` strings.
  - `GET effects` → `Effect[]` without `RSVD`. `GET palettes` → `Palette[]`: names from `/json/palettes`, stops from `/json/palx` pages 0 to `m`, read one after another.

- [ ] **Step 1: Write the failing tests.**
  - `parseEffectMeta(1, "!,Duty cycle;!,!;!;01")` → `{ pal: true, sliders: ["Speed","Duty cycle"], checks: [], colors: ["Fx","Bg"] }`.
  - `parseEffectMeta(7, "!,!,,,,Smooth;;!")` → sliders `["Speed","Intensity"]`, checks `["Smooth"]`, colors `[]`, `pal: true`.
  - `parseEffectMeta(4, "!;;!")` → sliders `["Speed"]`, colors `[]`, `pal: true`.
  - `parseEffectMeta(0, "")` → `{ pal: false, sliders: [], checks: [], colors: ["Fx"] }`.
  - `parseEffectMeta(30, "")` → sliders `["Speed","Intensity"]`, colors `["Fx","Bg","Cs"]`, `pal: true`.
  - `parseEffectMeta(5, "!,,Delay;;4")` → sliders `["Speed","","Delay"]`, `pal: false`.
  - `palxStops([[0,255,0,0],[255,0,0,255]])` → `["#FF0000","#0000FF"]`; `palxStops(["c1","c2"])` → `[]`.
  - Hostile entries: `palxStops([[0,"<b>",0,0],[0,256,0,0],[0,1.5,0,0],[300,0,0,0],[0,0,0],[0,10,20,30]])` → `["#0A141E"]`.
  - Endpoint: `GET effects` on Backyard → 10 effects; Blink has `sliders: ["Speed","Duty cycle"]`. `GET palettes` → 13 palettes; `fake.requests` has `/json/palx?page=0` and `/json/palx?page=1`; palette 2 has `stops: []`.
- [ ] **Step 2: Run** `pnpm test server/wled/effectMeta.test.ts server/routes/control.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the prior `meta` field.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/wled/effectMeta.test.ts server/routes/control.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): parse effect metadata and palette previews`

### Task 4: Layout read

review: no

**Files:**
- Create: `server/lights/layoutRead.ts`
- Test: `server/lights/layoutRead.test.ts`

**Interfaces:**
- Consumes: `WledConfig` (prior plan Task 2; `hw.led.ins: LedOutput[]`); `LedOutput` (existing `shared/apiTypes.ts`); `LightsView`, `StrandView`, `RangeView`, `SlotView` (Task 1).
- Produces, in `server/lights/layoutRead.ts`:
  - `type WledSeg = { id: number; start: number; stop: number; grp: number; spc: number; of: number; on: boolean; frz: boolean; bri: number; col: number[][]; fx: number; sx: number; ix: number; c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean; pal: number; n?: string }`.
  - `type WledState = { on: boolean; bri: number; seg: WledSeg[] }`.
  - `type Strand = { key: string; name: string; pins: number[]; start: number; len: number; members: string[] }`.
  - `type PaintMap = Record<string, string[]>` (segment name → `"#RRGGBB"` per LED).
  - `type Lists = { effects: string[]; palettes: string[] }`.
  - `const FLASH_NAME = "Strand flash"`; `const NAME_BYTES = 32`.
  - `parseState(raw: unknown): WledState`. It checks the device's `/json/state` reply before any other code uses it:
    - `on` is a boolean, else `false`. `bri` is an integer 0-255, else 0. `seg` is an array, else `[]`.
    - A segment whose `id`, `start` or `stop` is not an integer, or that does not have `0 ≤ id ≤ 255` and `0 ≤ start < stop ≤ 65535`, is left out.
    - `grp` is an integer 1-255, else 1. `spc` and `of` are integers 0-255 and 0-65535, else 0. `bri`, `fx`, `sx`, `ix`, `c1`, `c2`, `pal` are integers 0-255, else 0. `c3` is an integer 0-31, else 16. The booleans are booleans, else `false`.
    - `col` always has 3 entries. An entry that is not an array of 3 or 4 integers 0-255 becomes `[0,0,0]`.
    - `n` is kept only when it is a string. It is cut to `NAME_BYTES` on a UTF-8 character boundary.
  - `strandsFromConfig(cfg: WledConfig, groupKeys: string[], names: Record<string, string>): { strands: Strand[]; dropped: string[] }`. One strand per `hw.led.ins` entry, key `o<index>`, sorted by `start`. Default name `Strand <index + 1>`. A valid group replaces its members. Its name is `names[key]`, else the member names joined with `" + "`. A group is valid when it has two or more members that exist and touch in key order (`a.start + a.len === b.start`). Invalid groups go to `dropped`.
  - `segmentName(base: string, tag: "" | "paint" | { k: number; n: number }): string`. Tags: `""`, `" paint"`, `` ` ${k}/${n}` ``. The base is cut by bytes on a UTF-8 character boundary to `NAME_BYTES − bytes(tag)`.
  - `decodePaint(i: unknown[], len: number): string[]`. Firmware semantics (`json.cpp:314-358`). Indices are clamped to `[0, len)`. A color that is not 6 hex digits or an array of 3-4 integers 0-255 is skipped. The output has exactly `len` items; unset LEDs are `"#000000"`.
  - `encodePaint(paint: string[]): (number | string)[]` (each run as `start, stop, "RRGGBB"`).
  - `readLayout(state: WledState, strands: Strand[], lists: Lists, paint: PaintMap, maxseg: number): Omit<LightsView, "notices" | "matrix">`.
  - Exported for Task 5: `readStrand(state: WledState, strand: Strand, lists: Lists, paint: PaintMap): { view: StrandView; segIds: number[][]; inside: number[]; crossing: number[] }`. `segIds[r][k]` is the segment ID of slot k of range r (empty for a gap range).

**The read algorithm** (spec §6.2 "Reading a layout back"; do not change the order of these steps):

1. Ignore segments named `FLASH_NAME`.
2. `crossing` = the segments that overlap the strand but are not inside it. If there is one, the strand is `shared`:
   - `with` = the other strands that crossing segments touch.
   - `ranges` = one All range `"Range 1"` over the strand, with the slot of the first crossing segment.
   - Stop.
3. `inside` = the segments with `start ≥ strand.start` and `stop ≤ strand.start + strand.len`, by ID.
4. Tag groups: names that match `/^(.*) (\d+)\/(\d+)$/`. A group with base B and count N is an Every range when all of these are true:
   - it has each k from 1 to N once, and `2 ≤ N ≤ 16`;
   - all members have the same `stop` and the same `grp` G;
   - `spc = (N − 1)·G`, and `start_k = start_1 + (k − 1)·G`.
   The range name is B.
5. Paint: a segment named `` `${B} paint` `` with `frz: true`, `grp 1` and `spc 0` is an Individual range named B. Its paint is `paint[name]`, else `col[0]` for every LED.
6. Geometry groups among the other segments: runs of N ≥ 2 segments with the same `stop`, the same `grp` G, `spc = (N − 1)·G`, and starts G apart. The name is the first segment's name, else `Range <k>`.
7. Every other segment is an All range over `[start, stop)`. Its name is its `n`, else `Range <k>`. It sets `normalize` when its `grp ≠ 1`, `spc ≠ 0` or `of ≠ 0`.
8. Accept ranges in the order of their lowest segment ID. A range that overlaps an accepted range is left out and sets `normalize`.
9. Each uncovered LED run is an All range named `Range <k>`. Its slot is off: `on: false`, `col [[0,0,0],[0,0,0],[0,0,0]]`, `fx 0`, `pal 0`, `c3` 16, and 128 or `false` for the other fields. It sets `normalize`.
10. Sort the ranges by `start`. Make `start` relative to the strand.
11. Names: when a name is already used by an earlier range of the strand, add `" 2"`, `" 3"`, and so on (the first free number). Cut the base so that the name has at most 64 characters.
12. Strand `on` = any segment of the strand is on. Strand `bri` = the `bri` of its lowest-start segment, else 255. `fxName` and `palName` come from `lists`.

`segments.used` = the number of listed segments (flash included). `segments.max` = `maxseg`.

- [ ] **Step 1: Write the failing tests** (Backyard config unless the test says otherwise):
  - `strandsFromConfig(cfg, [], {})` → `[{ key: "o0", name: "Strand 1", pins: [16], start: 0, len: 150, members: ["o0"] }, { key: "o1", name: "Strand 2", pins: [17], start: 150, len: 150, members: ["o1"] }]`.
  - Groups `["o0+o1"]` → one strand `o0+o1`, name "Strand 1 + Strand 2", pins `[16, 17]`, len 300. With names `{ o0: "Eaves" }` → "Eaves + Strand 2". With `{ "o0+o1": "Roof" }` → "Roof".
  - "Patio 1/2" `{start 0, stop 60, grp 2, spc 2}` and "Patio 2/2" `{start 2, stop 60, grp 2, spc 2}`, plus an All segment 60-150 "Rest" → ranges Patio `{ start 0, len 60, pattern { kind: "every", n: 2, group: 2 } }` with 2 slots, and Rest; `normalize: false`.
  - The same two segments with no names → one Every range named "Range 1".
  - A segment 0-150 with `grp 3, spc 1`, named "Porch" → All "Porch", `normalize: true`.
  - Segments that cover 0-100 only → a second range `{ name: "Range 2", start: 100, len: 50 }` whose slot has `on: false`; `normalize: true`.
  - Segment ID 1 over 0-150 and ID 2 over 50-60 → one range; `normalize: true`.
  - Front Roof, "Peak paint" 200-300 `frz: true`, with `paint["Peak paint"]` of 100 colors → an Individual range with that paint. Without the map entry → 100 copies of `col[0]` as hex.
  - Malformed state: `parseState({ on: "x", seg: [{ id: 0, start: "x", stop: 5 }, { id: 1, start: 0, stop: 10, n: "A".repeat(100), col: [[300,0,0], "red"], grp: -1, c3: 99 }] })` → `on: false`; one segment, ID 1; `n` is 32 bytes; `col` is `[[0,0,0],[0,0,0],[0,0,0]]`; `grp` 1; `c3` 16.
  - `segmentName("Küche Fenster Nord Süd Ost West Garten", { k: 1, n: 2 })` → at most 32 bytes, ends with `" 1/2"`, and `Buffer.from(name).toString() === name`.
  - `decodePaint([0, 2, "FF0000", "00FF00"], 4)` → `["#FF0000","#FF0000","#00FF00","#000000"]`. `encodePaint(["#FF0000","#FF0000","#FFFFFF"])` → `[0, 2, "FF0000", 2, 3, "FFFFFF"]`.
  - Malformed paint: `decodePaint([-5, 999, "ZZZZZZ", 0, 2, "FF0000", [1, 2], "<b>"], 4)` → exactly 4 items, each matches `^#[0-9A-F]{6}$`, and LEDs 0-1 are `"#FF0000"`.
- [ ] **Step 2: Run** `pnpm test server/lights/layoutRead.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by the algorithm above.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights/layoutRead.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): read WLED segments as strands, ranges and patterns`

### Task 5: Layout write and the round-trip property

review: yes (device writes; spec §3 anti-goals; segment ID allocation)

**Files:**
- Create: `server/lights/layoutWrite.ts`
- Modify: `package.json` (`pnpm add -D fast-check@^4`)
- Test: `server/lights/layoutWrite.test.ts`

**Interfaces:**
- Consumes: `readStrand`, `readLayout`, `segmentName`, `encodePaint`, `WledSeg`, `WledState`, `Strand`, `Lists`, `PaintMap` (Task 4); `StrandPatch`, `RangeView` (Task 1); `applyPost`, `simFromState`, `listState` (Task 2) in the tests only.
- Produces, in `server/lights/layoutWrite.ts`:
  - `type SegPatch = { id: number } & Partial<Omit<WledSeg, "id">> & { rev?: boolean; mi?: boolean; i?: (number | string)[] }`.
  - `type LayoutWrite = { seg: SegPatch[][]; paint: { name: string; i: (number | string)[] }[] }`.
  - `class LayoutError extends Error { code: "segment_budget" | "invalid_layout" | "shared"; need?: number; free?: number }` (fields assigned in the constructor; no parameter properties). The endpoint maps it to `ApiError` with `messages` (Task 7 `deviceError`).
  - `validateRanges(strand: Strand, ranges: RangeView[], effectCount: number, opts?: { sharedNames?: boolean }): string | null` (the rules in "API contract"). `sharedNames: true` allows two ranges with the same name; only the separate cut of Task 10 uses it.
  - `segmentsNeeded(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap): number` (creates minus removes).
  - `writeStrand(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap, maxseg: number, opts?: { sharedNames?: boolean }): LayoutWrite`. When `next.ranges` is set, it first calls `validateRanges(strand, next.ranges, lists.effects.length, opts)` and throws `LayoutError("invalid_layout")` on a reason. So every caller (strand edit, scene apply, look apply, separate cut, split) validates before it writes.

**The write algorithm:**

1. Read the current strand with `readStrand`.
2. Shared strand:
   - If `next.ranges` is set and is not one All range over the strand, throw `LayoutError("shared")`.
   - Otherwise, patch the slot fields and `on`/`bri` on the crossing segments and the inside segments. Stop.
3. `on` and `bri` alone: one patch per segment of the strand. With `on: true`, add a paint entry for each Individual range.
4. With `ranges` on a strand marked `normalize`: remove every inside segment. Every next range is new.
5. With `ranges` on another strand: match each next range to a current range with the same `start`, `len` and pattern (`kind`, `n`, `group`). For a match:
   - Patch only the slot fields that differ: `col`, `fx`, `sx`, `ix`, `c1`, `c2`, `c3`, `o1`, `o2`, `o3`, `pal`, `on`.
   - When the name differs, patch `n` on every segment of the range.
   - When the paint differs, add a paint entry.
   Unmatched current ranges are removed. Unmatched next ranges are new.
6. New segment bodies (spec §6.2 geometry table): `start`, `stop`, `grp`, `spc`, `of: 0`, `rev: false`, `mi: false`, `frz` (`true` only for Individual), `n` from `segmentName`, `on`, `bri` (strand value), and every slot field. Each new Individual range gets a paint entry.
7. IDs (Plan decision 5): new segments take, in this order, the removed IDs (ascending, as overwrites), the unlisted IDs below the highest listed ID (ascending), then `max + 1`, `max + 2`, and so on. A removed ID that is not reused gets `{ id, stop: 0 }`.
8. Budget: `need = new − removed`, `free = maxseg − listed`. If `need > free`, throw `LayoutError("segment_budget")` with `need` and `free`.
9. Requests: `sizeMin = max(highest listed ID, highest assigned ID) + 1`. If `sizeMin > 3`, each request has fewer than `floor(sizeMin / 2)` deletes. The deletes come first, in as many requests as necessary. Overwrites, creates and patches go in the last request.
10. Never put `sel` or `mainseg` in a patch. Never patch a segment that is not inside or crossing the strand.

- [ ] **Step 1: Write the failing tests.** State "split Backyard" = segment 0 over 0-150 "Range 1" and segment 1 over 150-300 "Range 1", `maxseg` 32.
  - Anti-goal: write o0 as All "A" 0-75 and All "B" 75-150 → no patch has `id: 1`; segment 0 is overwritten as A; B gets ID 2; no patch has a `sel` or `mainseg` key.
  - Then change only B's color to blue → `seg` is `[[{ id: 2, col: [[0,0,255],[0,0,0],[0,0,0]] }]]`, `paint` is `[]`.
  - Rename an Every 2 range "Patio" to "Deck" → patches `{ id, n: "Deck 1/2" }` and `{ id, n: "Deck 2/2" }` only.
  - Every 3 group 2 over strand LEDs 10-40 → new segments with `start` 10, 12, 14, `stop` 40, `grp` 2, `spc` 4, names "X 1/3", "X 2/3", "X 3/3".
  - Listed IDs `[0, 2, 5]` and a write that adds 4 segments and removes none → assigned IDs `[1, 3, 4, 6]`.
  - A strand with 8 segments (IDs 0-7) written as one All range → every request has at most 3 `stop: 0` entries; the last request holds the overwrite of ID 0; the union of deletes is IDs 1-7.
  - `maxseg` 16 with 15 listed, a write that needs 2 more → `LayoutError` `segment_budget`, `need` 2, `free` 1.
  - A strand marked `normalize` (one `grp 3` segment) and a next layout equal to its view → the old segment is overwritten with `grp 1`, `spc 0`.
  - Individual "Peak" with paint 5 × `#FF0000` + 5 × `#FFFFFF` → `paint: [{ name: "Peak paint", i: [0, 5, "FF0000", 5, 10, "FFFFFF"] }]`.
  - `{ on: true }` on a strand with an Individual range → one patch per segment with `on: true`, and one paint entry.
  - `writeStrand` with ranges that have a gap → `LayoutError` `invalid_layout`, and no `LayoutWrite`.
  - `validateRanges`: an overlap, two ranges named "A", `c3: 32`, a 65-character name, a paint of the wrong length → a reason. Two ranges named "A" with `{ sharedNames: true }` → `null`. A valid layout → `null`.
  - Review Focus 2: a range named "Küche Fenster Nord Süd Ost West Garten" with Every 2 → each segment `n` is at most 32 bytes, ends with `" 1/2"` or `" 2/2"`, and decodes as valid UTF-8.
  - Unique read names: `readLayout` of a strand with two foreign segments named "Porch" (0-50, 50-100) and no segment over 100-150 → names "Porch", "Porch 2", "Range 3"; `validateRanges` of the result → `null`.
- [ ] **Step 2: Write the failing property test** (in `layoutWrite.test.ts`), `fc.assert(..., { numRuns: 300, seed: 4242 })`:
  - Device: two strands (o0 len `1..300`, o1 len 50), `maxseg` 32, effects and palettes from the Backyard seed.
  - Arbitrary layout L for o0: ranges that partition `[0, len)`; names unique, `/^[A-Z][a-z]{0,10}$/`; patterns All, Every (with `n`, `group` inside every contract limit), Individual (random paint); slots with `fx < 10`, `c3 ≤ 31`; one `bri` 1-255 for the strand. Strand `on` = any slot on. Filter: total segments of L ≤ 32 − (o1 segments).
  - Start state: either the seed state split by strand, or the result of a write of another arbitrary layout L0 (so the diff path runs). o1 has 1-3 arbitrary segments.
  - Property: apply each request of `writeStrand(state, o0, { on, bri, ranges: L }, ...)` with `applyPost`, then apply the paint entries by name. Then:
    - `readLayout` of `listState` (paint map from the sent paint) gives o0 ranges deep-equal to L, `on` and `bri` equal, `normalize: false`;
    - o1's listed segments are deep-equal to before;
    - no request has `sel` or `mainseg`;
    - the listed count is ≤ 32.
- [ ] **Step 3: Run** `pnpm test server/lights/layoutWrite.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** by the algorithm above. When fast-check reports a counterexample, fix the code. Change the generator only when the counterexample breaks a contract limit.
- [ ] **Step 5: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights`. Expected: PASS.
- [ ] **Step 6: Commit.** Stage `package.json` and `pnpm-lock.yaml` too. `feat(server): write strand layouts as WLED segments`

### Task 6: Scene and look snapshots

review: no

**Files:**
- Create: `server/lights/snapshots.ts`
- Test: `server/lights/snapshots.test.ts`

**Interfaces:**
- Consumes: `Strand`, `Lists` (Task 4); `LayoutError` (Task 5); `StrandSnapshot`, `RangeSnapshot`, `SlotLook`, `Look`, `RangeView`, `StrandView`, `StrandPatch` (Task 1).
- Produces:
  - `snapshotStrand(view: StrandView): StrandSnapshot` (slots lose `on`; strand `on` and `bri` kept).
  - `lookFromRange(range: RangeView): Look` (throws `LayoutError("invalid_layout")` for Individual; the endpoint maps it to `painted`).
  - `fitRanges(ranges: RangeSnapshot[], len: number): { ranges: RangeSnapshot[]; warnings: string[] }`. Shorter: drop ranges that start at or past `len`, cut the last one. Longer: the last range grows to the end; its paint repeats its last color. An Every range that becomes too short (Plan decision 4) turns into All with its first slot and a warning.
  - `resolveSlot(slot: SlotLook, lists: Lists): { slot: SlotLook; warnings: string[] }`. Keep `fx` when `lists.effects[fx] === fxName`; else use `indexOf(fxName)`; else 0 "Solid" with a warning. The same for `pal` with 0 "Default".
  - `sceneToPatch(snapshot: StrandSnapshot, ledCount: number, strand: Strand, lists: Lists): { next: StrandPatch; warnings: string[] }`. It adds the LED-count warning when `strand.len !== ledCount`. Slots get `on` = `snapshot.on`.
  - `lookToPatches(look: Look, targets: { strand: StrandView; range?: string }[], lists: Lists): { patches: { key: string; next: StrandPatch }[]; warnings: string[] }`. A target with no `range` covers every range of the strand. Each target range keeps `name`, `start` and `len`, takes the look's pattern and slots (`on: true`), and loses `paint`. A range too short for the look is skipped with a warning.
- The endpoint tests of Tasks 11 and 12 cover the LED-count warning, the missing-effect warning, a look on a whole strand, and the `painted` error.

- [ ] **Step 1: Write the failing tests.**
  - `fitRanges` of `[A 0-100, B 100-150]` to 120 → `[A 0-100, B 100-120]`; to 90 → `[A 0-90]`; to 200 → B is 100-200.
  - An Individual last range grown by 2 → its paint ends with two copies of its last color.
  - Every 4 group 2 over 10 LEDs fitted to 6 → All with slot 0, warning "Patio is too short for Every 4 now, so it uses All."
  - `resolveSlot` with `fxName: "Rainbow"` at `fx 2` and `lists.effects[9] === "Rainbow"` → `fx 9`. With `palName: "Ocean"` missing → `pal 0`, warning "Ocean isn't on this controller. Default is used instead."
  - `lookToPatches` with Every 2 group 3 on a 3-LED range → skipped, warning "Rest is too short for this look."
- [ ] **Step 2: Run** `pnpm test server/lights/snapshots.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights/snapshots.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): snapshot strands as scenes and ranges as looks`

### Task 7: Lights runtime, startup preset and device lights service

review: yes (in-memory timers, writes to device flash)

**Files:**
- Create: `server/lights/startup.ts`, `server/lights/runtime.ts`, `server/lights/deviceLights.ts`
- Modify: `server/app.ts` (AppDeps, ServerDeps, onClose), `server/server.ts`, `test/testApp.ts`, `CONVENTIONS.md` §5, `CLAUDE.md` "Stack"
- Test: `server/lights/startup.test.ts`, `server/lights/runtime.test.ts`

**Interfaces:**
- Consumes: `deviceRequest` (prior Task 4); `DeviceRow`, `devices` (prior Task 3); `targetOf` (prior Task 6); `ApiError`, `messages` (prior Task 2, Task 1); `strandGroups`, `preferences.get`, `LightsView`, `LightsPatch` (Task 1); `WledInfo` (existing `shared/apiTypes.ts`); `WledConfig` (prior plan Task 2); `parseState`, `strandsFromConfig`, `readLayout`, `decodePaint`, `encodePaint`, `FLASH_NAME`, `WledSeg`, `WledState`, `Strand`, `Lists`, `PaintMap` (Task 4); `LayoutError`, `LayoutWrite` (Task 5); `simFromState`, `applyPost`, `bootSim`, `listState` (Task 2) in the tests only.
- Produces:
  - `AppDeps` adds `flashMs: number` (3000 in `server.ts`) and `startupDelayMs: number` (5000). `makeTestApp` options add `flashMs?` and `startupDelayMs?`, both default `60_000`, so other tests never see a timer fire.
  - `type ServerDeps = AppDeps & { lights: LightsRuntime }`. `buildApp(deps: AppDeps)` builds one object `{ ...deps, lights: createLightsRuntime(deps, app.log) }` and passes it to every route plugin. A plugin that needs the runtime (`controlRoutes`, `devicesRoutes`, `lightsRoutes`, `presetsRoutes`) types its options as `ServerDeps`. `buildApp` calls `lights.close()` in an `onClose` hook.
  - `const STARTUP_ID = 250`; `buildStartupPreset(state: WledState, paint: PaintMap, maxseg: number): Record<string, unknown>` → `{ psave: 250, o: true, n: "Strand: startup", bootps: 250, seg }` with `seg` as Plan decision 2 says. A listed segment body has every `WledSeg` field. It also has `i` (from `encodePaint`) when its name ends in `" paint"` and `paint` has it. A segment named `FLASH_NAME` is written as `{ id, stop: 0 }`. No top-level `on` or `bri` (Plan decision 1).
  - `type RuntimeLog = Pick<FastifyBaseLogger, "warn">`. `buildApp` passes `app.log`. Every log call is `log.warn({ deviceId, message }, "<event>")`, with `message` = the error's message. It never logs a body, a reply or paint.
  - `createLightsRuntime(deps: AppDeps, log: RuntimeLog): LightsRuntime` with:
    - `afterWrite(row: DeviceRow): void`. It restarts the device's startup timer at `startupDelayMs`. When the timer fires:
      - If a save for this device is in flight, start the timer again.
      - Else send `GET /json/state`, `GET /json/info` (for `maxseg`) and `GET /presets.json`. The paint is preset 250's paint (`decodePaint`, with the same shape checks as `readDeviceLights`) with `paintFor` merged over it. A strand that was not edited since the last save thus keeps its paint. Then send one `POST /json/state` with `buildStartupPreset` and this paint.
      - On a failure, log `"startup preset save failed"`.
      - After a save succeeds, clear the device's paint memory.
    - `rememberPaint(deviceId: string, paint: PaintMap): void` (merge) and `paintFor(deviceId: string): PaintMap`.
    - `startFlash(deviceId: string, end: () => Promise<void>): void`. It cancels the device's previous flash timer without a call to its `end`, and calls `end` after `flashMs`. It catches a rejection of `end` and logs `"flash end failed"`, so a rejection is never unhandled.
    - `flashActive(deviceId: string): boolean`.
    - `forget(deviceId: string): void` (clears the device's timers and paint memory).
    - `close(): void` (clears every timer).
  - In `deviceLights.ts`:
    - `type DeviceLights = { row: DeviceRow; state: WledState; info: WledInfo; lists: Lists; strands: Strand[]; dropped: string[]; paint: PaintMap; view: LightsView }`.
    - `readDeviceLights(deps: ServerDeps, row: DeviceRow): Promise<DeviceLights>`. It writes nothing to the device or the database (Plan decision 13).
      - Requests in this order: `/json/cfg`, `/json/state`, `/json/info`, `/json/effects`, `/json/palettes`, then `/presets.json` only when a listed segment name ends in `" paint"`.
      - Shape checks: the state goes through `parseState`. `info.leds.maxseg` must be an integer 1-256. Each `hw.led.ins` entry needs integer `start ≥ 0` and `len ≥ 1`. Else `502 device_error`. Preset 250's `seg` entries count only when `n` is a string and `i` is an array.
      - Paint = preset 250's `i` arrays by segment name (`decodePaint`), overridden by `paintFor`.
      - A dropped group gives the notice. With `info.leds.matrix`, the view is `{ ..., strands: [], matrix: true }`.
    - `clearLeftovers(deps: ServerDeps, d: DeviceLights): Promise<DeviceLights>`. Every write endpoint calls it after `readDeviceLights` and before its own write. It deletes `d.dropped` from `strand_groups`. When `flashActive` is false and a listed segment is named `FLASH_NAME`, it sends `{ seg: [{ id, stop: 0 }] }` for each and reads `/json/state` again. It returns the updated `DeviceLights`. With nothing to clear, it sends nothing.
    - `writeLayout(deps: ServerDeps, d: DeviceLights, write: LayoutWrite): Promise<DeviceLights>`.
      - It posts each `seg` request, reads `/json/state` again, and posts each paint entry as `{ seg: { id, i } }` with the ID found by name. One request holds at most 256 runs.
      - It remembers the paint, calls `afterWrite`, and returns `readDeviceLights`.
      - Errors: when a request fails after the first request was sent, it calls `afterWrite` and throws the device error. A paint segment that is not on the device after the re-read gives `409 strand_changed`. The browser then reads the view again (Task 16).
    - `setDevicePower(deps: ServerDeps, row: DeviceRow, patch: LightsPatch): Promise<Record<string, unknown>>`. It returns the device's full state reply, as `PATCH state` did (prior plan Task 10).
      - With `on: true`: it reads `/json/state` and the paint, and sends one `POST /json/state` with `on`, `bri` (when given), `v: true`, and `seg: [{ id, i }]` for each painted segment.
      - Otherwise: it sends only `on`, `bri` and `v: true`.
      - It does not call `afterWrite`.
    - `deviceError(e: LayoutError, strandName: string): ApiError` (maps to the contract statuses and `messages`).

- [ ] **Step 1: Write the failing tests.**
  - `buildStartupPreset` with listed IDs 0 and 2, `maxseg` 4, and paint for "Peak paint" (ID 2) → `seg` is `[{id:0,...}, {id:1,stop:0}, {id:2,...,i:[...]}, {id:3,stop:0}]`; the object has no `on` and no `bri` key.
  - Review Focus 3: a listed segment "Strand flash" at ID 3 → `seg[3]` is `{ id: 3, stop: 0 }`. With `rememberPaint` set and no paint in `/presets.json`, the fired `psave` body has the remembered `i`.
  - Boot: apply the startup preset body with `applyPost` to a sim, then `bootSim(sim, { on: false, bri: 128 })` → `listState` has `on: false` and the same segments, geometry and names as the state the body was built from. The same with a sim that started with two auto segments: `bootSim(sim, { on: false, bri: 128 }, { outputs: [{ start: 0, len: 150 }, { start: 150, len: 150 }] })`.
  - Runtime against a fake, `startupDelayMs` 80: `afterWrite` twice, 30 ms apart → no `psave` before 80 ms after the second call, and exactly one `psave` request after 200 ms.
  - Save in flight: `startupDelayMs` 50, `fake.failNext("timeout", { method: "POST", path: "/json/state" })`, `afterWrite`, then `afterWrite` again at 70 ms → the second `psave` starts after the first request ends, never while it is in flight.
  - Paint memory: `rememberPaint`, `afterWrite`, the save succeeds → `paintFor` is `{}`.
  - Paint kept across saves: paint strand A ("A paint"), `afterWrite`, let the save run (paint memory is cleared). Then paint strand B ("B paint"), `afterWrite`, let the save run → the second `psave` body has the `i` of "A paint" and of "B paint".
  - `close()` after `afterWrite` → no `psave` after 200 ms.
  - `startFlash` twice, 10 ms apart, `flashMs` 50 → the first `end` never runs; the second runs once.
  - `startFlash` with an `end` that rejects with `new Error("x")` → no unhandled rejection; the log stub got one call `({ deviceId, message: "x" }, "flash end failed")` and nothing else.
- [ ] **Step 2: Run** `pnpm test server/lights/startup.test.ts server/lights/runtime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update the rules.**
  - In CONVENTIONS.md §5, replace "The server keeps no device state, connection or queue in memory between requests." with: "The server keeps no state that must survive a restart. `server/lights/runtime.ts` holds the only in-memory state: the 3-second flash timer, the 5-second startup-preset timer, and the paint it last sent, per device."
  - In CLAUDE.md "Stack", replace "The server is stateless in memory and talks to devices only over HTTP" with: "The server keeps in memory only the lights runtime (per device: the flash timer, the startup-preset timer and the paint it last sent; see CONVENTIONS.md §5), and talks to devices only over HTTP".
- [ ] **Step 5: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/lights server/app.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(server): add the lights runtime and the startup preset`

### Task 8: Lights read, device power and flash endpoints

review: no

**Files:**
- Create: `server/routes/lights.ts`
- Modify: `server/app.ts` (register `lightsRoutes`), `server/routes/control.ts` (`PATCH state` uses `setDevicePower`; options type `ServerDeps`)
- Test: `server/routes/lights.test.ts`, `server/routes/control.test.ts`

**Interfaces:**
- Consumes: `readDeviceLights`, `clearLeftovers`, `setDevicePower`, `deviceError`, `ServerDeps`, `LightsRuntime.startFlash`, `LightsRuntime.flashActive` (Task 7); `loadDevice` (prior Task 8); `FLASH_NAME`, `parseState` (Task 4); `strandGroups.list` (Task 1); `FakeWled.applyState`, `FakeWled.cfg` (Task 2; `cfg` is from prior Task 4) in the tests only.
- Produces: `lightsRoutes(app: FastifyInstance, deps: ServerDeps)` with `GET lights`, `PATCH lights`, `POST lights/flash`. Tasks 9 and 10 add the other Lights endpoints to this file. `controlRoutes(app, deps: ServerDeps)`: `PATCH state` calls `setDevicePower` and answers its return value.
  - `GET lights`: `readDeviceLights`; answer `view`. It sends no `POST` and writes nothing to the database.
  - `PATCH lights`: `readDeviceLights`, `clearLeftovers`, `setDevicePower`, then `readDeviceLights`.
  - `POST lights/flash { strandKey, led }`: `led` is an integer in `[0, strand.len)`.
    - The ID is the highest ID below `maxseg` that is not listed (spec §6.6, "the highest free ID"; a lower free ID never overwrites a live segment).
    - One `POST /json/state` deletes every listed flash segment and creates `{ id, start, stop: start + 1, fx: 0, col: [[255,255,255]], bri: 255, on: true, n: "Strand flash" }` (`start` = strand start + `led`).
    - Then `startFlash` with an `end` that reads the state and deletes the segments named `FLASH_NAME`. Answer 204.
    - No free segment → `422 segment_budget`, `need` 1.
  - Body schemas: `PATCH lights` `{ on?: boolean, bri?: integer 0-255 }`, `minProperties: 1`. `POST lights/flash` `{ strandKey: string (pattern ^o\d+(\+o\d+)*$), led: integer ≥ 0 }`, both required. All with `additionalProperties: false`.

- [ ] **Step 1: Write the failing tests.**
  - `GET lights` on Backyard → 200; two strands, both `shared`, o0 `with: ["o1"]`, each with one All range "Range 1" of len 150; `segments: { used: 1, max: 32 }`; `notices: []`; `matrix: false`. The fake got `/json/cfg`, `/json/state`, `/json/info`, `/json/effects`, `/json/palettes` and no `POST`.
  - A leftover "Strand flash" segment (`fake.applyState`) → `GET lights` sends no `POST` and no range shows it. Then `PATCH lights { bri: 100 }` → the fake got a `POST` that deletes it.
  - `infoOverride: { leds: { ...seed.info.leds, matrix: { w: 16, h: 16 } } }` → `matrix: true`, `strands: []`.
  - A stored group `o0+o1` and a config where o1 starts at 160 → `GET lights` has `notices: ["A combined strand was separated because its LED outputs no longer touch."]`, and `strandGroups.list` is still `["o0+o1"]`. Then `PATCH lights { on: true }` → `strandGroups.list` is `[]`.
  - Paint from the startup preset: Front Roof with "Gutter" All 0-200 and "Peak paint" 200-300 `frz: true`, and preset 250 that holds the candy-cane `i` (both set with `fake.applyState`, the preset with a `psave` body). A fresh app (paint memory empty) → `GET lights` reads `/presets.json`, and the Individual range "Peak" has the candy-cane paint.
  - Review Focus 5: the same Front Roof setup, then `PATCH lights { on: false }`. `PATCH state { on: true }` → one `POST` whose body has `on: true` and `seg: [{ id, i: [...] }]`; afterward the fake segment "Peak paint" has `frz: true` and its pixels equal the paint; the response is the device's full state. The same for `PATCH lights { on: true }`, whose response is a `LightsView`.
  - `PATCH lights { on: false }` → the fake got one `POST` with exactly `{ on: false, v: true }`; the response has `on: false`.
  - `PATCH lights` with `{}`, `{ on: "true" }`, `{ bri: 256 }`, `{ seg: [] }` → `400 invalid_request`; no `POST`.
  - Split Backyard, `flashMs` 60: `POST flash { strandKey: "o1", led: 0 }` → 204; the fake got `{ id: 31, start: 150, stop: 151, fx: 0, col: [[255,255,255]], bri: 255, on: true, n: "Strand flash" }` in a `seg` array; 200 ms later no listed segment is "Strand flash".
  - A second flash 10 ms after the first → its `POST` deletes the first flash segment; one flash segment is listed.
  - `led: 150` on o1 → 400. `strandKey: "o9"` → `409 strand_changed`. All 32 IDs listed → `422 segment_budget`, body `need: 1`, message "This needs 1 more segment and 0 are free. Remove a range first."
- [ ] **Step 2: Run** `pnpm test server/routes/lights.test.ts server/routes/control.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The prior `control.test.ts` assertions (`{ on: false, v: true }`, `{ bri: 128, v: true }`, the full state in the response) stay true and must pass unchanged.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lights.test.ts server/routes/control.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add lights view, device power and LED flash endpoints`

### Task 9: Strand edit and shared-segment endpoints

review: no

**Files:**
- Modify: `server/routes/lights.ts`, `server/lights/layoutWrite.ts`
- Test: `server/routes/lights.test.ts`

**Interfaces:**
- Consumes: `writeStrand`, `LayoutError`, `LayoutWrite` (Task 5); `readStrand`, `WledState`, `Strand` (Task 4); `readDeviceLights`, `clearLeftovers`, `writeLayout`, `deviceError`, `ServerDeps` (Task 7); `strandGroups.list`, `strandGroups.replace` (Task 1); `FakeWled.applyState`, `FakeWled.afterPost`, `FakeOpts.maxBody` (Task 2) in the tests only.
- Produces:
  - `PATCH lights/strands/:key` (`bodyLimit: 262144`): check the body (schema below), `readDeviceLights`, `clearLeftovers`, find the strand (`409 strand_changed`), `writeStrand` (it validates; `422 invalid_layout`), `writeLayout`. Answer the new `LightsView`.
    - Schema: `{ on?: boolean, bri?: integer 1-255, ranges?: RangeView[] }`, `minProperties: 1`. `RangeView`, `SlotView` and `Pattern` schemas have every field typed and `additionalProperties: false`; `name` max length 256, `ranges` max 256 items, `paint` max 65536 items. The `validateRanges` rules check the rest.
  - `POST lights/strands/:key/resolve { action: "split" | "combine" }` (schema with `enum`). The strand must be `shared`; else answer the current view.
    - `combine`: save the group of the strand and every strand in `shared.with`, joined with `+` in LED order (`strandGroups.replace` with the other groups kept). No device write.
    - `split`: `clearLeftovers`, `splitShared`, then `writeLayout`.
  - In `server/lights/layoutWrite.ts`: `splitShared(state: WledState, touched: Strand[], maxseg: number): LayoutWrite`. One request:
    - The first crossing segment is overwritten as the first touched strand's All range "Range 1" (`grp 1`, `spc 0`, its old slot fields).
    - Each other touched strand gets a new segment with the same slot (IDs by the Task 5 rule).
    - Every other crossing or inside segment of the touched strands is deleted.
    - Budget as in Task 5.

- [ ] **Step 1: Write the failing tests.**
  - Backyard seed: `PATCH strands/o0` with two ranges → `409 shared`, message "Strand 1 shares a segment with another strand. Choose Split or Combine on the Lights tab first."
  - `PATCH strands/o0 { bri: 90 }` on the seed → the shared segment gets `bri: 90`.
  - `resolve { action: "split" }` → listed segments are 0-150 "Range 1" and 150-300 "Range 1", each with the old `col`, `fx` and `pal`.
  - `resolve { action: "combine" }` → `strandGroups.list` is `["o0+o1"]`; the view has one strand `o0+o1` with one All range; the fake got no `POST`.
  - After split, `PATCH strands/o0` with "A" All 0-75 and "B" Every 2 group 1 75-150 → the response ranges equal the request ranges (names, positions, patterns, slots); o1's segment is deep-equal to before.
  - With `startupDelayMs` 50: 200 ms after that write, the fake got one `psave` request.
  - Review Focus 1: a range of 4 LEDs with Every 3 group 2 → `422 invalid_layout`, no `POST`.
  - A layout that needs 2 more segments when 1 is free → `422 segment_budget`, body `need: 2`, message "This needs 2 more segments and 1 is free. Remove a range first."
  - `{}`, `{ ranges: "x" }`, `{ bri: 0 }`, `{ on: true, x: 1 }`, a slot with an extra key → `400 invalid_request`.
  - A strand with a foreign `grp 3` segment → its first `PATCH` overwrites that segment with `grp 1`.
  - Write fails part-way, `startupDelayMs` 50: o0 with 8 segments written as one All range (three or more `seg` requests), `fake.failNext("timeout", { method: "POST", path: "/json/state", skip: 1 })` → `504 device_offline`; 200 ms later the fake got one `psave`.
  - Paint fails: an Individual range written with `fake.failNext("timeout", { method: "POST", path: "/json/state", skip: 1 })` (the paint request) → `504`; the segments are on the fake; 200 ms later one `psave`.
  - Paint segment gone: `fake.afterPost(() => fake.applyState({ seg: [{ id: <paint segment id>, n: "Other" }] }))` before an Individual write → `409 strand_changed`.
  - Largest paint (Q4): Front Roof, one Individual range over all 300 LEDs with a different random color on each LED → 200; every paint request has at most 256 runs; every request body is at most 10240 bytes (the fake's `maxBody`); the fake's pixels equal the paint. With `startupDelayMs` 50, the `psave` 200 ms later is accepted by the fake.
- [ ] **Step 2: Run** `pnpm test server/routes/lights.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lights.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add strand edit and shared segment endpoints`

### Task 10: Strand groups and strand names

review: no

**Files:**
- Modify: `server/routes/lights.ts`, `server/routes/devices.ts` (delete the name preference and the device's timers; options type `ServerDeps`), `server/routes/preferences.ts` (refuse `strandNames.` keys)
- Test: `server/routes/lights.test.ts`, `server/routes/devices.test.ts`, `server/routes/preferences.test.ts`

**Interfaces:**
- Consumes: `strandGroups.list`, `strandGroups.replace`, `preferences.get`, `preferences.put`, `preferences.remove` (Task 1, prior Task 3); `writeStrand` (Task 5); `readDeviceLights`, `clearLeftovers`, `writeLayout`, `LightsRuntime.forget`, `ServerDeps` (Task 7); `devicesRoutes`, `preferencesRoutes` (prior Tasks 6, 10).
- Produces:
  - `GET strand-groups` → `string[]`.
  - `PUT strand-groups { keys: string[] }` → `LightsView`.
    - Schema: `keys` is an array of strings that match `^o\d+(\+o\d+)+$`, max 64 items, `additionalProperties: false`. In the handler: more keys than outputs → `400 invalid_request`.
    - Each key names two or more existing outputs that touch in key order, and no output is in two keys. Else `422 not_adjacent`.
    - For each group that is removed: if a range of the combined strand crosses a member boundary, cut the ranges at the boundaries. Each piece keeps the name, pattern and slots; paint is cut by position. A piece too short for its Every pattern (Plan decision 4) becomes All with its first slot, as `fitRanges` does. Call `writeStrand` once on the combined strand with the cut ranges and `{ sharedNames: true }` (the two pieces share a name), then `writeLayout`. This write occurs before the groups change.
    - Then save the groups. A new group needs no device write.
  - `PUT strand-names { names: Record<string, string> }` → `LightsView`.
    - Schema: `names` is an object, max 64 properties, keys match `^o\d+(\+o\d+)*$`, values are strings of max length 1024, `additionalProperties: false` at the top level.
    - Each key must be a current strand key (`409 strand_changed`).
    - A value that is empty after trim deletes the name (the design's rename help: "Leave it empty to go back to the default name.", line 4961). A trimmed value of more than 64 characters → `422 invalid_name`. Else the trimmed value is stored.
    - Stored as the preference `strandNames.<deviceId>`.
  - `DELETE /api/devices/:id` also removes `strandNames.<id>` and calls `lights.forget(id)`.
  - `PUT /api/preferences/:key` with a key that starts with `strandNames.` → `400 invalid_request` (Plan decision 14).

- [ ] **Step 1: Write the failing tests** (split Backyard):
  - `PUT strand-groups { keys: ["o0+o1"] }` → view with strand `o0+o1`; `GET strand-groups` → `["o0+o1"]`; no device `POST`.
  - `["o0+o2"]`, `["o1+o0"]`, `["o0+o1", "o0+o1"]` (o0 in two keys) → `422 not_adjacent`.
  - `{ keys: ["o0"] }`, `{ keys: "o0+o1" }`, `{ keys: [], x: 1 }`, `{ keys: ["o0+o1", "o0+o1", "o0+o1"] }` (more keys than outputs) → `400 invalid_request`.
  - Combined strand with "Middle" All 100-200 → `PUT { keys: [] }` → listed segments include "Middle" 100-150 and "Middle" 150-200.
  - Combined strand with "Paint" Individual 100-200 whose LEDs 0-49 are red and 50-99 are blue → after `PUT { keys: [] }`, o0's "Paint" range is all red and o1's is all blue.
  - Combined strand with "Dots" Every 3 group 2 at 146-200 → after `PUT { keys: [] }`, o0's "Dots" (146-150, 4 LEDs) is All with the first slot of "Dots", and o1's "Dots" (150-200) is still Every 3 group 2.
  - Write before the groups change: combined strand with "Middle" 100-200, `fake.failNext("timeout", { method: "POST", path: "/json/state" })` (the reads succeed; only the write fails), `PUT { keys: [] }` → `504`; `strandGroups.list` is still `["o0+o1"]`.
  - `PUT strand-names { names: { o0: "Eaves" } }` → strand o0 name "Eaves". `{ o0: "  " }` → "Strand 1". `{ o9: "x" }` → `409 strand_changed`. A 65-character name → `422 invalid_name`, "Names need 1 to 64 characters." `{ names: { o0: 5 } }`, `{ names: {}, x: 1 }`, `{ names: { "a b": "x" } }` → `400 invalid_request`.
  - `PUT /api/preferences/strandNames.<id> { value: { o0: "x" } }` → `400 invalid_request`; the preference is unchanged.
  - `DELETE /api/devices/:id` → `preferences.get(db, "strandNames.<id>")` is `undefined`. With `startupDelayMs` 50, a strand write, then `DELETE` at once → no `psave` after 200 ms.
- [ ] **Step 2: Run** `pnpm test server/routes/lights.test.ts server/routes/devices.test.ts server/routes/preferences.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/lights.test.ts server/routes/devices.test.ts server/routes/preferences.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add strand combinations and strand names`

### Task 11: Scene endpoints

review: no

**Files:**
- Create: `server/routes/presets.ts`
- Modify: `server/app.ts` (register `presetsRoutes`)
- Test: `server/routes/presets.test.ts`

**Interfaces:**
- Consumes: `scenes`, `SceneRow` (Task 1); `snapshotStrand`, `sceneToPatch` (Task 6); `writeStrand` (Task 5); `readDeviceLights`, `clearLeftovers`, `writeLayout`, `deviceError`, `ServerDeps` (Task 7); `ApiError`, `messages` (Task 1); `FakeWled.applyState`, `FakeWled.cfg` (Task 2; `cfg` is from prior Task 4) in the tests only.
- Produces: `presetsRoutes(app: FastifyInstance, deps: ServerDeps)` with the scene endpoints of spec §9. Task 12 adds the look endpoints to this file.
  - `toScene(row: SceneRow): Scene` computes `summary`.
  - `GET`, `PATCH` and `DELETE` use only the database. `POST` and `apply` read the device.
  - Name rule (`POST` and `PATCH`): 1-64 characters after trim, else `422 invalid_name`. The trimmed name is stored.
  - Schemas: `POST { name: string (max 1024), strandKey: string (pattern ^o\d+(\+o\d+)*$) }`; `PATCH { name: string (max 1024) }`; `apply` takes no body. All with `additionalProperties: false`.
  - `POST`: content over 65536 bytes of JSON → `422 invalid_layout`, "This setup is too large to save." The 257th scene → `422 too_many`.
  - `PATCH` or `apply` of an unknown scene ID → `404 not_found`, "That scene was deleted."
  - `DELETE` answers 204, also when the scene is already gone (Plan decision 21).
  - `apply`: `clearLeftovers`; the strand must exist (`409 strand_changed`) and not be shared (`409 shared`); `sceneToPatch`, `writeStrand` (it validates and checks the budget), `writeLayout`. Answer `{ view, warnings }`.

- [ ] **Step 1: Write the failing tests** (split Backyard):
  - `POST scenes { name: "Party", strandKey: "o0" }` → 201 `{ name: "Party", strandKey: "o0", ledCount: 150, summary: "1 range · 100%" }` (the split segment has `bri` 255). `GET scenes` → one scene.
  - `name: ""`, `"  "`, 65 characters → `422 invalid_name`, "Names need 1 to 64 characters." `{ name: 5, strandKey: "o0" }`, `{ name: "a", strandKey: "o0", x: 1 }` → `400 invalid_request`. The 257th scene → `422 too_many`, "A device can keep 256 scenes." `strandKey: "o9"` → `409 strand_changed`.
  - A strand whose snapshot is over 65536 bytes of JSON (an Individual range of 8000 LEDs, set up with `fake.cfg` and `fake.applyState`) → `422 invalid_layout`, "This setup is too large to save."
  - `PATCH` → new name. `PATCH` with 65 characters → `422 invalid_name`. `DELETE` → 204. `DELETE` again → 204. `PATCH` after the delete → `404 not_found`, "That scene was deleted." A scene ID of another device → `404 not_found`.
  - Save, change o0 to two ranges, `apply` → 200, `warnings: []`; the view's o0 equals the saved strand; the fake's o0 segments are one segment 0-150.
  - Config o0 `len` 100 (o1 `start` 100): `apply` → `warnings[0]` is "The strand has 100 LEDs now, not 150. The ranges were fitted to the new length."
  - A saved `fxName` that the device no longer has → `warnings` contains "<name> isn't on this controller. Solid is used instead."
  - Apply on the Backyard seed (shared strands) → `409 shared`.
  - `GET scenes` while the device is offline → 200.
- [ ] **Step 2: Run** `pnpm test server/routes/presets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/presets.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add scene endpoints`

### Task 12: Look endpoints

review: no

**Files:**
- Modify: `server/routes/presets.ts`
- Test: `server/routes/presets.test.ts`

**Interfaces:**
- Consumes: `looks`, `LookRow` (Task 1); `lookFromRange`, `lookToPatches` (Task 6); `segmentsNeeded`, `writeStrand` (Task 5); `readDeviceLights`, `clearLeftovers`, `writeLayout`, `deviceError`, `ServerDeps` (Task 7); `presetsRoutes` (Task 11).
- Produces: the look endpoints of spec §9.
  - Name rule (`POST` and `PATCH`): as in Task 11.
  - Schemas: `POST { name: string (max 1024), strandKey: string (pattern ^o\d+(\+o\d+)*$), range: string (max 64) }`; `PATCH { name: string (max 1024) }`; `apply { targets: LookTarget[] }` with `targets` 1-64 items, each `{ strandKey: string (pattern ^o\d+(\+o\d+)*$), range?: string (max 64) }`. All with `additionalProperties: false`, at every level.
  - `PATCH` or `apply` of an unknown look ID → `404 not_found`, "That look was deleted." `DELETE` answers 204, also when the look is already gone.
  - `apply`:
    - `clearLeftovers`.
    - Every strand key must exist (`409 strand_changed`) and not be shared (`409 shared`). A named range must exist (`404 not_found`, "That range isn't on the strand any more. Pick it again.").
    - Check the total `segmentsNeeded` against the free count before any write (`422 segment_budget`).
    - Write the strands one at a time (`writeStrand`, `writeLayout`).
    - When the write of strand k fails, the strands before k stay written. The endpoint answers the error; `writeLayout` has called `afterWrite`. The browser reads the view again (Task 22).
    - Answer `{ view, warnings }`.

- [ ] **Step 1: Write the failing tests** (split Backyard, o0 with "Patio" Every 2 group 2 0-60 and "Rest" All 60-150):
  - `POST looks { name: "Candy", strandKey: "o0", range: "Patio" }` → 201; `look.pattern` is `{ kind: "every", n: 2, group: 2 }`; slots have no `on`.
  - `range: "Nope"` → `404 not_found`. An Individual range → `422 painted`, "A range with painted LEDs can't be saved as a look." The 257th look → `422 too_many`, "A device can keep 256 looks." Name `""` or 65 characters → `422 invalid_name`.
  - `PATCH` → new name; 65 characters → `422 invalid_name`. `DELETE` → 204; again → 204. `PATCH` and `apply` after the delete → `404 not_found`, "That look was deleted."
  - `apply { targets: [{ strandKey: "o0" }] }` → Patio and Rest are Every 2 group 2 with the look's colors; names and positions kept.
  - `apply { targets: [{ strandKey: "o1", range: "Range 1" }] }` → only o1 changes.
  - `apply { targets: [{ strandKey: "o0", range: "Gone" }] }` → `404 not_found`, "That range isn't on the strand any more. Pick it again."; no `POST`.
  - `{ targets: [] }`, `{ targets: [{ strandKey: "o0", x: 1 }] }`, `{ targets: [{ strandKey: 5 }] }`, 65 targets → `400 invalid_request`.
  - Targets whose total need exceeds the free count → `422 segment_budget`, and the fake got no `POST`.
  - Backyard seed (shared) → `409 shared`.
  - Partial failure, `startupDelayMs` 50: targets o0 and o1, `fake.failNext("timeout", { method: "POST", path: "/json/state", skip: <o0 request count> })` → `504`; o0's segments on the fake have the look; o1's do not; 200 ms later one `psave`.
- [ ] **Step 2: Run** `pnpm test server/routes/presets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test server/routes/presets.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): add look endpoints`

### Task 13: Browser API client additions

review: no

**Files:**
- Modify: `src/api/client.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**
- Consumes: the contract types (Task 1); `request<T>(method, path, body?)` and `ApiError` (prior Task 11). `request<T>` is private to `src/api/client.ts`. This task adds its functions in the same module, so `request<T>` stays unexported.
- Produces, on `api`, with the mock's names (lines 605-633): `getLights(id): Promise<LightsView>`, `patchLights(id, body: LightsPatch): Promise<LightsView>`, `patchStrand(id, key, body: StrandPatch): Promise<LightsView>`, `resolveShared(id, key, action: "split" | "combine"): Promise<LightsView>`, `flash(id, strandKey, led): Promise<void>`, `getStrandGroups(id): Promise<string[]>`, `putStrandGroups(id, keys: string[]): Promise<LightsView>`, `putStrandNames(id, names: Record<string, string>): Promise<LightsView>`, `getScenes(id): Promise<Scene[]>`, `createScene(id, body: { name: string; strandKey: string }): Promise<Scene>`, `renameScene(id, sceneId, name): Promise<Scene>`, `deleteScene(id, sceneId): Promise<void>`, `applyScene(id, sceneId): Promise<ApplyResult>`, `getLooks(id): Promise<LookRecord[]>`, `createLook(id, body: { name: string; strandKey: string; range: string }): Promise<LookRecord>`, `renameLook(id, lookId, name): Promise<LookRecord>`, `deleteLook(id, lookId): Promise<void>`, `applyLook(id, lookId, targets: LookTarget[]): Promise<ApplyResult>`. Every path segment goes through `encodeURIComponent`.

- [ ] **Step 1: Write the failing tests.** Add one table row per function: method, path and body. Examples: `patchStrand("a/b", "o0+o1", { on: true })` → `PATCH /api/devices/a%2Fb/lights/strands/o0%2Bo1`, body `{"on":true}`. `resolveShared("d", "o0", "split")` → `POST /api/devices/d/lights/strands/o0/resolve`, body `{"action":"split"}`. `flash("d", "o1", 5)` → `POST /api/devices/d/lights/flash`, body `{"strandKey":"o1","led":5}`, resolves `undefined` on 204. `applyLook("d", "l", [{ strandKey: "o0" }])` → body `{"targets":[{"strandKey":"o0"}]}`.
- [ ] **Step 2: Run** `pnpm test src/api/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/api/client.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add lights, scene and look API functions`

### Task 14: Design-system primitives, icons and toasts

review: no

**Files:**
- Add with the shadcn CLI: `pnpm dlx shadcn@latest add switch sheet dropdown-menu badge skeleton`. Rename each generated file to camelCase (`dropdown-menu.tsx` → `dropdownMenu.tsx`) and fix its imports (CONVENTIONS.md §8). Then restyle each one with the design's class strings.
- Create by hand (shadcn has no match that fits): `src/components/ui/stepper.tsx` (shadcn has no stepper), `src/components/ui/slider.tsx` (the design uses a native range input with commit on `change`; the shadcn slider wraps Radix Slider and calls a React hook, which CONVENTIONS.md §3 bans), `src/components/ui/toaster.tsx` (Plan decision 17), `src/store/slices/toasts.ts`.
- Modify: `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/icon.tsx`, `src/store/index.ts` (add `toasts`), their stories.
- A `*.stories.tsx` for each new component.
- Test: `src/components/ui/button.test.tsx`, `src/components/ui/dropdownMenu.test.tsx`, `src/store/slices/toasts.test.ts`

**Interfaces:**
- Consumes: the design's class strings (lines 1825-1949) and `ICON_PATHS` (lines 143-197); `Tooltip` (existing `src/components/ui/tooltip.tsx`).
- Produces:
  - `Button` props: `variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "destructive-outline" | "destructive-ghost"`, `size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "inline"` (the design's `button()`, line 1857), and `reason?: string`. With `reason`: `aria-disabled="true"`, the button stays focusable, `aria-describedby` points to a `sr-only` element that holds the reason, a `Tooltip` shows the reason on hover and focus, and a click or tap opens the tooltip and does not call `onClick`. `Dialog*` restyled with the design's `DIALOG_*` strings; keep Radix.
  - `Icon` takes the lucide names that the design uses (`ICON_PATHS` keys). Keep the existing names that current components use.
  - `Switch({ checked, onCheckedChange, "aria-label", disabled })` (`role="switch"`, design `SWITCH`).
  - `Slider({ value, min = 1, max = 255, onValueChange, onValueCommit, "aria-label", id, disabled })`: a native `input type="range"` with the design's track, range and thumb. `onValueChange` runs on `input`. `onValueCommit` runs on `change` (release, or each key press).
  - `Sheet`, `SheetContent` (Radix Dialog; bottom below 900 px, right side at `min-[900px]:`), `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`.
  - `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`. An item with `reason` is `aria-disabled`, shows the reason as a second line of muted text, has `aria-describedby` to that line, and does not call `onSelect`.
  - `Badge({ variant: "default" | "info" | "warning" | "danger" | "success" })`, `Skeleton({ className })`, `Stepper({ id, label, value, decReason, incReason, onStep(dir: -1 | 1), unit })` (design lines 4685-4703; the minus and plus are `Button`s with `reason`).
  - `toastsSlice` (`{ items: { id: number; kind: "success" | "error" | "info"; title: string; desc: string }[] }`, at most 3), and the thunk `toast(kind, title, desc?)` that adds an item and removes it after 4200 ms. `Toaster({ items })` renders them in an `aria-live="polite"` region.
- No component file calls a React hook. `pnpm lint` enforces it.
- The tests cover only repo logic. Native input and Radix behavior get no test.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - `Button` with `reason` "x" → `aria-disabled="true"`; its accessible description is "x"; a click does not call `onClick`.
  - `DropdownMenuItem` with `reason` "x" → the item's accessible description is "x"; a click does not call `onSelect`.
  - Toasts: with fake timers, `toast("error", "A")` four times → 3 items; after 4200 ms → 0 items.
- [ ] **Step 2: Run** `pnpm test src/components/ui src/store/slices/toasts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write each story. Change every existing use of the old `Button` variants (`primary`, `subtle`) and sizes (`md`) in `src/` to the new names.
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/ui src/store`. Open `pnpm storybook` and check each new story in light and dark: tokens match the design, focus rings show, a button with a reason shows the tooltip on focus, and the sheet is a bottom sheet at 375 px and a side sheet at 1440 px.
- [ ] **Step 5: Commit.** `feat(web): add the design's switch, slider, sheet, menu and toast primitives`

### Task 15: Lights model helpers

review: no

**Files:**
- Create: `src/lights/model.ts`
- Test: `src/lights/model.test.ts`

**Interfaces:**
- Consumes: `RangeView`, `StrandView`, `SlotView`, `Pattern`, `LightsView` (Task 1); `Effect`, `Palette` (Task 3); `LedOutput` (existing `shared/apiTypes.ts`).
- Produces (typed ports of the design functions; port each one as written, except where this block says otherwise):
  - From lines 4253-4330: `SLOT_COLORS`, `COLOR_NAMES`, `COLOR_SLOT_LABELS`, `LOCKED`, `colorName(hex)`, `segsOf(ranges)`, `freeSegs(view)`, `needMsg(need, free)`, `patternText(p)`, `rangeSummary(r)`, `usesPalette(fxs: Effect[], slot)`, `slotColorAt(fxs, pals, slot, t)` (empty `stops` → `col[0]`), `slotBackground`, `slotText(fxs, slot)`, `ledColors(fxs, pals, strand)`, `rangeColors`, `nextRangeName(ranges)`, `newSlot(slots)`, `withPattern(fxs, pals, r, p)`, `everyPreview(n, g)`; and `rangeLabel(r)` (line 1758), `pinLabel(pins)` (line 1753), `briToPct` (line 209), `plural` (line 243). `slotColorAt`, `ledColors` and `rangeColors` accept `fxs` and `pals` of `null` (lists not loaded) and then use `col[0]`.
  - From lines 4917-5045: `splitRange(rs, i, name)` (Add range), `mergeInto(fxs, pals, rs, keep, drop)`, `moveBoundary(rs, i, led): RangeView[] | null`.
  - From lines 4530-4540 and 5854-5860: `adjacentPairs(view)`, `cutRanges(ins: LedOutput[], strand)`.
  - New: `minLen(r: RangeView): number` = `(n − 1) · group + 1` for Every, else 1. `moveBoundary` clamps the boundary to `[a.start + minLen(a), b.start + b.len − minLen(b)]`.
  - New: `stepReasons(r, free): { nDown: string; nUp: string; gDown: string; gUp: string }` (design lines 4740-4752) plus two length reasons: `nUp` "This range is too short for another slot." when `n · g ≥ len`; `gUp` "This range is too short for a bigger group." when `(n − 1)(g + 1) ≥ len`.
  - New: `kindReason(r, kind, free, locked): string` (design lines 4710-4716).
- Tasks 18 and 19 test `moveBoundary`, `minLen` and the `stepReasons` slot and length limits through the strip and the steppers.

- [ ] **Step 1: Write the failing tests.**
  - `everyPreview(2, 2)` → `"1 1 2 2 1 1 2 2 …"`.
  - `withPattern` of an All range with slot `#FFB46B` to Every 2 → two slots; slot 2's `col[0]` is `[255,0,0]` (the first unused `SLOT_COLORS` entry).
  - `withPattern` to Individual → `paint` is `rangeColors` of the old range.
  - `splitRange` of a 5-LED range → lengths 2 and 3.
  - `stepReasons` with n 3 g 100 → `gUp` "With 3 slots, a group can be at most 127 LEDs."
  - `ledColors` for Every 2 group 2 with red and blue slots over 8 LEDs → `R R B B R R B B` as hex. With `fxs` and `pals` `null` → the same.
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
- Consumes: `api.getLights`, `api.patchStrand`, `api.resolveShared`, `api.flash`, `api.putStrandGroups`, `api.putStrandNames`, `api.getEffects`, `api.getPalettes`, `api.getConfig`, `api.getPreferences`, `api.putPreference` (Task 13, prior Task 11); `toast` (Task 14); `segsOf`, `freeSegs`, `needMsg` (Task 15); `createApiThunk` and its rejected-payload type `ThunkError` (`{ status?, code?, message }`, exported from `src/store/createApiThunk.ts`; prior Task 11); `LedOutput` (existing `shared/apiTypes.ts`).
- Produces:
  - State: `{ devices: Record<string, { view: LightsView | null; status: "idle" | "loading" | "ok" | "error"; error: ThunkError | null; effects: Effect[] | null; palettes: Palette[] | null; fxStatus: "idle" | "loading" | "ok" | "error"; fxError: ThunkError | null; outputs: LedOutput[] | null; outputsStatus: "idle" | "loading" | "ok" | "error"; outputsError: ThunkError | null; selected: string | null; selRange: Record<string, number>; flash: { key: string; led: number } | null }>; writes: Record<string, { busy: boolean; base: LightsView | null; dirty: ("on" | "bri" | "ranges")[]; hold: boolean }> }`. Write key: `` `${deviceId}|${strandKey}` ``.
  - Thunks:
    - `loadLights(id, opts?: { quiet?: boolean })`. With `quiet`, it does not set `status` to `loading`, and on a rejection it leaves the state as it is.
    - `loadFxLists(id)` (effects and palettes; sets `fxStatus` and `fxError`).
    - `loadOutputs(id)` (`api.getConfig`, keeps `hw.led.ins` in `outputs`; sets `outputsStatus` and `outputsError`).
    - `editStrand({ id, key, patch: Partial<Pick<StrandView, "on" | "bri" | "ranges">> }): boolean`, `beginPaint({ id, key })`, `endPaint({ id, key })`, `flashLed({ id, key, led })`, `adoptView({ id, view })`.
    - `resolveShared({ id, key, action })`. On success: adopt the view. For `combine`, select the joined key (members sorted by output index) and `toast("success", "Strands combined", "They're one strand now.")`. For `split`, `toast("success", "Split by strand", "Each strand has its own range now.")`. On an error: the lights error path (queue step 4).
    - `setStrandGroups({ id, keys })`: fulfills with the view and adopts it; on an error, the lights error path, then it rejects.
    - `setStrandName({ id, key, name })`: fulfills with the view and adopts it; on an error it rejects with the `ThunkError` payload and does not toast (the rename dialog shows the message).
  - Actions: `selectStrand({ id, key })`, `selectRange({ id, key, i })`, `paintCells({ id, key, i, from, to, color })`.
  - Selectors: `selectLights(state, id)`, `selectedStrand(state, id)` (the selected strand, else the first).
  - Preferences slice: `{ recentColors: string[]; favoriteEffects: string[]; loaded: boolean }`; thunks `loadPreferences()` (keys `recentColors`, `favorites.effects`), `pushRecentColor(hex)` (front, unique, at most 8, then `putPreference`), `toggleFavoriteEffect(name)`.

**The queue** (port of design lines 4335-4440, without module-level state):

1. Budget check. For a `ranges` patch on a strand that is not shared and not `normalize`: `need = segsOf(next.ranges) − segsOf(current.ranges)`. If `need > freeSegs(view)`, dispatch `toast("error", "Not enough segments", needMsg(need, free))`, send nothing, and return `false`. On a `normalize` strand, skip the check; the server's `422 segment_budget` (with its message) is the answer.
2. Otherwise apply the patch to the view at once (and add `need` to `segments.used`). Record `base` when the channel has none. Add the fields to `dirty`. If the channel is not busy and not on `hold`, start the pump.
3. The pump sets `busy`, builds the body from the current view's values for the `dirty` fields, clears `dirty`, and calls `api.patchStrand`. When the call ends:
   - If `dirty` is not empty and `hold` is false, send again.
   - Otherwise clear `base` and adopt the answer: every strand of the answer, except strands whose own channel is busy, which keep their current view.
4. The lights error path: restore `base`, clear the channel, dispatch `toast("error", "Couldn't change the lights", e.message)`, then dispatch `loadLights(id, { quiet: true })`. The device can hold part of a failed write (Task 7 `writeLayout`); the quiet read shows it, and a failed read keeps the rolled-back view.
5. `beginPaint` sets `hold` and records `base`. `endPaint` clears `hold`, adds `ranges` to `dirty`, and starts the pump.
6. `flashLed` calls `api.flash`, sets `flash`, and clears it after 3000 ms if it is still the same flash. On an error: `toast("error", "Couldn't flash the LED", e.message)`.

- [ ] **Step 1: Write the failing tests** (a real store; `api` functions stubbed with controllable promises):
  - Review Focus 4: edit o0's ranges twice while the first `patchStrand` is pending → still one call; after it resolves, exactly one more call whose body has the second edit's ranges; the final view is the second answer.
  - The first call rejects with `ApiError(504, "device_offline", "m")` and `getLights` rejects too → the view equals the view before both edits; `dirty` is empty; the toasts have "Couldn't change the lights".
  - A rejection with `ApiError(409, "strand_changed", "m")` and a `getLights` that resolves with view V → `getLights` was called once more, and the view is V.
  - An edit on o1 is in flight when o0's answer arrives → o1 keeps its optimistic view.
  - `free` 1 and an edit that needs 2 → returns `false`, no API call, toast "Not enough segments". The same edit on a `normalize` strand → one API call.
  - `beginPaint`, three `paintCells`, `endPaint` → one `patchStrand` call with the painted ranges.
  - `flashLed` with fake timers → `flash` is set; after 3000 ms it is `null`. A second flash at 2000 ms → at 3000 ms `flash` is the second flash; at 5000 ms it is `null`.
  - `resolveShared` with `combine` → the selected strand is `o0+o1`; toast "Strands combined". With `split` → toast "Split by strand". A rejection → toast "Couldn't change the lights".
  - `setStrandGroups` rejects → toast "Couldn't change the lights". `setStrandName` rejects with message "Names need 1 to 64 characters." → the rejected payload has that message, and no toast.
  - `loadFxLists` with `getEffects` rejecting → `fxStatus: "error"` and `fxError.message`.
  - `pushRecentColor` nine times → 8 colors, newest first; `putPreference("recentColors", ...)` called.
- [ ] **Step 2: Run** `pnpm test src/store/slices/lights.test.ts src/store/slices/preferences.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the queue state in the slice. The pump is a thunk that reads `getState()`. Do not declare a new error type.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/store`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): add the lights store with optimistic strand writes`

### Task 17: Device page shell

review: no

**Files:**
- Create: `src/screens/deviceScreen.tsx`, `src/store/slices/devicePage.ts`, `src/components/device/deviceHeader.tsx`, `src/components/device/deviceBanners.tsx`, `src/components/device/settingsPanel.tsx`, `src/components/appHeader.tsx`, stories for each component
- Modify: `src/router.tsx`, `src/store/index.ts`
- Test: `src/screens/deviceScreen.test.tsx`, `src/store/slices/devicePage.test.ts`

**Interfaces:**
- Consumes: `fetchDevices`, `devicesSlice` (prior Task 11); `api.getState`, `api.patchState`, `api.getInfo`, `api.getPendingReboot`, `api.reboot` (prior Task 11); `adoptView`, `loadLights`, `loadFxLists` (Task 16); `loadPreferences` (Task 16); `toast`, `Toaster`, `Switch`, `Badge`, `Skeleton`, `Button`, `Dialog*` (Task 14); `withRouter` (existing `src/lib/withRouter.tsx`).
- Produces:
  - Routes: `devices/:id` and `devices/:id/settings/*` → `DeviceScreen`.
  - `devicePageSlice`: `{ byId: Record<string, { state: { on: boolean; bri: number } | null; info: WledInfo | null; pending: string[] }> }`; thunks `loadDeviceState(id)`, `loadInfo(id)`, `loadPending(id)`, `setPower({ id, on })` (optimistic on both this slice and the lights view; on an error, roll back both and `toast("error", "Couldn't change the lights", e.message)`), `rebootNow(id)`, `retryDevice(id)`.
  - `DeviceScreen`: `compose(withRouter, connect(...), withActions(...), lifecycle(...))`.
    - It loads the device list, then the state, info and pending list for an online device.
    - It renders `AppHeader`, `DeviceHeader`, `DeviceBanners`, the tab list, and one tab panel. The tab comes from the path and `?tab=presets`.
    - This task renders the Lights and Presets panels empty. Task 18 puts `LightsTab` in the Lights panel. Task 22 puts `PresetsTab` in the Presets panel. The Settings panel is `SettingsPanel`.
    - Loads: the Lights tab dispatches `loadLights`, `loadFxLists` and (when `prefs.loaded` is false) `loadPreferences` when it opens, when the user switches back to it, and when "Retry" brings the device online. Task 22 adds the Presets tab loads.
  - Layout and copy: design lines 2775-2867 (`DevicePage`, `HeaderPower`, `OfflineBanner`, `PendingRebootBanner`) and `StatusText` (line 2418).
  - Tabs: a `role="tablist"` with classes `TABS_LIST` and `TABS_TRIGGER` (lines 1910-1912). Each tab is a link with `role="tab"`, `aria-selected`, `aria-controls` (its panel's ID), and a roving `tabIndex` (0 on the selected tab, -1 on the others). The panel is `role="tabpanel"` with `aria-labelledby`. ArrowLeft and ArrowRight move to the previous and next tab and open it (wrapping); Home and End open the first and last tab.
  - "Reboot now" opens a confirm dialog with the title "Reboot <name>?" and the buttons Cancel and Reboot.
  - `SettingsPanel`: a card with "Open WLED Advanced UI" (`href="http://<host>/settings"`, `target="_blank"`, `rel="noreferrer"`) (Plan decision 18).
  - `AppHeader`: the design's `Header()` (line 2462) without the theme menu, and the `StrandMark` (line 2439). It renders `Toaster`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`; a real store, `fetch` stubbed):
  - `/devices/<id>` → heading "Backyard", "Online", the host, three tabs; "Lights" has `aria-selected="true"` and `tabIndex` 0; its panel has `role="tabpanel"` and its `id` equals the tab's `aria-controls`.
  - Focus "Lights", press `ArrowRight` → "Presets" is selected and has focus; `End` → "Settings"; `ArrowRight` → "Lights".
  - `/devices/<id>?tab=presets` → "Presets" is selected. `/devices/<id>/settings` → "Settings" is selected and the "Open WLED Advanced UI" link has `href` `http://wled-backyard.local/settings`.
  - Loads: opening `/devices/<id>` → one `GET /lights`, one `GET /effects`, one `GET /palettes`, one `GET /api/preferences`. Switch to Presets, then back to Lights → a second `GET /lights`; still one `GET /api/preferences`.
  - Unknown ID → "This device isn't in Strand" and a "Back to devices" link.
  - An offline device → "Backyard is offline" and a Retry button; no header switch. Retry while the device answers → `GET /lights` is sent.
  - `info.live: true` → "Receiving live data from another source. Changes may not be visible until it stops."
  - Pending `["hostname"]` → "The new hostname takes effect after a reboot." Click "Reboot now" → a dialog "Reboot Backyard?"; Cancel sends nothing; Reboot sends `POST /api/devices/<id>/reboot`.
  - The header switch → `PATCH /api/devices/<id>/state` with `{"on":false}`; the switch shows off before the reply. A `504` reply → the switch is on again, and the toast "Couldn't change the lights" shows.
- [ ] **Step 2: Run** `pnpm test src/screens/deviceScreen.test.tsx src/store/slices/devicePage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/screens src/store`. Run the app ("Running the app for screenshots"). Screenshot the device page at 375, 768 and 1440 px: no horizontal scroll; tabs fill the width below 640 px; Tab reaches the back link, the switch and the selected tab with a visible focus ring; the arrow keys move between tabs.
- [ ] **Step 5: Commit.** `feat(web): add the device page with lights, presets and settings tabs`

### Task 18: Lights tab, strand panel and strip

review: no

**Files:**
- Create: `src/components/lights/lightsTab.tsx`, `strandPicker.tsx`, `strandPanel.tsx`, `strip.tsx`, with stories
- Modify: `src/screens/deviceScreen.tsx` (render `LightsTab` in the Lights panel and pass its props)
- Test: `src/components/lights/strip.test.tsx`, `src/components/lights/lightsTab.test.tsx`

**Interfaces:**
- Consumes: `editStrand`, `flashLed`, `selectStrand`, `selectRange`, `resolveShared`, `loadLights`, `selectLights`, `selectedStrand` (Task 16); `moveBoundary`, `minLen`, `splitRange`, `ledColors`, `freeSegs`, `pinLabel`, `briToPct`, `rangeLabel`, `LOCKED` (Task 15); `toast`, `Switch`, `Slider`, `Badge`, `Skeleton`, `Button`, `DropdownMenu*` (Task 14).
- Produces:
  - `LightsTab({ device, lights, prefs, actions })`: the offline panel (`TabOffline`, line 4500, "The lights are"), the skeleton (line 4504), the load error with "Try again" (line 4513), notices, the matrix message "2D matrix layouts aren't supported yet." with the "Open WLED Advanced UI" link, `StrandPicker`, `StrandPanel`, and the range list (Task 19). It holds the open slot target with `withState("slotTarget", "setSlotTarget", null)` for Task 20.
  - `StrandPicker`: design lines 4540-4562. Hidden when there is one strand.
  - `StrandPanel`: design lines 4565-4612: name, strand menu with Rename strand and Separate, switch, brightness slider 1-255, `SharedBanner`, strip, Add range with its reason, "Splits <range> in two", "Segments used N of M", and the flash line in an `aria-live` region.
    - The brightness slider calls `editStrand` with `bri` on every `input` and on `change` (spec §7.2 "Live output"). The Task 16 queue keeps one request in flight and sends the newest value last.
    - `SharedBanner` buttons call `resolveShared` with `split` and `combine`.
  - `Strip`: design lines 4615-4655.
    - Cells: `min(len, 120)`, `gap-px` from `sm:` up.
    - Each boundary between touching ranges is a `role="slider"` with `aria-valuemin` = `a.start + minLen(a)`, `aria-valuemax` = `b.start + b.len − minLen(b)`, `aria-valuenow`, `aria-valuetext="LED <n>"`, label "Boundary between <a> and <b>".
    - Pointer: `onPointerDown` calls `setPointerCapture` when the element has it. `onPointerMove` on the same element computes the LED from `getBoundingClientRect`. `onPointerUp` and `onPointerCancel` end the drag.
    - Keys: arrows ±1, Shift ±10, Home, End. Each move calls `editStrand` with `moveBoundary`.
    - A shared strand's handles are `aria-disabled` and `tabIndex={-1}`.
  - Add range: `splitRange`, then `toast("info", "Added <name>", "Drag the new boundary on the strip to move it.")` and focus the new handle. On a shared strand it is a `Button` with `reason={LOCKED}`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - A handle at LED 60 between "Patio" (Every 2 group 2, 0-60) and "Kitchen" (60-120): `ArrowRight` → `editStrand` with Patio len 61; `Shift+ArrowRight` → 70; `Home` → `aria-valuemin` 3; `ArrowLeft` at the minimum → no call.
  - A pointer drag from x = 50% to 75% over a 150-LED strip → the last `editStrand` sets the boundary at LED 112 or 113.
  - `pointercancel` during a drag → the drag ends: a later `pointermove` calls no `editStrand`.
  - A single-strand device → no "Strands" group.
  - A shared strand → the banner "Strand 1 and Strand 2 share one segment." with "Split by strand" and "Combine strands"; "Split by strand" dispatches `resolveShared` with `split`. Add range has `aria-disabled="true"` and the accessible description "Choose Split by strand or Combine strands first."
  - Three `input` events on the brightness slider (100, 120, 140) → `editStrand` called with `bri` 100, 120 and 140, in order.
  - "Segments used 7 of 32" shows the view's numbers.
- [ ] **Step 2: Run** `pnpm test src/components/lights/strip.test.tsx src/components/lights/lightsTab.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app against the demo devices. On Backyard (two strands): screenshot at 375, 768 and 1440 px. Check: no overflow; the strip colors match the ranges; a handle drag moves the boundary and the fake's segments change (`curl -s 127.0.0.1:18081/json/state`); Tab reaches each handle and the arrows move it; the brightness changes on the lights during the drag; the flash pulse is `motion-safe:` only.
- [ ] **Step 5: Commit.** `feat(web): add the lights tab strand panel and LED strip`

### Task 19: Range cards, pattern controls and lights dialogs

review: no

**Files:**
- Create: `src/components/lights/rangeCard.tsx`, `patternControls.tsx`, `slotRows.tsx`, `lightsDialogs.tsx`, with stories
- Modify: `src/components/lights/lightsTab.tsx` (render the range list and the dialogs), `src/screens/deviceScreen.tsx` (pass `outputs` and the dialog actions)
- Test: `src/components/lights/rangeCard.test.tsx`, `src/components/lights/lightsDialogs.test.tsx`

**Interfaces:**
- Consumes: `editStrand`, `flashLed`, `setStrandGroups`, `setStrandName`, `loadOutputs`, `selectStrand` (Task 16); `mergeInto`, `withPattern`, `kindReason`, `stepReasons`, `cutRanges`, `adjacentPairs`, `patternText`, `rangeSummary`, `rangeLabel`, `needMsg`, `freeSegs`, `slotBackground`, `slotText`, `LOCKED` (Task 15); `toast`, `Button`, `Stepper`, `Dialog*`, `DropdownMenu*`, `Skeleton` (Task 14); `LightsTab` (Task 18).
- Produces:
  - `RangeCard({ ..., onOpenSlot(s: number): void, paintEditor?: ReactNode })`: design lines 4658-4704.
    - Collapsed summary, swatches, Flash start and Flash end (with the reason "Flashing needs one free segment. Remove a range first.").
    - The range menu: Rename, Merge with next, Delete, each with its reason. On a shared strand, Rename has the reason `LOCKED` (the server drops range names on a shared strand).
    - The first card is open by default.
    - Delete runs `mergeInto` and `toast("info", "Deleted <name>", "Its LEDs are part of <into> now.")`. After Delete or Merge, focus moves to the header button of the range that took the LEDs.
    - `onOpenSlot` is called by a slot row; Task 20 fills it. `paintEditor` renders in place of the slot rows for an Individual range; Task 21 fills it.
  - `PatternControls`: design lines 4706-4760, with `kindReason` and `stepReasons`.
  - `SlotRows({ ..., onOpenSlot })`: design lines 4762-4776. A row calls `onOpenSlot(s)`.
  - `LightsDialogs({ ..., outputs, outputsStatus, outputsError, onRetryOutputs })`, each a `Dialog`:
    - `rename` (range or strand). Range errors: "A range needs a name.", "Use 64 characters or fewer.", "Another range on this strand has that name." Strand help text: line 4961. A strand rename calls `setStrandName`; a rejection shows its message under the field with `role="alert"`, and the dialog stays open.
    - `combine` (lines 5876-5897). The pairs are a `role="radiogroup"` with a roving `tabIndex`: only the checked radio has `tabIndex` 0, and the arrow keys move the check and the focus. Combine calls `setStrandGroups` with the other existing groups plus the new key. On success, it selects the new key and toasts "Combined <a> and <b>".
    - `separate` (lines 5898-5917). Opening it dispatches `loadOutputs(id)`. The cut list uses `cutRanges(outputs, strand)`. While `outputsStatus` is `loading`, the dialog shows a `Skeleton` and Separate is disabled. On `error`, it shows `outputsError.message` with `role="alert"` and a "Try again" button that calls `onRetryOutputs`, and Separate is disabled. On success it toasts "Strands separated".
    - A dialog opened from a menu returns focus to that menu's ⋯ button when it closes.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - Every 16 group 1: the N plus button has the accessible description "A range can have at most 16 slots."
  - Every 2 group 2 over 4 LEDs: the N plus button has the accessible description "This range is too short for another slot." (Review Focus 1).
  - "Every N" on an All range with `free` 0 → the button is `aria-disabled`, with the accessible description `needMsg(1, 0)`.
  - Delete "Kitchen" → `editStrand` merges it into the previous range; a toast "Deleted Kitchen"; focus is on the previous range's header button.
  - On a shared strand, the Rename menu item has the accessible description "Choose Split by strand or Combine strands first." and does not open the dialog.
  - Rename a range to the name of another range → "Another range on this strand has that name." and no `editStrand`. Close the dialog → focus is on the range's ⋯ button.
  - Rename a strand and `setStrandName` rejects with "Names need 1 to 64 characters." → that text shows in the dialog with `role="alert"`.
  - The combine dialog on a device with three touching strands → two radios; `ArrowDown` checks and focuses the second; only it has `tabIndex` 0. Combine → `PUT /api/devices/<id>/strand-groups` with the new key; a toast "Combined <a> and <b>".
  - The separate dialog with "Middle" over 100-200 of `o0+o1` → while `getConfig` is pending, a skeleton and a disabled Separate; then "This range crosses the join and will be cut in two:" and "Middle". With `getConfig` rejecting → the error message and "Try again".
- [ ] **Step 2: Run** `pnpm test src/components/lights/rangeCard.test.tsx src/components/lights/lightsDialogs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app: screenshot an open Every N card at 375, 768 and 1440 px; a disabled stepper shows its reason on hover, on keyboard focus and on tap, and a screen reader reads it (`aria-describedby`); the range menu opens with Enter and moves with the arrow keys; each dialog traps focus and returns it to its trigger.
- [ ] **Step 5: Commit.** `feat(web): add range cards, pattern controls and lights dialogs`

### Task 20: Slot editor sheet

review: no

**Files:**
- Create: `src/components/lights/slotSheet.tsx`, with a story
- Modify: `src/components/lights/lightsTab.tsx` (pass `onOpenSlot` to `RangeCard` and render `SlotSheet` with `slotTarget`)
- Test: `src/components/lights/slotSheet.test.tsx`

**Interfaces:**
- Consumes: `editStrand`, `loadFxLists` (Task 16); `pushRecentColor`, `toggleFavoriteEffect` (Task 16, preferences slice); `colorName`, `COLOR_SLOT_LABELS`, `usesPalette`, `slotColorAt`, `slotText` (Task 15); `toast`, `Sheet*`, `Slider`, `Button` (Task 14); `RangeCard` `onOpenSlot` (Task 19); `LightsTab` `slotTarget` (Task 18).
- Produces: `SlotSheet({ target: { key: string; r: number; s: number } | null, effects, palettes, fxStatus, fxError, onRetryFx, ... })`, design lines 5093-5375:
  - Color: the color slot buttons when the effect has more than one color (labels "Main", "Background", "Accent"); "<effect> takes its colors from the palette." when it has none; the hue and saturation area; the brightness slider 0-100; the hex field with the error "Enter 6 hex digits, like FF8800."; Recent colors (hidden when the list is empty).
  - The hue and saturation area is `role="slider"`. Keys: arrows ±5° and ±5 %, Shift ±30° and ±20 %; each key press calls `editStrand`. Pointer: a drag moves the marker; `editStrand` runs once, on `pointerup` or `pointercancel` (design lines 5377-5480).
  - Effect: search, "Favorites" (stars, by name), "All effects" (Solid first, then by name, `RSVD` removed), "No effects match “<q>”.", then one slider per non-empty `sliders` label (`c3` max 31, others 255) and one checkbox per non-empty `checks` label.
  - Palette: only when `Effect.pal`; search; a gradient swatch from `stops` (empty `stops` → the slot's color); "No palettes match “<q>”."
  - Lists not loaded: while `fxStatus` is `loading`, the Effect and Palette parts show a `Skeleton`. On `error`, they show `fxError.message` with `role="alert"` and a "Try again" button that calls `onRetryFx` (`loadFxLists`). The Color part still works.
  - Footer: "Apply to all slots" (more than one slot; toast "<fx> is on N other slot(s) too", "Their colors stay as they were.") and "Done".
  - Each change calls `editStrand` with the changed slot at once; sliders on release. A color commit calls `pushRecentColor`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - Effects `Solid`, `Blink`, `RSVD`, `Breathe` → list order Solid, Blink, Breathe; no RSVD.
  - Pick Blink (colors Fx, Bg) → the color slot group shows "Main" and "Background".
  - Effect Colorloop (`pal: true`, no colors) → "Colorloop takes its colors from the palette." and the Palette section.
  - Type `GG0000` in Hex → "Enter 6 hex digits, like FF8800." and no `editStrand`. Type `00FF00` → `editStrand` with `col[0]` `[0,255,0]`.
  - The `c3` slider has `max="31"`.
  - On the hue area, `ArrowRight` → `editStrand` with a new color.
  - Hue area drag: `pointerdown`, three `pointermove` → no `editStrand`; `pointerup` → one `editStrand` with the last color. The same drag ended by `pointercancel` → one `editStrand`.
  - `fxStatus: "error"` with message "m" → "m" with `role="alert"` and "Try again"; a click calls `onRetryFx`; the hex field still calls `editStrand`.
  - "Apply to all slots" on Every 3 → one `editStrand` that copies `fx`, `pal` and the parameters to the other two slots, not `col`.
- [ ] **Step 2: Run** `pnpm test src/components/lights/slotSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app: screenshot an open slot at 375 px (bottom sheet), 768 px (bottom sheet) and 1440 px (side sheet); Escape closes it and focus returns to the slot row; the effect list scrolls inside the sheet; the lights change at once on the fake.
- [ ] **Step 5: Commit.** `feat(web): add the slot editor sheet`

### Task 21: Individual paint editor

review: no

**Files:**
- Create: `src/components/lights/paintEditor.tsx`, with a story
- Modify: `src/components/lights/lightsTab.tsx` (pass `PaintEditor` as `RangeCard`'s `paintEditor` for Individual ranges)
- Test: `src/components/lights/paintEditor.test.tsx`

**Interfaces:**
- Consumes: `beginPaint`, `paintCells`, `endPaint`, `editStrand` (Task 16); `pushRecentColor` (Task 16, preferences slice); `rangeColors` (Task 15); `Button` (Task 14); `RangeCard` `paintEditor` (Task 19).
- Produces: `PaintEditor`, design lines 4778-4846 and 5380-5405:
  - The brush (`input type="color"` and up to 6 recent colors), "Fill range", "Clear".
  - The paint strip: `role="slider"`, cells `min(len, 96)`, a cursor cell, and the help text "Tap or drag to paint. The lights change when you let go. With a keyboard: arrow keys move, Space paints."
  - A pointer drag calls `beginPaint` once, `paintCells` per move (it fills the cells that a fast drag skips), and `endPaint` on `pointerup` or `pointercancel`.
  - Space or Enter paints the cursor cell as one begin, paint, end.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`):
  - A drag over cells 0-4 with brush `#FF8800` → no `patchStrand` before release; one after release, whose paint has `#FF8800` at LEDs 0-4.
  - The same drag ended by `pointercancel` → one `patchStrand`, and the strand is not on `hold` afterward.
  - `ArrowRight` twice, then Space → LED 2 painted; one `patchStrand`.
  - "Fill range" → every paint item is the brush color. "Clear" → every item is `#000000`.
- [ ] **Step 2: Run** `pnpm test src/components/lights/paintEditor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/components/lights`. Run the app on Front Roof: paint with a drag and screenshot at 375, 768 and 1440 px; the fake segment "Peak paint" has the pixels; reload the tab and the paint is still there.
- [ ] **Step 5: Commit.** `feat(web): add the individual paint editor`

### Task 22: Presets tab and dialogs

review: yes (destructive delete with confirmation; apply changes the lights)

**Files:**
- Create: `src/store/slices/presets.ts`, `src/components/presets/presetsTab.tsx`, `src/components/presets/presetsDialogs.tsx`, with stories
- Modify: `src/store/index.ts`, `src/screens/deviceScreen.tsx` (render `PresetsTab` in the Presets panel, pass its props, and dispatch `loadPresets` when the Presets tab opens and when the user switches back to it)
- Test: `src/store/slices/presets.test.ts`, `src/components/presets/presetsTab.test.tsx`

**Interfaces:**
- Consumes: `api.getScenes`, `api.createScene`, `api.renameScene`, `api.deleteScene`, `api.applyScene`, `api.getLooks`, `api.createLook`, `api.renameLook`, `api.deleteLook`, `api.applyLook` (Task 13); `adoptView`, `loadLights`, `selectStrand` (Task 16); `createApiThunk` and its rejected-payload type `ThunkError` (exported from `src/store/createApiThunk.ts`; prior Task 11); `toast`, `Button`, `Badge`, `Skeleton`, `Dialog*`, `DropdownMenu*` (Task 14); `patternText`, `rangeLabel`, `plural` (Task 15).
- Produces:
  - `presetsSlice`: `{ byDevice: Record<string, { scenes: Scene[] | null; looks: LookRecord[] | null; status: "idle" | "loading" | "ok" | "error"; error: ThunkError | null; applying: string | null }> }`; thunks `loadPresets(id)` (lights, scenes and looks), `createScene`, `renameScene`, `deleteScene`, `applyScene`, `createLook`, `renameLook`, `deleteLook`, `applyLook`.
  - Apply results (design lines 5630-5640 and 5745-5770):
    - A scene apply adopts `view` into the lights slice, selects the scene's strand, and toasts `"Applied <name>"` with the warnings joined by `" "` as the description.
    - A look apply adopts `view`, closes the dialog, and toasts `"Applied <name>"` with the description `` `Changed ${plural(n, "range")}. ${warnings.join(" ")}`.trim() `` (n = the ranges of the targets).
  - Errors (design lines 5628-5845):
    - A scene apply error toasts "Couldn't change the lights" with the message, then dispatches `loadLights(id, { quiet: true })`.
    - A look apply error shows the message in the apply-look dialog with `role="alert"`, keeps the dialog open, and dispatches `loadLights(id, { quiet: true })`.
    - A save or rename error shows the message under the name field with `role="alert"`.
    - A delete error toasts `"Couldn't delete <name>"` with the message.
  - `PresetsTab`: design lines 5556-5626: offline, skeleton, error, both lists, both empty-state texts, the "LED count changed" badge, and "Strand not found" with Apply disabled with its reason. When the lights view has no strands (`matrix`, or `strands: []`), "Save scene" and "Save look" are `Button`s with `reason` "There are no strands on this device."
  - `PresetsDialogs`: `saveScene`, `saveLook`, `applyLook`, `sceneWarn`, `deletePreset`, `rename` (design lines 5918-6029 and the actions in lines 5628-5845).
    - The look range select disables Individual ranges with " (painted LEDs can't be a look)".
    - The apply-look tree has strand checkboxes with `aria-checked="mixed"`. A shared strand is disabled with its text.
    - Delete is a confirm dialog: title "Delete <name>?", text "The <kind> is removed from Strand. The lights don't change.", a `destructive` Delete button. Focus starts on Cancel.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`, `fetch` stubbed):
  - Open `?tab=presets` → one `GET /scenes` and one `GET /looks`. Switch to Lights and back → a second `GET /scenes`.
  - No scenes and no looks → "No scenes yet. Save the current strand setup to come back to it." and "No looks yet. Save a range's colors and effects to use them on any strand."
  - A matrix view → "Save scene" and "Save look" are `aria-disabled` with the accessible description "There are no strands on this device."
  - Save scene with an empty name → "Give the scene a name." and no request. With "Party" → `POST /api/devices/<id>/scenes` with `{"name":"Party","strandKey":"o0"}` (the selected strand), then a toast "Saved Party".
  - A `422 invalid_name` on save → the dialog shows "Names need 1 to 64 characters." with `role="alert"`.
  - Apply a scene, reply with `warnings: ["W1", "W2"]` → toast "Applied <name>", description "W1 W2". A `504` reply → toast "Couldn't change the lights" with the message, and a second `GET /lights`.
  - A scene with `ledCount` 150 and a strand of 100 → Apply opens "Apply <name>?" with "Strand fits its ranges to the new length: ranges past the end are cut."; "Apply anyway" sends the apply.
  - A scene whose strand is missing → "Strand not found" and Apply has `aria-disabled="true"` with its reason as the accessible description.
  - Apply to… with one of two ranges of o0 checked → the strand checkbox is `aria-checked="mixed"`; the button says "Apply to 1 range"; the body is `{"targets":[{"strandKey":"o0","range":"Patio"}]}`; on success the toast is "Applied <name>" with "Changed 1 range." A `404` reply → its message in the dialog with `role="alert"`; the dialog stays open; a second `GET /lights`.
  - Rename a look with a `422 invalid_name` reply → the message under the field; the dialog stays open.
  - Delete → the confirm dialog; Cancel sends nothing; Delete sends `DELETE` and toasts "Deleted <name>". A `504` reply → toast "Couldn't delete <name>".
- [ ] **Step 2: Run** `pnpm test src/store/slices/presets.test.ts src/components/presets`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Gate: `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/store src/components/presets`. Run the app: screenshot the Presets tab empty and with two scenes and two looks at 375, 768 and 1440 px; every dialog traps focus and returns it; the destructive button is reachable with Tab; Escape cancels.
- [ ] **Step 5: Commit.** `feat(web): add the presets tab with scenes and looks`

### Task 23: End-to-end seam test

review: no

**Files:**
- Modify: `src/screens/deviceScreen.test.tsx` (add a `describe("seam")` block)

**Interfaces:**
- Consumes: `makeTestApp` (prior Task 4, Task 7); `startFakeWled`, `seeds` (prior Task 4, Task 2); `DeviceScreen` (Task 17); `makeStore`, `reducers` (prior Task 1, Tasks 16, 17, 22).
- Produces: one test block that drives the real UI against the real server and a fake device. `fetch` is replaced for the block: a URL that starts with `/` goes to `t.inject({ method, url, headers, payload })` and returns `new Response(body, { status, headers })` (`null` body for 204); any other URL goes to the real `fetch`, so the server still reaches the fake.

- [ ] **Step 1: Write the test** with Backyard (`startupDelayMs` 50), rendered at `/devices/<id>` in a `MemoryRouter`:
  - The shared banner shows; click "Split by strand" → the fake lists segments 0-150 and 150-300.
  - Click "Add range" → the fake lists a segment named "Range 2" inside 0-150, and no segment of 150-300 changed.
  - Open "Range 1", click "Every N" → the fake lists "Range 1 1/2" and "Range 1 2/2" with `grp` 1, `spc` 1.
  - Wait 200 ms → the fake got one `psave` with `bootps` 250, and `GET /presets.json` has key `"250"`.
  - Presets tab: save scene "Two" for Strand 1; Lights tab: Merge "Range 1" with next; Presets tab: Apply "Two" → the fake's o0 segments are again "Range 1 1/2", "Range 1 2/2" and "Range 2".
  - Change "Range 2" to Individual and click "Fill range" → the fake segment "Range 2 paint" has `frz: true` and every pixel is the brush color.
  - `fake.setMode("timeout")`, then press `ArrowRight` on a range handle → after the reply the handle is back at its old `aria-valuenow`, and the toast "Couldn't change the lights" shows.
- [ ] **Step 2: Run** `pnpm test src/screens/deviceScreen.test.tsx`. Expected: PASS. A failure here is a defect in an earlier task; fix it there.
- [ ] **Step 3: Drive the real app.** Use "Running the app for screenshots" and the `verify` skill. On Backyard: split, add a range, set Every N, open a slot and pick an effect, paint, save a scene, apply it, apply a look. After each action, `curl -s 127.0.0.1:18081/json/state` shows the change. Restart the server and reload: the tab shows the same layout.
- [ ] **Step 4: Gate.** `pnpm exec tsc --noEmit && pnpm lint && pnpm test src/screens`. Expected: PASS.
- [ ] **Step 5: Commit.** `test(web): drive the lights and presets tabs end to end`

## Review Focus

These five conditions are the most likely to hurt a user, and the spec's examples do not test them. The owning task has a test for each.

1. **Every N on a range too short for its slots** (`(N − 1) · G ≥ len`), from the steppers, a boundary drag, a scene fit or a look. Expected: the server rejects it with `422 invalid_layout`; the steppers and handles stop at the limit with a reason; a scene turns the range into All; a look skips it with a warning (Tasks 5, 6, 9, 18, 19).
2. **A long or multi-byte range name** whose tagged segment name passes 32 bytes. Expected: the name is cut on a UTF-8 boundary, the tag stays whole, and the layout still reads back (Tasks 4, 5).
3. **A startup write that fires while a flash is lit, or before `presets.json` has the newest paint.** Expected: the preset has no flash segment and has the last paint that Strand sent (Task 7).
4. **Fast edits on one strand while a request is in flight, then a failure.** Expected: one request at a time, the newest value sent last, a rollback to the view before the edits, an error toast, and other strands' in-flight edits kept (Task 16).
5. **The header switch turns a painted device on.** Expected: the paint goes in the same `POST` as `on: true`, so the painted range does not fall back to its color (Task 8).

## Review dispositions

| # | Task/Step | Defect (short) | Dimension | Severity | Disposition | Notes |
|---|---|---|---|---|---|---|
| S1 | Task 10 / Decision 14 | `PUT /api/preferences/:key` can write `strandNames.*` and skip the name checks | Security | HIGH | Fix | Preferences endpoint refuses the prefix with 400; test in `preferences.test.ts`; Decision 14 updated. |
| S2 | Task 10 | No body validation for strand-groups and strand-names | Security | MEDIUM | Fix | Schemas plus handler limits; 400 tests. An empty trimmed name still resets the name (design line 4961); a non-empty name must be 1-64 characters. |
| S3 | Tasks 11, 12 | Name rule and look-apply `targets` not validated everywhere | Security | MEDIUM | Fix | Name rule on POST and both PATCH; `targets` schema at every level; tests. |
| S4 | Task 3 | `palxStops` passes device values into colors unchecked | Security | MEDIUM | Fix | Integers 0-255 only, else the stop is dropped; hostile-value test. |
| S5 | Tasks 4, 7 | Device read-back used without shape checks | Security | MEDIUM | Fix | `parseState` in Task 4; `decodePaint` clamps and skips; info, cfg and preset checks in `readDeviceLights`; malformed-data tests. |
| S6 | Task 8 / Decision 13 | `GET lights` writes to the device and the database | Security | MEDIUM | Fix | GET is read-only; `clearLeftovers` runs on the next write. New Decision 13 (deviation from spec §6.6, §9); Task 1 writes it into the spec. |
| S7 | Tasks 5, 10-12 | Range validation skipped for scene, look and separate writes | Security | MEDIUM | Fix | `writeStrand` validates first; `sharedNames` option for the separate cut. |
| S8 | Task 19 | Range Delete/Merge without confirmation | Security | LOW | Reject | Prototype has none; the action is reversible; owner wants live edits. |
| S9 | Task 7 | Flash `end` failure log content not stated | Security | LOW | Fix | Device ID and error message only. |
| ST1 | Task 19 | Separate dialog calls `api.getConfig` from a child | Standards | HIGH | Fix | `loadOutputs` thunk in Task 16; dialog gets `outputs` by props. |
| ST2 | Task 14 | Primitives written by hand, not with the shadcn CLI | Standards | MEDIUM | Fix | CLI for switch, sheet, dropdown-menu, badge, skeleton; Stepper, Slider, Toaster by hand, with reasons. |
| ST3 | Task 7 | CLAUDE.md "Stack" still says stateless in memory | Standards | MEDIUM | Fix | Task 7 Step 4 updates CLAUDE.md with CONVENTIONS.md §5. |
| ST4 | Several | Duplicate tests below the outermost surface | Standards | MEDIUM | Fix | Applied with Q6. |
| ST5 | Task 14 | Tests of native input and Radix behavior | Standards | HIGH | Fix | Slider and Switch tests deleted; reason logic tests kept. |
| ST6 | Global Constraints | Per-test failure comment not stated as a rule | Standards | LOW | Fix | Cites CONVENTIONS.md §10; the implementer writes it. |
| ST7 | Several | Test file names do not match the file they cover | Standards | MEDIUM | Fix | `layout.ts` split into `layoutRead.ts` and `layoutWrite.ts`; route tests named `lights.test.ts` and `presets.test.ts`; sim tests in `test/` with `vitest.config.ts` include; primitives tests per file; seam test merged into `deviceScreen.test.tsx`. |
| ST8 | Task 1 | New error texts not in `messages` | Standards | MEDIUM | Fix | Task 1 lists every new `messages` function. |
| ST9 | Task 7 | Runtime logger not stated | Standards | LOW | Fix | `app.log` passed as `RuntimeLog`; named fields only. |
| ST10 | Several | Wrong Consumes provenance | Standards | LOW | Fix | Effect/Palette Task 3; WledConfig prior Task 2; WledInfo, LedOutput existing. |
| ST11 | Plan header | Section order differs from the house structure | Standards | LOW | Fix | Global Constraints after Architecture; Pipeline State and Plan decisions after it. |
| ST12 | Global Constraints | Rules copied instead of cited | Standards | LOW | Fix | Cites doc and section; keeps the pinned values and the quoted departures. |
| ST13 | Verified external API | Firmware facts not cited to an in-repo reference | Standards | LOW | Reject | Verified against `~/Code/WLED` with file:line; no in-repo reference exists. |
| ST14 | Task 1 | Spec not updated with the plan's decisions | Standards | MEDIUM | Fix | Task 1 Step 4 edits the spec. |
| ST15 | Decisions 2, 4, 5; Tasks 4, 5 | Long sentences; mixed "route"/"endpoint" | Standards | LOW | Fix | Split into lists; "endpoint" used for HTTP operations. |
| Q1 | Task 8 | Test depends on Task 9's endpoint | Quality | MEDIUM | Fix | Layout set with `fake.applyState`. |
| Q2 | Tasks 17, 18, 22 | DeviceScreen renders components that do not exist yet | Quality | MEDIUM | Fix | Task 17 renders empty panels; Tasks 18 and 22 fill them. |
| Q3 | Task 13 | Consumes a private `request<T>` | Quality | LOW | Fix | Functions added in the same module; stated in Interfaces. |
| Q4 | Pre-merge checks | Real-device checks outside the build | Quality | MEDIUM | Fix | Section deleted; `bootSim` def test (Task 7) and 300-LED body-size test with the fake's 10240-byte limit (Task 9). |
| Q5 | Task 7 | Flash `end` rejection can be unhandled | Quality | MEDIUM | Fix | Caught and logged; test. |
| Q6 | Tasks 1, 4, 5, 6, 15 | Lower-level duplicate tests | Quality | MEDIUM | Fix | Listed tests deleted; the outer tests cover them. Task 15 also drops the 16-slot `stepReasons` test that Task 19 covers. |
| Q7 | Task 4 | `strandsFromConfig` typed with `WledConfigFull` | Quality | MEDIUM | Fix | Takes `WledConfig`. |
| Q8 | Task 1 | `WledInfo.leds.matrix` missing | Quality | MEDIUM | Fix | Added in Produces. |
| Q9 | Tasks 7, 18-20 | Consumes name tasks, not symbols | Quality | LOW | Fix | Exact symbols listed and checked against producers. |
| Q10 | Task 19 | Same as ST1 | Quality | HIGH | Fix | See ST1. |
| Q11 | Tasks 19-21 | No seam for the slot sheet and paint editor | Quality | MEDIUM | Fix | `onOpenSlot` and `paintEditor` props; Tasks 20 and 21 fill them in `lightsTab.tsx`. |
| Q12 | Task 16 | New `ApiErrorPayload` duplicates `ApiError` | Quality | LOW | Fix | Uses the rejected-payload type `ThunkError` of `createApiThunk.ts` (prior Task 11). |
| Q13 | Task 7 | `writeLayout` partial-failure behavior not stated | Quality | HIGH | Fix | `afterWrite` after any sent request; missing paint segment → 409; browser does a quiet re-read. Tests in Task 9 (outermost surface). |
| Q14 | Task 12 | Look apply partial failure not stated | Quality | MEDIUM | Fix | Earlier strands stay written; error answered; quiet re-read; test. |
| Q15 | Task 22 | No UI result for apply, rename and delete errors | Quality | MEDIUM | Fix | With F2. |
| Q16 | Task 7 | Missing runtime tests | Quality | MEDIUM | Fix | Save in flight and paint memory in Task 7; paint chunks in Task 9. |
| Q17 | Task 8 | Paint from preset 250 not tested | Quality | MEDIUM | Fix | GET lights test with an empty paint memory. |
| Q18 | Task 10 | Missing group tests | Quality | MEDIUM | Fix | Output in two keys, paint cut by position, write before the groups change. |
| Q19 | Task 11 | Missing scene tests | Quality | MEDIUM | Fix | Content size limit; apply on a shared strand. |
| Q20 | Task 12 | Missing look tests | Quality | MEDIUM | Fix | Rename, delete, name limits, deleted look, missing range. |
| Q21 | Task 17 | Missing power rollback and reboot tests | Quality | MEDIUM | Fix | Added. |
| Q22 | Task 8 | `setDevicePower` needs `ServerDeps`, but `controlRoutes` takes `AppDeps` | Quality | MEDIUM | Fix | Not as written: `controlRoutes` cannot get the runtime from `AppDeps`. `buildApp` builds one `ServerDeps` and passes it to every plugin; `controlRoutes` and `devicesRoutes` type their options as `ServerDeps` (a superset, so callers are unchanged). |
| Q23 | Task 11 | Duplicate `segmentsNeeded` check | Quality | LOW | Fix | Removed; `writeStrand` checks the budget. |
| Q24 | Tasks 5, 6, 9 | Missing Consumes symbols | Quality | LOW | Fix | Added. |
| Q25 | Task 16 | Flash 3000 ms clear not tested | Quality | LOW | Fix | Fake-timer test. |
| Q26 | Task 7 | Timers survive a device delete | Quality | MEDIUM | Fix | `forget(deviceId)` on `DELETE /api/devices/:id`; test in Task 10. |
| F1 | Task 22 | Apply warnings not shown | Frontend and seam | MEDIUM | Fix | Success toasts per prototype; tests. |
| F2 | Task 22 | Error rendering differs from the prototype | Frontend and seam | MEDIUM | Fix | Dialog alert, toasts, field errors; tests. |
| F3 | Tasks 16, 18, 19 | Combine, split and rename results not stated | Frontend and seam | MEDIUM | Fix | Toasts, selection and error paths; tests. |
| F4 | Task 17 | Load triggers not stated | Frontend and seam | MEDIUM | Fix | Open, switch back, Retry; Presets on open; tests. |
| F5 | Tasks 16, 20 | No error state for the effect and palette lists | Frontend and seam | MEDIUM | Fix | `fxStatus`, message and Try again in the sheet; model helpers accept `null` lists. |
| F6 | Task 8 | `PATCH state` response contract | Frontend and seam | MEDIUM | Fix | `setDevicePower` returns the full state; `v: true` kept; prior assertions unchanged. |
| F7 | Task 4 | Read-back range names can repeat | Frontend and seam | MEDIUM | Fix | Suffix rule (algorithm step 11); test in Task 5 with `validateRanges`. |
| F8 | Tasks 11, 12 | DELETE answers 404 when already gone | Frontend and seam | LOW | Fix | 204, idempotent; Decision 21. |
| F9 | Task 1 | Contract comment out of date | Frontend and seam | LOW | Fix | Task 1 Step 5. |
| F10 | Tasks 14, 18, 19, 22 | Disabled reasons only in `title` | Frontend and seam | HIGH | Fix | `Button` and menu item `reason`: `aria-describedby`, tooltip on focus and tap; global UI check. |
| F11 | Tasks 18, 21 | `pointercancel` not handled | Frontend and seam | MEDIUM | Fix | Ends the drag; tests. |
| F12 | Task 18 | Brightness sends only on release | Frontend and seam | MEDIUM | Fix | Sends on `input` and `change` through the queue; test. |
| F13 | Tasks 19-21 | Screenshot widths incomplete | Frontend and seam | LOW | Fix | 375, 768, 1440 px. |
| F14 | Tasks 17, 19 | Tab and radio keyboard semantics | Frontend and seam | MEDIUM | Fix | Tablist with arrows; roving radiogroup; tests. |
| F15 | Task 19 | Focus after Delete/Merge and menu dialogs | Frontend and seam | MEDIUM | Fix | Neighbour header button; ⋯ button; tests. |
| F16 | Task 19 | Separate dialog has no loading or error state | Frontend and seam | MEDIUM | Fix | With ST1. |
| F17 | Task 22 | Save enabled with no strands | Frontend and seam | LOW | Fix | `reason` "There are no strands on this device."; test. |
| F18 | Task 19 | Rename range on a shared strand | Frontend and seam | LOW | Fix | Disabled with `LOCKED`; test. |
| F19 | Task 16 | Client budget differs from the server on `normalize` strands | Frontend and seam | MEDIUM | Fix | Client skips the check on `normalize` strands and uses the server's 422; test. |
| F20 | Task 20 | Hue/saturation drag sends on every move | Frontend and seam | MEDIUM | Fix | Commit on `pointerup`/`pointercancel`; test. |
| R1 | Task 7 | Startup save loses paint of strands not edited since the last save | Quality (re-review) | HIGH | Fix | The timer reads `/presets.json` and merges `paintFor` over preset 250's decoded paint; test with two saves. |
| R2 | Task 10 | "Write before the groups change" test fails the reads too | Quality (re-review) | MEDIUM | Fix | `fake.failNext("timeout", { method: "POST", path: "/json/state" })`; only the write fails. |
| R3 | Task 10 | Separate cut can leave an Every piece too short | Quality (re-review) | MEDIUM | Fix | The piece becomes All with its first slot, as `fitRanges` does; test. |
| R4 | Tasks 2, 7 | `bootSim` cannot make two auto segments | Quality (re-review) | MEDIUM | Fix | `bootSim` takes `opts.outputs`; the Task 7 Boot test uses it. |
| R5 | Tasks 16, 22 | Rejected-payload type named `ApiError`, with a hedge | Quality (re-review) | LOW | Fix | `ThunkError`, exported from `src/store/createApiThunk.ts`; hedge removed. |
| R6 | Task 9 | Request count in "Write fails part-way" | Quality (re-review) | LOW | Fix | "three or more `seg` requests". |
| R7 | Tasks 8-12 | Consumes leave out fake and `ServerDeps` symbols | Quality (re-review) | LOW | Fix | `FakeWled.applyState`, `FakeWled.afterPost`, `FakeOpts.maxBody`, `FakeWled.cfg` (Task 2) and `ServerDeps` (Task 7) added. |
