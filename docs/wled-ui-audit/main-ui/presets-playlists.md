# Presets and Playlists (stock WLED UI, 17.0.0-dev)

Source: `wled00/data/index.htm:313-327`, `wled00/data/index.js`. Firmware: `wled00/presets.cpp`, `wled00/playlist.cpp`, `wled00/json.cpp`.

## 1. Storage and IDs

- Presets live in `/presets.json` on the device filesystem: a JSON object keyed by preset ID string, with a filler `"0": {}` entry (`initPresetsFile`, `presets.cpp:102-117`).
- Valid IDs for save/delete: **1-250** (`json.cpp:505-509`). 251-254 are rejected. 255 is a temporary preset kept in RAM (ESP32) or `/tmp.json`, not used by the UI.
- A preset is a playlist if it has `playlist.ps` (`isPlaylist`, `index.js:438-443`).
- Deleted entries are blanked out of the file (written as spaces), not left as `{}` (`deletePreset`, `presets.cpp:280-285`).
- Preset content types:
  - **State preset**: serialized state (`on`, `bri`, `transition`, `bs`, `mainseg`, `seg[]`, optional `ledmap`) plus `n`, optional `ql`.
  - **API preset**: arbitrary JSON API object, or `{"win":"<HTTP API string>"}`, plus `n`, optional `ql`.
  - **Playlist**: `{"playlist":{...},"on":true,"n":...,"ql":...}`.

## 2. Loading and caching

`loadPresets()` `index.js:511-525` fetches `GET /presets.json` (404 -> treated as `{"0":{}}`). Failure -> `presetError(false)`.

Cache (`index.js:287`, `298-299`, `604-643`):
- `localStorage["wledP"]`: last good presets JSON.
- `localStorage["wledPmt"]`: `info.fs.pmt` (presets modified time, unix seconds; firmware updates it on every save/delete and on upload of presets.json, `presets.cpp:73`, `wled_server.cpp:219`).
- On page load, after the first `/json/si`, if `info.fs.pmt == wledPmt` the list is built from `wledP`; otherwise `/presets.json` is fetched and the cache is rewritten.
- `pmt` changes arriving later over the WebSocket do **not** trigger a reload. Presets changed by another client are not shown until a page reload or a local save/delete.
- Settings > UI has a button that clears `wledPmt` and `wledPalx` (`settings_ui.htm:160-161`).

`presetError(empty)` `index.js:470-496`: shows "You have no presets yet!" or "Sorry, there was an issue loading your presets!". If `wledP` exists in localStorage it offers a textarea with the backup, "Copy to clipboard", and "Restore", which uploads it as `/presets.json` via `POST /upload` (multipart field `data`, filename `/presets.json`) and reloads after 2 s (`restore`, `index.js:498-509`).

## 3. Preset list

`populatePresets()` `index.js:604-643`:
- Sort with `cmpP` (`index.js:1417-1427`): if UI setting "Sort presets by ID" (`cfg.comp.idsort`) is on, or a preset has no name, by numeric ID. Otherwise playlists first, then names starting with a letter/digit/non-Latin char, then names starting with other characters; within each, natural (`numeric:true`) name order. The idsort branch returns a boolean from the comparator, which is not a valid sort comparator in modern engines.
- Each row `#p{i}o`:
  - optional ID badge (`cfg.comp.pid`, "Show preset IDs", default on)
  - boot icon (e410) if `i == info.leds.bootps`
  - playlist icon (e139) if it is a playlist
  - name (`n` or "Preset {i}"); click -> `setPreset(i)`
  - pencil icon -> `tglSegn(i+100)` shows the name input (only meaningful when expanded)
  - expand icon -> `expand(i+100)` renders the edit form into `#seg{i+100}`; expanding one preset collapses the others (`index.js:3059-3099`)
- Active preset/playlist highlighted via `updatePA()` (`index.js:1267-1287`): `currentPreset = state.pl >= 0 ? state.pl : state.ps` (`index.js:1478-1479`). `state.ps` is -1 when no preset is active.
- Search box (`index.htm:317-321`) filters rows by name with the shared `search()`; clearing it re-runs `populatePresets()`.

### Quick load

`populateQL()` `index.js:589-602`: every preset with a non-empty `ql` gets a small button in `#pql` at the top of the Presets tab (in simplified UI it moves to the Colors tab). Button text = `ql` (UI limits input to 2 chars; firmware buffer 8 bytes for multi-byte characters, `presets.cpp:235`), tooltip = preset name, sorted by ID, click -> `setPreset(id)`. The active one is highlighted.

## 4. Running a preset

`setPreset(i)` `index.js:2517-2531`:

- **Non-playlist** presets: the UI sends the preset content it already has instead of only the ID, to skip the device's async file read:
  ```json
  {"pd": 5, "on": true, "bri": 128, "transition": 7, "mainseg": 0, "seg": [...], "v": true, "time": 1760000000}
  ```
  (`n` and `ql` are stripped.) Firmware applies the content, then sets `currentPreset = pd` only if the content changed state (`json.cpp:519-529`).
  There is a guard intended to fall back to `ps` when the cached preset is the UI's "Please refresh" placeholder, but the condition `win.indexOf("Please") <= 0` is also true when the string starts with "Please", so the placeholder `win` text is sent as an HTTP API command.
- **Playlists**: `{"ps": 5, "on": true}`. Firmware `ps` path: `applyPreset(id)` unloads any running playlist and loads the preset from file asynchronously (`json.cpp:530-539`, `presets.cpp:127-134`).
- Shows a toast "Loading preset NAME (ID)".
- Firmware `ps` also accepts strings: `"1~5~"` cycle, `"r"` / `"1~5r"` random, etc. The UI never sends these.
- UI setting "Power button preset override" (`cfg.comp.on`/`off`, 0-250) makes the top-bar power button send `{"ps":N}` instead of `on` (`index.js:1830-1831`).
- Large `pd` payloads (> 1340 bytes, or > 500 on ESP8266) go over HTTP instead of the WebSocket (`index.js:1773-1774`).

## 5. Save dialog (new preset)

Opened by the "+ Preset" button (`resetPUtil`/`makePUtil`, `index.js:2152-2167`, `2215-2223`). Form built by `makeP(0)` `index.js:2064-2150`:

| Field | Element | Default | Effect on JSON |
|---|---|---|---|
| Name | `#p0txt`, maxlength 32 | current effect name (from the effect list) | `n` (empty -> "Preset {id}") |
| Quick load label | `#p0ql`, maxlength 2 | empty | `ql` (omitted if empty) |
| Use current state | `#p0cstgl` | checked | checked -> state options; unchecked -> API command textarea |
| API command | `#p0api` textarea | empty | parsed as JSON; if not JSON, stored as `{"win":"<text>"}` |
| Include brightness | `#p0ibtgl` | checked | `ib` |
| Save segment bounds | `#p0sbtgl` | checked | `sb` |
| Checked segments only | `#p0sbchk` | unchecked | `sc` |
| Ledmap | `#p0lmp` (only if `info.maps.length > 1`) | "Unchanged" | `ledmap` (omitted when Unchanged) |
| Apply at boot | `#p0bps` | unchecked | `bootps: <id>` when checked |
| Save to ID | `#p0id` number 1-250 | lowest unused ID (`getLowestUnusedP`, `index.js:414-420`, capped at 250) | `psave` |
| Warning | `#p0warn` | - | "Overwriting NAME!" if the ID exists; "ID must be 250 or less." (`checkUsed`, `index.js:422-429`) |
| Save / Cancel | buttons | - | `saveP(0,false)` / `resetPUtil()` |

### JSON sent by `saveP` `index.js:2533-2597`

State mode:
```json
{"ib": true, "sb": true, "sc": false, "ledmap": 1, "bootps": 7,
 "psave": 7, "n": "Evening", "ql": "E",
 "v": true, "time": 1760000000, "transition": 7}
```
`transition` only appears if the Segments-tab transition field differs from the device value.

Firmware (`savePreset`, `presets.cpp:218-278`; `doSaveState`, `presets.cpp:29-85`): with no `o` key, saving is async on the next loop. It writes `serializeState(forPreset=true, includeBri=ib, segmentBounds=sb, selectedOnly=sc)`:
- `ib`: include `on`, `bri`, `transition`, `bs`.
- `sb`: include `start/stop/startY/stopY`, and add `{"stop":0}` entries for every unused segment slot up to `maxseg` (only when `sc` is false), so loading the preset deletes other segments.
- `sc`: include only selected segments.
- Always included: `mainseg` and per-segment `id, grp, spc, of, on, frz, bri, cct, set, lc, n, col, fx, sx, ix, pal, c1-c3, sel, rev, mi, (rY, mY, tp), o1-o3, si, m12, bm`.
- Plus `n`, `ql`, `ledmap` if given.

API mode (checkbox unchecked):
```json
{"seg": {"fx": 9}, "o": true, "psave": 8, "n": "Rainbow", "ql": "R", "v": true, "time": 1760000000}
```
or for non-JSON text: `{"win": "FX=9&SX=200", "o": true, "psave": 8, "n": "Rainbow"}`. Firmware writes it immediately, removing `o`, `v`, `time`, `error`, `psave`, `bootps` (`presets.cpp:238-266`). `transition` and any other keys are kept in the stored preset.

Client-side validation for API mode: empty textarea -> "Please enter your API command first"; text containing `{` that fails JSON.parse -> "Syntax error in custom JSON API command"; text starting with "Please" -> "Please refresh the page before modifying this preset".

After sending, the UI updates its local copy immediately (API/playlist presets: the sent object minus `psave/o/v/time`; state presets: a placeholder `{"n":..,"win":"Please refresh the page to see this newly saved command."}`), re-renders, closes the form, and refetches `/presets.json` 750 ms later.

`bootps`: firmware sets the boot preset and writes config (`presets.cpp:238-243`). Unchecking "Apply at boot" sends nothing, so it never clears an existing boot preset; that is done in Settings > LED.

### Side effects of saving (firmware processes the whole object as a state command first)

- **API mode**: the API JSON is also applied to the live state in the same request, because `deserializeState` handles `seg`, `on`, `win`, etc. before `psave` (`json.cpp:466-517`). Saving an API preset runs it.
- **Ledmap**: the `ledmap` key is applied immediately (`json.cpp:503`).
- **Playlist**: the `playlist` key starts the playlist (section 7).
- Error codes come back in `state.error`: 11 "Not enough space to save preset!", 12 "Preset not found.", 10/19 filesystem errors (`index.js:1539-1602`).

## 6. Editing, renaming, overwriting, deleting

Expanding an existing preset renders `makeP(i)` with:
- Name prefilled; Quick load prefilled.
- Checkbox labelled "Overwrite with state", **unchecked** by default, so the API textarea is shown prefilled with `papiVal(i)` (`index.js:445-452`): the stored preset JSON minus `n`, `p`, `ql`, or the raw `win` string.
- Pressing Save in this default mode re-saves the existing content (API mode) under the new name/QL. This is how rename works.
- Checking "Overwrite with state" swaps in the state options (ib/sb/sc/ledmap) and replaces the content with current state.
- "Save to ID" defaults to `i`. Changing it saves a copy under the new ID; the original remains. Warning shows if the target exists.
- "Apply at boot" is pre-checked if `i == bootps`.
- For playlists, the checkbox reads "Show playlist editor" and is checked; unchecking shows the raw JSON.

Note: re-saving a **state** preset in API mode stores the old serialized state as an API preset with `o` semantics; content is identical but it is now written synchronously, and it is also applied to the live state at save time.

Delete (`delP`, `index.js:2618-2631`): first click turns the button red ("Delete!"), second click sends `{"pdel": i}`, removes it locally and re-renders. No reload from the device.

## 7. Playlists

Opened via "+ Playlist" (`makePlUtil`, `index.js:2197-2213`; toast if fewer than 2 presets exist, but continues). Editor: `makeP(i, true)` + `refreshPlE` (`index.js:1974-1992`) + `makePlEntry` (`index.js:2169-2195`).

Working model `plJson[i]` (new playlist default, `index.js:2069-2076`):
```json
{"ps": [1], "dur": [100], "transition": [7], "repeat": 0, "r": false, "end": 0}
```
For existing playlists, `formatArr` (`index.js:3032-3057`) expands scalar `dur`/`transition` into arrays padded to the length of `ps`.

### Controls

| Control | Element | Behavior / JSON field |
|---|---|---|
| Entry preset | select per entry | `ps[k]`. Options: all non-playlist presets, plus finite playlists (`repeat > 0`) other than itself (`makePlSel`, `index.js:1960-1972`). Playlists marked with ▶. |
| Add entry | `+` button per entry | inserts after entry k, copying its duration and transition, preset defaults to 1 (`addPl`) |
| Delete entry | trash per entry | hidden when only one entry (`delPl`) |
| Duration | number, seconds, step 0.1, 0-4294967 | `dur[k] = floor(sec*10)` (tenths). 0 = stay until advanced |
| Transition | number, seconds, 0-65.5 | `transition[k] = floor(sec*10)`; clamped to not exceed that entry's duration (`pleTr`, `index.js:2025-2036`) |
| Shuffle | `#pl{i}rtgl` | `r: bool`; checked also when `repeat < 0` |
| Manual advance | `#pl{i}manual` | sets every `dur` to 0 and makes duration fields read-only; unchecking resets all to 100 (10 s) (`plM`, `index.js:2053-2062`) |
| Repeat indefinitely | `#pl{i}rptgl` | checked -> `repeat: 0`, `end` removed, hides repeat/end controls |
| Repeat N times | `#pl{i}rp` 0-127 | `repeat: N` |
| End preset | `#pl{i}selEnd` | `end`: 0 None, 255 "Restore preset" (return to the preset active before the playlist), or a preset ID |
| Test / Stop | button | Test sends `{"playlist": plJson[i], "on": true}`; Stop sends `{"playlist": {}}` (unloads) (`index.js:2599-2616`) |
| Name, Quick load, Apply at boot, Save to ID | same as presets | |

### Save JSON

```json
{"playlist": {"ps":[3,5,9], "dur":[300,300,0], "transition":[7,7,20], "repeat":2, "r":false, "end":255},
 "on": true, "o": true, "psave": 12, "n": "Party", "ql": "P", "v": true, "time": 1760000000}
```

Firmware (`presets.cpp:267-275`, `json.cpp:542-547`, `playlist.cpp:58-150`, `186-198`):
- The `playlist` key in the same request is **loaded and started immediately** (with ID 0, since it did not come from a preset).
- Save is async: on the next loop the firmware serializes the in-memory playlist, not the request JSON. Stored shape: `{"playlist":{"ps":[..],"dur":[..],"transition":[..],"repeat":N,"end":N,"r":0|1},"on":true,"n":..,"ql":..}`. `r` comes back as an integer.
- Limits: max 100 entries. `dur` in tenths, max 42949670. `repeat < 0` means infinite + shuffle. `end` > 250 (other than the 255 restore case) is treated as 0.
- Missing `dur` defaults to 100 (10 s); missing `transition` defaults to the global transition.
- Duration 0 means infinite: advance manually with `{"np": true}` (not exposed in the stock UI).
- Nesting: one level. A playlist entry can be a finite playlist; when it ends, the parent resumes. An endless child drops the parent.
- Playlists pause while brightness is 0 or nightlight is active.
- Applying any preset via `ps`, or changing the effect (`fx`) outside a preset, unloads the running playlist (`presets.cpp:127-129`, `json.cpp:289-291`).
- The running playlist's preset ID is `state.pl` (-1 when none, 0 while testing an unsaved playlist).

## Replacement notes

**MVP scope (PRD section 15):**
- List presets from `/presets.json` (filter out `"0"` and non-object entries). Show name, ID, playlist marker, active marker (`state.pl` then `state.ps`), quick-load label optional.
- Run: `{"ps": id}` is the simplest correct command for both presets and playlists. The stock UI's `pd` trick is an optimization, not required.
- Create from current state: `{"psave": id, "n": name, "ib": true, "sb": true}` with `id` = lowest unused 1-250. Offer "include brightness" and "save segment bounds" as options; `sc` (selected only) optional.
- Rename without changing content: re-save the stored JSON with a new `n` using API mode (`{...content, "o": true, "psave": id, "n": newName}`) and accept that firmware also applies that content live at save time; or upload a modified presets.json (riskier). There is no rename-only command.
- Delete: `{"pdel": id}`.
- Re-fetch `/presets.json` after save/delete and whenever `info.fs.pmt` changes (the stock UI does not do the latter; the server should).

**Out of scope for MVP (PRD section 29):** playlist designer, API-command presets, quick-load labels, boot preset, ledmap-per-preset. Still list and run playlists, since users will have them.

**Gotchas:**
- State saves are async on the device. Fetching `/presets.json` immediately after `psave` can return the old file. Poll for `info.fs.pmt` change or retry after a short delay.
- Saving an API preset or playlist also executes it.
- `bootps` can only be set from the save dialog, not cleared.
- `sb:true` presets include `{"stop":0}` entries that delete all other segments when loaded. Explain this in the save dialog wording.
- Preset files can be large; fetch `/presets.json` once, cache by `pmt` on the server, and serialize requests to the device (ESP 503s under concurrent load).
- The firmware JSON API key `transition` gets embedded into API presets if sent in the same request; keep save requests minimal.
- Names: firmware stores up to 32 chars; QL up to 8 bytes.
- IDs 251-255 are not user presets. Keep the ID picker in 1-250.
- Error feedback arrives asynchronously in `state.error` (11 = out of space).
