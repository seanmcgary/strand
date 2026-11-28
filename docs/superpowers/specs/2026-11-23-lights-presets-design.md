# Lights and Presets design

Date: 2026-11-23
Status: approved 2026-11-23

## 1. Intent

The design spec (`docs/design/strand-wled-spec.html`) shows the device page with four tabs: Control, Segments, Presets and Settings. Control, Segments and Presets are placeholders ("Designed in the next round"). This document designs them.

The owner thinks of a WLED controller as a set of physical strands, not as a list of WLED segments. A user customizes one strand at a time. The stock WLED UI shows segments, which are an implementation detail. Strand shows strands, ranges and patterns, and writes WLED segments to make them.

Strand is an abstraction layer over WLED. The browser works only with strands, ranges, patterns, slots, scenes and looks. It never builds or sends WLED JSON. The server alone translates between that model and WLED segments.

The owner also wants presets that WLED presets cannot give: a saved configuration for specific strands, and a generic look that fits any strand. These are app-level presets in Strand's database.

## 2. Decisions the owner made

1. **Strands.** A strand is one LED output of the controller (one entry of `hw.led.ins`: a GPIO and an LED count). A user customizes one strand at a time. A change never spans strands, unless the strands are combined.
2. **Combining strands is explicit.** The user combines two or more strands with a deliberate action. A combined strand is controlled as one strand everywhere. Strand never combines strands on its own.
3. **Ranges.** A strand starts as one range that covers the whole strand. The user can split it into named ranges, for an uneven layout.
4. **Patterns.** Each range has one pattern:
   - **All:** the range is one slot.
   - **Every N:** N slots repeat along the range.
   - **Group size G** (default 1): the number of LEDs in each slot step. With N = 2 and G = 2, the LEDs are `1 1 2 2 1 1 2 2`.
   - **Individual:** the user sets the color of each LED.
5. **Per-strand power and brightness.** Each strand (or combined strand) has its own on/off and brightness.
6. **One Lights tab.** Control and Segments merge into one tab, "Lights". The tabs are Lights, Presets, Settings.
7. **Segments made elsewhere** (option A; revised 2026-11-24: no Custom ranges). Strand maps every device segment to strands, ranges and patterns. A segment that fits no pattern becomes an All range. Strand changes nothing on the device until the user edits (section 6.2, "Reading a layout back").
8. **App-level presets, per controller.** WLED presets are not used. There are two kinds:
   - **Scene:** a saved configuration for one strand or combined strand: its ranges, patterns, slots, paint, power and brightness.
   - **Look:** a generic pattern with its slots (colors, effects, palettes). It has no LED positions, so it fits any length.
9. **Per-LED paint is in v1.** This overrides PRD §29 ("arbitrary per-pixel painting").
10. **The layout survives a reboot through a startup preset** (option A). WLED keeps segments only in RAM. At boot it loads the boot preset, or else makes one default segment (`wled00/wled.cpp:666`, `:690`). Strand keeps one reserved WLED preset on each controller, ID 250, named "Strand: startup", and sets it as the boot preset (section 6.7).
11. **The browser never sends WLED primitives.** All device traffic goes through the server, and the server's Lights API speaks the strand model, not WLED segments (section 9).
12. **Changes made outside Strand do not matter.** The Lights tab does not poll. It reads the device when it opens, and after that shows the result of its own writes. Every change goes to the lights at once; there is no save button.

## 3. Goals, non-goals, anti-goals

### Goals

- PRD §28 acceptance criteria 5-15, with the owner's model above.
- The user never types a segment index or a start/stop number.
- Every layout that Strand writes reads back as the same strands, ranges and patterns.

### Non-goals

- Cross-controller scenes (PRD §3, §29). A scene or a look belongs to one controller.
- WLED presets and playlists as a user feature. The Presets tab does not list them. They stay on the device, and the stock UI still runs them. The one exception is the reserved startup preset (section 6.7), which the user does not see as a preset.
- 2D matrix layouts. On a matrix device the Lights tab shows "2D matrix layouts aren't supported yet." with the "Open WLED Advanced UI" link.
- Live LED preview animation. The strip shows the configured slot colors.
- Running Strand presets from a WLED button, the WLED boot preset, WLED schedules or Home Assistant. Strand presets exist only in Strand.

### Anti-goals

The work fails, even if it runs, if:

- Strand changes a segment on a strand that the user did not edit.
- Strand sends `sel` or `mainseg`. (The firmware changes them on its own when segments are created or deleted: a new segment is selected, `FX.h:594`; deleting the main segment moves `mainseg`, `json.cpp:189-190`. Strand accepts these side effects.)
- A layout that Strand writes does not read back as the layout the user made.
- Strand combines strands without an explicit user action.
- The browser calls a WLED device directly, or builds or sends WLED JSON (segments, `seg.i`, preset commands).

## 4. Changes to documented rules

These rules change. The implementation plan updates each document.

| Document | Rule now | Rule after |
|---|---|---|
| `CLAUDE.md` | "Presets use WLED's native preset functionality. No app-level scene system." | Presets are Strand scenes and looks, stored in Strand's database per controller. WLED presets are not a user feature. Strand writes one reserved WLED preset (ID 250) as the boot preset, to keep the layout across reboots. |
| `CLAUDE.md` | "Lighting state, effects, palettes, segments, and presets live on the WLED device. Don't cache or duplicate them in the database." | Live lighting state, effects, palettes and segments live on the device. Saved scenes and looks, and strand combinations, are in the database. |
| `CLAUDE.md` | The database is `devices` and `preferences`. | Add `scenes`, `looks` and `strand_groups`. |
| `docs/mvp-prd.md` §15, §29 | WLED presets; per-pixel painting deferred. | Scenes and looks; Individual paint is in v1. |
| `docs/superpowers/specs/2026-10-23-app-server-design.md` §8.4 | Preset run, save and delete go through the state endpoint. | Scenes and looks have their own endpoints (section 9). |
| `docs/superpowers/specs/2026-10-23-app-server-design.md` §8.4 | `PATCH /api/devices/:id/state` passes a WLED state object through. | It accepts only `{ on?, bri? }` (the header switch and the dashboard card). All other lighting changes use the Lights API (section 9). |
| `docs/superpowers/specs/2026-10-23-app-server-design.md`, `CLAUDE.md` | The server is stateless in memory. | The server keeps no state that must survive a restart. It may hold short timers: the 3-second flash and the 5-second startup-preset write (sections 6.6, 6.7). A restart loses at most one pending startup write. |
| `CLAUDE.md` | "The browser polls to see state changes made elsewhere." | The browser does not poll lighting state. Changes made outside Strand are not tracked. |

## 5. Approaches considered

1. **Strand model over WLED segments (chosen).** Strand derives strands from the LED outputs, and writes ranges and patterns as WLED segments. It reads them back from segment geometry and names. Layout stays on the device, so the stock UI and Home Assistant see real segments. The startup preset (section 6.7) keeps the layout on the device across reboots, with no Strand server running.
2. **Segments as the user model.** Show WLED segments directly, as the stock UI does, with a better editor. Rejected: the owner wants strands and patterns, and an "Every 3" pattern is three segments that the user would have to keep aligned by hand.
3. **Strand model in the database only.** Store ranges and patterns in Strand's database and push segments to the device. Rejected: the database and the device would disagree after any change made elsewhere, and layout would not survive a Strand reinstall.

## 6. Model

### 6.1 Strands

- `strandsFromConfig(cfg)` returns one strand for each `hw.led.ins` entry, in LED order: `{ key: "o<i>", start, len, pin, type }`. `GET /json/cfg` is not PIN-gated (`wled00/wled_server.cpp:441-457`), so a locked device still shows its strands.
- Strand names: "Strand 1", "Strand 2", in LED order, with the GPIO as a subtitle ("GPIO 16 · 150 LEDs"). The user can rename a strand. The name is a preference (`strandNames.<deviceId>`). This is my call.
- A device with one strand hides the strand picker.
- A **combined strand** joins strands whose LED ranges touch (`a.start + a.len === b.start`). Its key is the member keys joined with `+` (`o0+o1`). Only adjacent strands can combine, because one WLED segment covers one unbroken LED range.
- If the LED outputs change (Settings → LED Hardware) so that a saved combination no longer touches, Strand drops the combination and shows a notice on the Lights tab.

### 6.2 Ranges and patterns as WLED segments

Each range is one or more WLED segments inside its strand. For a range from LED `s` (inclusive) to `e` (exclusive):

| Pattern | Segments | Geometry |
|---|---|---|
| All | 1 | `start s, stop e, grp 1, spc 0` |
| Every N, group G | N | slot k (0-based): `start s + k·G, stop e, grp G, spc (N−1)·G` |
| Individual | 1 | `start s, stop e, grp 1, spc 0, frz true`, colors set with `seg.i` |

The Every N geometry follows the firmware: a segment draws virtual pixel `i` at physical LEDs `start + i·(grp+spc)` to `+grp−1`, and does not draw its spacing LEDs (`wled00/FX_fcn.cpp:1850-1856`). So N overlapping segments each draw one slot.

**Every N limits.** `grp` and `spc` are one byte each (`FX.h:470`). A larger value wraps with no error. So `G ≤ 255` and `(N−1)·G ≤ 255`. Example: N = 16 allows G up to 17; G = 255 allows only N = 2. N is also limited by the free segment budget. The range must also be long enough for every slot to start inside it: `(N − 1)·G < len`. A slot that starts at or past the range end has no LEDs, the firmware makes that segment inactive (`json.cpp:185-191`), and the layout does not read back. The server rejects such a layout with `422 invalid_layout`, the N and G steppers and the boundary handles stop at this limit, and a look skips a range that is too short.

**Segment names.** Strand writes the range name into each segment's `n`, with an ASCII tag for Every N and for Individual:

- All: `Patio`
- Every N: `Patio 1/3`, `Patio 2/3`, `Patio 3/3`
- Individual: `Patio paint`

Every range has a name of 1-64 characters, unique in its strand. On read, a device segment with no name reads as `Range <k>` (k is the range's 1-based position), and when two ranges read back with the same name, the later one gets a suffix (`Porch 2`). The firmware limit is 32 bytes (`FX_fcn.cpp:766`), so Strand cuts the range name by bytes (on a UTF-8 character boundary) to leave room for the whole tag. The tags make the layout readable in the stock UI too. The firmware clears a segment's name when its `start` or `stop` changes and `n` is absent (`json.cpp:144-151`), so Strand sends `n` with every geometry change.

**Reading a layout back** (`readLayout`): for each strand, take the device segments that lie inside the strand. Group them into ranges by the name tag. If there is no tag, group them by geometry (same `stop`, same `grp`, `spc = (N−1)·grp`, starts `G` apart). A segment that fits neither rule becomes an **All** range over its span, with its first color, effect and palette (grouping and spacing are dropped). Segments are taken in ID order; a segment that overlaps a range already read is left out of the view. LEDs that no segment covers become an All range that is off. A strand whose view differs from its device segments (dropped segments, gaps, or All ranges made from such segments) is marked `normalize`; its first write rewrites the whole strand from the view, which deletes the left-out segments. Nothing changes on the device before that write.

**A segment that crosses an uncombined strand boundary.** This is the WLED default on a controller with several outputs: one segment over all of them (`autoSegments` is off unless the firmware was built with it, `FX.h:866-870`). The Lights tab shows a banner on each strand the segment touches: "Strand 1 and Strand 2 share one segment." with two buttons, **Split by strand** and **Combine strands**. Layout edits on those strands are disabled until the user picks one. Split by strand replaces the segment with one segment per strand, each with the old segment's colors, effect and palette. Nothing changes until the user picks.

**Segment IDs.** WLED keeps segments in a vector. A deleted segment stays as an empty slot (`stop: 0`) that `/json/state` does not list, and it still counts toward `maxseg` (`appendSegment` checks the vector size). A request for an ID below the vector size reuses that slot. A request for an ID at or above the size is added at the end (`json.cpp:79-83`). So Strand:

1. gives new segments the unlisted IDs below `max(listed id)` first (they are empty slots), lowest first, then `max(listed id) + 1`, `+ 2` and so on. Those higher IDs either reuse empty slots at the end of the vector or are appended, so every empty slot is reused before the vector grows. The free budget is `maxseg − (number of listed segments)`;
2. never deletes half or more of more than 3 segments in one request, because the firmware then purges and renumbers every segment (`json.cpp:481-488`); a larger delete is split into two requests;
3. reads the state again after every write that creates segments, and maps new segments by name.

**Writing a layout** (`writeRange`, `writeStrand`): Strand replaces the segments of the edited range or strand only. In one `POST /json/state` it deletes the old segments of that range (`{"id":n,"stop":0}`) and creates the new ones with the IDs from the rule above. It never sends `sel` or `mainseg`. It never sends a segment outside the edited range.

**Segment budget.** The device allows `info.leds.maxseg` segments (16, 32 or 64). The Lights tab shows "Segments used: 7 of 32". An edit that needs more segments than are free is refused before it is sent, with a message that says how many it needs.

### 6.3 Slots

A slot is one WLED segment. Its controls:

- color: `col[0]` (and `col[1]`, `col[2]` when the effect's metadata shows those slots),
- effect `fx` with its parameters `sx, ix, c1, c2, c3, o1, o2, o3`, shown from the effect metadata (`/json/fxdata`, `docs/wled-ui-audit/main-ui/effects-palettes.md` §2),
- palette `pal`, when the effect uses a palette.

Strand sends each slot change with the segment's `id`. It never sends a `seg` object without an `id`.

### 6.4 Individual paint

- Strand writes the colors with `{"seg":{"id":n,"i":[...]}}`. Runs of one color use the range form `[start, stop, "RRGGBB"]` to keep the body small. The firmware freezes the segment and clears it first (`wled00/json.cpp:314-361`).
- An effect cannot run on a painted range.
- WLED does not report painted colors in `/json/state`. `/json/live` is not usable either: it returns the blended frame, scaled by the global brightness, and black when the device is off (`json.cpp:1438-1475`). Strand reads the paint from the startup preset (section 6.7), which holds the last paint that Strand wrote.
- When global power goes from off to on, the firmware unfreezes every segment (`json.cpp:389-393`), so the painted range shows its `col[0]` instead of the paint. When Strand turns the device or a strand on, it sends the paint again in the same request. When another client turns the device on, the paint is gone until the next Strand edit or the next reboot. Strand does not detect this (decision 12).

### 6.5 Power and brightness

- The page header switch and the dashboard card control the device: global `on` and `bri`.
- Each strand has its own switch and brightness slider. They set `on` and `bri` on every segment of the strand. Segment `bri` is opacity on top of the global brightness; `0` turns the segment off (`segments.md` §5).

### 6.6 Flash start and flash end

WLED has no LED-identify command. Strand flashes an LED with a temporary segment:

1. Create a one-LED segment at the highest free ID: `{"start":i,"stop":i+1,"fx":0,"col":[[255,255,255]],"bri":255,"on":true,"n":"Strand flash"}`. A segment with a higher ID draws on top.
2. After 3 seconds, delete it (`stop:0`).

The server runs both steps (`POST /api/devices/:id/lights/flash`). It answers after step 1 and deletes the segment 3 seconds later with an in-memory timer. A second flash on the same device ends the first one at once. If the server restarts during the 3 seconds, the segment stays. `GET /api/devices/:id/lights` writes nothing: the view leaves out leftover "Strand flash" segments and dropped combinations, and the next Lights write to that device deletes them. The flash needs one free segment; when there is none, the buttons are disabled with the reason.

### 6.7 Startup preset

WLED keeps segments only in RAM. A reboot, a power cut, or a save of LED Hardware settings (`wled.cpp:242-245`) loses the layout. So Strand keeps the layout in one reserved WLED preset on each controller:

- **ID 250, name "Strand: startup".** It is an API preset: Strand writes its content directly, with `{"psave":250,"o":true,"n":"Strand: startup","bootps":250, ...content}` (`wled00/presets.cpp:218-265`). The content is the full layout: every segment ID from 0 to `maxseg − 1` in order. A listed segment is its full body (geometry, name, colors, effect, parameters, palette, `on`, `bri`, plus `i` for painted ranges); an unlisted ID is `{"id":k,"stop":0}`. The firmware applies a `psave` body as live state before it saves it (`json.cpp:466-506`), and at boot it appends a request ID at or above the vector size at the end (`json.cpp:79-84`), so the boot load gives the same layout whatever segments the firmware made at boot, and the live state does not change. The server builds the list from a fresh `GET /json/state` when the timer fires. The content has no top-level `on` or `bri`: at boot the firmware sets the brightness from `def.on`/`def.bri` and then applies the boot preset (`wled.cpp:683-691`), so a preset `on`/`bri` would override the Settings "turn on at boot" value. Segment `on` and `bri` stay, so per-strand power survives a reboot. Global power changes do not schedule a startup write. A normal "save current state" preset is not enough, because the firmware does not save paint.
- **`bootps: 250`** makes the controller load it at boot, with no Strand server running.
- **When Strand writes it:** the server writes it 5 seconds after the last Lights API write to that device (layout, slot, power or paint), and 5 seconds after every scene or look apply. It keeps one timer per device in memory and restarts it on each write. Each write rewrites `/presets.json` on the controller's flash, so the 5-second wait keeps it to about one write per editing session. The firmware warns that immediate API-preset saves can corrupt `presets.json` (`presets.cpp:250`), so Strand never sends two saves less than 5 seconds apart.
- **Another boot preset.** Strand always sets `bootps: 250`, with no question, and replaces any boot preset the user set elsewhere (owner's decision, 2026-11-24). The other preset itself is not deleted.
- **Reading paint:** `GET /presets.json` returns the preset; the server reads the `i` arrays of the painted segments, by segment name, when it builds the Lights view. While a startup write is pending, the server uses the paint it last sent instead.
- **The Presets tab does not list it.** The stock UI does, as "Strand: startup".

## 7. Screens

All screens use the design spec's tokens, shadcn class strings, components (`Switch`, `Slider`, `Select`, `Field`, `SettingsCard`, `Dialog`, sheets, toasts) and patterns (skeletons, offline banner, optimistic updates with rollback and an error toast).

### 7.1 Device page

```
← Devices
Backyard   ● Online · wled-backyard.local                    On [●]
[ Lights ] [ Presets ] [ Settings ]
```

Tabs: Lights (`/devices/:id`), Presets (`/devices/:id?tab=presets`), Settings (`/devices/:id/settings`). The banners (offline, live data, pending reboot) stay as designed.

### 7.2 Lights tab

```
Strands  [ Roofline · GPIO 16 · 150 ]  [ Garage · GPIO 17 · 60 ]  [ Combine… ]

Roofline                                   [● On]  ☀ ━━━━━●━━  72%
0 ━━━━━━━━━━━━━━━━┿━━━━━━━━━━━━━━━━━━━━━┿━━━━━━━━━━ 149
  Patio              Kitchen                 Rest
[+ Add range]                                   Segments used 7 of 32

▾ Patio · LEDs 0–59 · Every 2 · group 2     [Flash start] [Flash end] ⋯
   Pattern [All] [Every N] [Individual]    N [2]  Group [2]
   ● Slot 1   Warm white · Solid                                  ›
   ● Slot 2   Red · Twinkle                                       ›
▸ Kitchen · LEDs 60–119 · All · Rainbow
▸ Rest · LEDs 120–149 · Individual
```

- **Strand picker:** chips. "Combine…" opens a dialog that lists the strands as adjacent pairs and asks for confirmation. A combined strand's chip has a "Separate" action in its menu. Separating cuts every range that crosses the boundary, after a confirmation that names those ranges.
- **Strip:** a horizontal bar with one cell per LED (scaled to fit; one cell can stand for several LEDs on long strips). Each cell shows its slot's color, or its painted color. Range boundaries are drag handles. Dragging snaps to whole LEDs and shows the LED number. A handle cannot cross the next boundary. The strip is a `role="group"` with each handle as a `role="slider"` with arrow-key support (1 LED; Shift: 10 LEDs).
- **Add range:** splits the selected range at its middle. The user then drags the boundary. New ranges are named "Range 2", "Range 3".
- **Range menu (⋯):** Rename, Merge with next, Delete (merges into the neighbor).
- **Range card:** collapsed rows show the summary. The expanded card shows the pattern control, N and G steppers (N 2-16 and G 1-255, with `(N−1)·G ≤ 255` and N capped by the free segment budget; a stepper at its limit is disabled with a tooltip that gives the reason), and the slot rows.
- The UI never shows a segment ID or a WLED term. Segments Strand did not make appear as normal ranges (section 6.2).
- **No polling:** the tab reads `GET /api/devices/:id/lights` when it opens. Each write returns the new view, and the tab shows it. A failed write rolls back and shows an error toast.
- **Live output:** every change goes to the lights at once. Drags and sliders send at most one request at a time per strand; when a request ends, the newest value is sent. The final value is always sent.

### 7.3 Slot editor

A sheet (bottom sheet on mobile, side sheet on desktop) with three parts:

1. **Color:** a hue/saturation area, a brightness bar, a hex field, and the last 8 colors used (a preference). Extra color slots (Bg, Cs) show when the effect metadata shows them.
2. **Effect:** a search field, a "Favorites" group (stars; preference `favorites.effects`, stored by name), and "All effects" (sorted by name, Solid first, `RSVD` removed). The selected effect shows its sliders and checkboxes with the labels from the metadata.
3. **Palette:** a search field and the list, shown only when the effect uses a palette.

Each change is sent at once (sliders on release). "Apply to all slots" copies the effect and palette to the other slots of the range.

### 7.4 Individual paint

When the pattern is Individual, the range card shows:

```
Brush ● #FF8800   [Fill range]   [Clear]
▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓░░░░   (tap or drag to paint)
```

The browser sends the range's paint (one hex color per LED) when the pointer is released. The server turns it into one `seg.i` request with run-length ranges.

### 7.5 Presets tab

```
Scenes                                            [+ Save scene…]
  Roofline: Party        Roofline              ▶ Apply   ⋯
  Holiday                Roofline + Garage     ▶ Apply   ⋯
Looks                                             [+ Save look…]
  Candy cane   ●○●○      Every 2 · group 3     ▶ Apply to…  ⋯
  Warm white   ●         All                   ▶ Apply to…  ⋯
```

- **Save scene…:** a dialog with a name and a strand select (default: the strand open on the Lights tab). It saves that strand's current ranges, patterns, slots, paint, power and brightness.
- **Save look…:** a dialog with a name and a range select. It saves that range's pattern and slots. A range with Individual paint cannot be saved as a look; the option is disabled with the reason.
- **Apply (scene):** restores the scene's strand. If the strand's LED count changed since the save, a dialog warns first. If the strand no longer exists, or the combination no longer exists, the scene shows "Strand not found" and Apply is disabled.
- **Apply to… (look):** a dialog with a checkbox tree of targets: each strand (or combined strand) and its ranges. Checking a strand applies the look to each of its ranges. Ranges keep their positions.
- **Menu (⋯):** Rename, Delete (with confirmation).
- Empty states: "No scenes yet. Save the current strand setup to come back to it." and "No looks yet. Save a range's colors and effects to use them on any strand."

## 8. Data

New migration (append-only):

```sql
CREATE TABLE scenes (
  id          TEXT PRIMARY KEY,                -- UUID v4
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- 1-64 characters
  strand_key  TEXT NOT NULL,                   -- "o0" or "o0+o1"
  led_count   INTEGER NOT NULL,                -- the strand's length at save time
  content     TEXT NOT NULL,                   -- JSON StrandSnapshot
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE looks (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,                   -- JSON Look
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE strand_groups (
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  strand_key  TEXT NOT NULL,                   -- "o0+o1"
  PRIMARY KEY (device_id, strand_key)
);
```

`devices` delete must cascade, so `openDb` keeps `PRAGMA foreign_keys = ON` (already in Task 3).

Types (in `shared/apiTypes.ts`):

```ts
type SlotLook = { col: number[][]; fx: number; fxName: string; sx: number; ix: number;
                  c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean;
                  pal: number; palName: string };
type Pattern = { kind: "all" } | { kind: "every"; n: number; group: number } | { kind: "individual" };
type Look = { pattern: Exclude<Pattern, { kind: "individual" }>; slots: SlotLook[] };
type RangeSnapshot = { name: string; start: number; len: number;   // relative to the strand
                       pattern: Pattern; slots: SlotLook[]; paint?: string[] /* hex per LED */ };
type StrandSnapshot = { on: boolean; bri: number; ranges: RangeSnapshot[] };
```

Effects and palettes are stored by ID and by name. On apply, Strand uses the ID when the name at that ID still matches, and otherwise looks the name up. An effect that no longer exists falls back to Solid, and the apply result lists it. Effect IDs change between WLED builds (`docs/wled-ui-audit/README.md`).

## 9. API additions

The browser uses only these endpoints for the Lights and Presets tabs. The server reads `/json/cfg`, `/json/state`, `/json/info`, `/json/effects` and `/presets.json` as it needs them, before each write, so it always computes segment IDs from the device's current state.

**View types** (in `shared/apiTypes.ts`):

```ts
type SlotView = SlotLook & { on: boolean };
type RangeView = { name: string; start: number; len: number;        // relative to the strand
                   pattern: Pattern; slots: SlotView[]; paint?: string[] };
type StrandView = { key: string; name: string; pins: number[]; start: number; len: number;
                    on: boolean; bri: number; ranges: RangeView[]; normalize: boolean;
                    shared?: { with: string[] } };                     // segment crosses strands (6.2)
type LightsView = { on: boolean; bri: number; strands: StrandView[];
                    segments: { used: number; max: number };
                    notices: string[]; matrix: boolean };   // matrix: a 2D device (info.leds.matrix)
type LightsPatch = { on?: boolean; bri?: number };                    // bri 0-255
type StrandPatch = { on?: boolean; bri?: number; ranges?: RangeView[] }; // bri 1-255
type Effect = { id: number; name: string; pal: boolean; sliders: string[]; checks: string[]; colors: string[] };
type Palette = { id: number; name: string; stops: string[] };        // "#RRGGBB", from /json/palx
type ApiErrorBody = { error: ErrorCode; message: string; need?: number };
```

On a 2D device (`matrix: true`) the view has no strands, the tab shows the §3 message, and every write gets `422 invalid_layout`. Strand `bri` is 1-255: segment `bri: 0` turns the segment off and reads back as 255 (`json.cpp:193-197`, `:597`). `Effect.sliders[k]` labels `["sx","ix","c1","c2","c3"][k]`, `checks[k]` labels `["o1","o2","o3"][k]`, `colors[k]` labels `col[k]`; `""` means hidden, and trailing `""` entries are removed.

| Method and path | Result |
|---|---|
| `GET /api/devices/:id/lights` | `LightsView`. Writes nothing: leftover "Strand flash" segments and dropped combinations are left out of the view, and the next Lights write deletes them. |
| `PATCH /api/devices/:id/lights` `{ on?, bri? }` | `LightsView`. Device power and brightness. Sends paint again on power-on. |
| `PATCH /api/devices/:id/lights/strands/:key` `{ on?, bri?, ranges? }` | `LightsView`. `ranges` is the strand's full list of `RangeView` . The server compares it with the device and sends only what changed: new geometry or pattern rewrites that range's segments; a slot change patches that slot's segment by ID; a paint change sends `seg.i`. When the strand is marked `normalize`, the server rewrites the whole strand instead. |
| `POST /api/devices/:id/lights/strands/:key/resolve` `{ action: "split" \| "combine" }` | `LightsView`. The two answers to a shared segment (6.2). |
| `POST /api/devices/:id/lights/flash` `{ strandKey, led }` | `204`. `led` is relative to the strand (6.6). |
| `GET /api/devices/:id/strand-groups` | `string[]` (strand keys) |
| `PUT /api/devices/:id/strand-groups` `{ keys }` | `LightsView`. Each key must name adjacent strands of the current config. |
| `PUT /api/devices/:id/strand-names` `{ names: Record<string, string> }` | `LightsView`. `422 invalid_name` for a name outside 1-64 characters. |
| `GET /api/devices/:id/scenes` | `Scene[]` (`{ id, name, strandKey, ledCount, summary, createdAt, updatedAt }`) |
| `POST /api/devices/:id/scenes` `{ name, strandKey }` | `201 Scene`. The server snapshots the strand from the device. |
| `PATCH /api/devices/:id/scenes/:sceneId` `{ name }` | `Scene` |
| `DELETE /api/devices/:id/scenes/:sceneId` | `204`, also when the scene is already gone |
| `POST /api/devices/:id/scenes/:sceneId/apply` | `{ view: LightsView; warnings: string[] }` |
| `GET /api/devices/:id/looks` | `LookRecord[]` (`{ id, name, look, createdAt, updatedAt }`) |
| `POST /api/devices/:id/looks` `{ name, strandKey, range }` | `201 LookRecord`. The server takes the range's pattern and slots from the device. |
| `PATCH /api/devices/:id/looks/:lookId` `{ name }` | `LookRecord` |
| `DELETE /api/devices/:id/looks/:lookId` | `204`, also when the look is already gone |
| `POST /api/devices/:id/looks/:lookId/apply` `{ targets: { strandKey, range?: string }[] }` | `{ view: LightsView; warnings: string[] }` |

- Errors (texts from the design's mock app server):

| Code | Status | Message |
|---|---|---|
| `strand_changed` | 409 | "That strand isn't on this controller any more." |
| `shared` | 409 | "`<strand>` shares a segment with another strand. Choose Split or Combine on the Lights tab first." |
| `segment_budget` | 422 | "This needs `<n>` more segment(s) and `<free>` is/are free. Remove a range first." The body also has `need: n`. |
| `invalid_layout` | 422 | "That layout doesn't fit this strand.", "2D matrix layouts aren't supported yet.", or "This setup is too large to save." |
| `invalid_name` | 422 | "Names need 1 to 64 characters." |
| `not_adjacent` | 422 | "Only strands whose LEDs touch can be combined." |
| `too_many` | 422 | "A device can keep 256 scenes." / "A device can keep 256 looks." |
| `painted` | 422 | "A range with painted LEDs can't be saved as a look." |
| `not_found` | 404 | "That scene was deleted." / "That look was deleted." / "That range isn't on the strand any more. Pick it again." |

  `strand_changed` is sent when a scene's strand key does not exist in the current config; `segment_budget` when a write needs more segments than are free.
- Apply sends one `POST /json/state` for the segments (two when the delete rule in section 6.2 splits it), then one `seg.i` request per painted range, then starts the startup-write timer.
- Limits: name 1-64 characters, at most 256 scenes and 256 looks per device, content at most 64 KB.
- Strand names move from a browser preference to this endpoint, so the server can use them in segment names.
- `GET /api/devices/:id/presets` (WLED presets) is not used by any screen. The plan removes it.

**Layout modules** (pure functions, server only). `server/lights/layoutRead.ts` reads:

- `parseState(raw: unknown): WledState`
- `strandsFromConfig(cfg: WledConfig, groupKeys: string[], names: Record<string, string>): { strands: Strand[]; dropped: string[] }`
- `segmentName(base: string, tag: "" | "paint" | { k: number; n: number }): string`
- `decodePaint(i: unknown[], len: number): string[]`, `encodePaint(paint: string[]): (number | string)[]`
- `readLayout(state: WledState, strands: Strand[], lists: Lists, paint: PaintMap, maxseg: number): Omit<LightsView, "notices" | "matrix">`
- `readStrand(state: WledState, strand: Strand, lists: Lists, paint: PaintMap): { view: StrandView; segIds: number[][]; inside: number[]; crossing: number[] }`

`server/lights/layoutWrite.ts` writes:

- `validateRanges(strand: Strand, ranges: RangeView[], effectCount: number, opts?: { sharedNames?: boolean }): string | null`
- `segmentsNeeded(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap): number`
- `writeStrand(state: WledState, strand: Strand, next: StrandPatch, lists: Lists, paint: PaintMap, maxseg: number, opts?: { sharedNames?: boolean }): LayoutWrite`, where `LayoutWrite = { seg: SegPatch[][]; paint: { name: string; i: (number | string)[] }[] }` (one `seg` array per request). It throws `LayoutError` (`segment_budget`, `invalid_layout` or `shared`).

`server/lights/snapshots.ts` turns scenes and looks into strand content:

- `snapshotStrand(view: StrandView): StrandSnapshot`, `lookFromRange(range: RangeView): Look`
- `fitRanges(ranges: RangeSnapshot[], len: number): { ranges: RangeSnapshot[]; warnings: string[] }`, `resolveSlot(slot: SlotLook, lists: Lists): { slot: SlotLook; warnings: string[] }`
- `sceneToPatch(snapshot: StrandSnapshot, ledCount: number, strand: Strand, lists: Lists): { next: StrandPatch; warnings: string[] }`
- `lookToPatches(look: Look, targets: { strand: StrandView; range?: string }[], lists: Lists): { patches: { key: string; next: StrandPatch }[]; warnings: string[] }`

They return the next strand content (`StrandPatch`), not segment patches. The endpoint passes each one to `writeStrand`, one strand at a time, so two strands never get the same new segment ID.

Round-trip property, tested with generated layouts: `readLayout(apply(writeStrand(L)))` equals `L` for every layout `L` within the segment budget.

## 10. Design spec update

`docs/design/strand-wled-spec.html` gets the screens in section 7, built in the file's style (render functions, `A.*` actions, the `q()` cache):

- The mock app server gains the section 9 endpoints, returning `LightsView`. It keeps a strand-model state per seed device (it does not simulate WLED segments), plus `getEffects` and `getPalettes` for the slot editor. The "MOCK APP SERVER" comment lists the new endpoints, because it is the API contract.
- Seeds: Backyard gets two strands with ranges (Every 2 and All) and one segment made outside Strand (read as an All range); Front Roof one strand with Individual paint; Garage one strand with All.
- Prototype controls: "Add a foreign segment" (shows it read as an All range) and "Fill the segment budget".

## 11. Left to the builder

- The color picker's exact layout, within the shadcn style.
- The strip's cell scaling on strips longer than the screen width.
- Keyboard details of the slot editor sheet, within the shadcn Sheet behavior.
- The wording of warnings and empty states that this document does not give.

## 12. My calls (not the owner's)

1. Segment name tags (`Patio 1/3`, `Patio paint`) as the primary way to read a layout back, with geometry as the fallback.
2. Flash with a temporary top segment, not with `seg.i` on the range's own segment.
3. Strand names as a preference; "Strand 1", "Strand 2" by default.
4. Applying a look to a strand applies it to each range of the strand; ranges keep their positions.
5. The Lights API takes a strand's full range list on each edit, and the server works out the smallest WLED change. The server holds two short in-memory timers (flash, startup write).
6. Segments Strand did not make are read as All ranges; overlapping ones are left out of the view and deleted at the strand's first write; uncovered LEDs become an off All range.
7. The on-screen strip draws the configured colors and effect names, not an exact mirror of animated pixels. The lights themselves change at once.
8. The existing `GET /api/devices/:id/presets` endpoint is removed.
9. "Split by strand" or "Combine strands" as the two answers to a segment that spans uncombined strands; layout edits wait for the answer.
10. Startup preset details: ID 250 and the 5-second write delay.
11. Strand sends paint again when it turns a device or strand on.
12. The state pass-through narrows to `{ on, bri }`.
