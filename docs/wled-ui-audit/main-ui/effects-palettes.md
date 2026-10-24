# Effects and Palettes (stock WLED UI, 17.0.0-dev)

Source: `wled00/data/index.htm`, `wled00/data/index.js`, `wled00/data/index.css`. Firmware references are under `wled00/`.

Layout note: in the stock UI the effect list and effect sliders live on the **Effects** tab (`index.htm:173-275`). The palette list is not its own tab; it sits at the bottom of the **Colors** tab (`index.htm:152-170`). In "simplified UI" mode both become modal `<dialog>` dropdowns on the Colors tab (`index.js:3245-3334`).

## 1. Data sources

| Endpoint | Returns | Used by |
|---|---|---|
| `GET /json/effects` | JSON array of effect names, index = effect ID. Names are the metadata string truncated at `@` (`json.cpp:1241-1253`). Reserved slots are present as `"RSVD"`. | `loadFX()` `index.js:547-565` |
| `GET /json/fxdata` | JSON array, same length/order as `/json/effects`, each element is the metadata text **after** `@`, or `""` if the effect has no `@` (`json.cpp:1295-1325`, streamed chunked). | `loadFXData()` `index.js:567-587` |
| `GET /json/palettes` | JSON array of the 73 fixed palette names (IDs 0-72) from `JSON_palette_names` (`FX_fcn.cpp:2404-2413`, served at `json.cpp:1374-1377`). Does **not** include custom or usermod palettes. | `loadPalettes()` `index.js:527-545` |
| `GET /json/palx?page=N` | `{"m": maxPage, "p": {"<id>": [entries...]}}`, 8 palettes per page (5 on ESP8266) covering fixed, then usermod, then custom palettes (`json.cpp:983-1058`). | `getPalettesData()` `index.js:2883-2899` |
| `GET /json/si` (or WS) `info` | `fxcount`, `palcount` (fixed+usermod+custom), `cpalcount` (custom count, includes gray gap placeholders), `umpalcount`, `umpalnames[]`, `cpalmax`, `vid`, `leds.matrix` | `parseInfo`, `populatePalettes`, palx cache check |

Load order on page open is strictly sequential to avoid HTTP 503 on low-heap devices (`index.js:289-305`): `/json/palettes` -> `/json/fxdata` -> `/json/effects` -> `/json/si` -> `/json/palx` pages -> repopulate palettes (now that `cpalcount` is known) -> presets -> skin.css -> WebSocket. Each fetch retries up to 5 times at 100 ms.

`loadFXData` replaces element 0 (Solid) with `";!;"` (`index.js:573-574`): Solid shows no sliders, only color slot 1 labelled "Fx", and no palette.

## 2. Effect metadata (fxdata) format

Full effect string in firmware: `Name@<sliders>;<colors>;<palette>;<flags>;<defaults>` (e.g. `FX.cpp:187`, doc link at `FX.cpp:48`: kno.wled.ge/interfaces/json-api/#effect-metadata). `/json/fxdata` returns only the part after `@`. Fields are separated by `;`, items inside a field by `,`.

### Field 0: sliders and checkboxes

Positional list, up to 8 entries:

| Position | Control | JSON key | Range |
|---|---|---|---|
| 0 | Speed slider | `sx` | 0-255 |
| 1 | Intensity slider | `ix` | 0-255 |
| 2 | Custom 1 slider | `c1` | 0-255 |
| 3 | Custom 2 slider | `c2` | 0-255 |
| 4 | Custom 3 slider | `c3` | **0-31** (`index.htm:255`, firmware clamps `json.cpp:305-306`) |
| 5 | Option checkbox 1 | `o1` | bool |
| 6 | Option checkbox 2 | `o2` | bool |
| 7 | Option checkbox 3 | `o3` | bool |

Entry value meaning:
- empty string: control hidden
- `!`: control shown with its default label ("Effect speed", "Effect intensity", "Custom 1".."Custom 3", "Check 1".."Check 3")
- any other text: control shown, text becomes its label

Example: `Scanner@!,Trail,Delay,,,Dual,Bi-delay` -> speed (default label), intensity labelled "Trail", c1 labelled "Delay", c2/c3 hidden, o1 "Dual", o2 "Bi-delay", o3 hidden.

### Field 1: color slots

Up to 3 entries for color slots 1-3 (`col[0..2]`). Empty = slot hidden. `!` = default label `Fx` / `Bg` / `Cs`. Other text = custom label.

### Field 2: palette

- empty: palette list hidden ("Color palette not used")
- `!`: palette list shown with label "Color palette"
- non-numeric text: palette list shown, text replaces the label
- numeric: palette list hidden (the comment says it means "use this palette ID"; no built-in effect uses it)
- text containing `=`: parsed as `label=default` but the default value is discarded by the UI (`index.js:1727-1732`)

### Field 3: flags

Characters, any combination: `0` = 0D/single pixel capable, `1` = 1D, `2` = 2D, `v` = volume (audio) reactive, `f` = frequency (audio) reactive. Missing field is treated as `1` by the list builder (`index.js:960`). Solid gets no flags (`index.js:961`).

### Field 4 (last field): defaults

`key=value` comma list applied by **firmware** when an effect is selected with `fxdef: true` (`FX_fcn.cpp:711-747`, parser `util.cpp:481-499`). Keys: `sx`, `ix`, `c1`, `c2`, `c3`, `o1`, `o2`, `o3`, `m12` (1D->2D mapping, 0-7; reset to 0 if absent), `si` (sound sim 0-3), `rev`, `mi`, `rY`, `mY`, `pal`. Unspecified slider defaults fall back to firmware constants `DEFAULT_SPEED`, `DEFAULT_INTENSITY`, `DEFAULT_C1..C3`; unspecified checkboxes to false.

`pal` is special: it is always read to set the segment's `_default_palette` (what palette 0 "Default" renders as for this effect; `6` "Party" if unset or 0), and is only written to `seg.pal` when `fxdef` is true (`FX_fcn.cpp:736-739`).

Parser quirk: firmware reads defaults from the text after the **last** `;` (`strrchr`). For a 4-field string like `Flow Stripe@Hue speed,Effect speed;;!;pal=11`, firmware reads `pal=11` as defaults while the UI reads the same field as flags (and, since it contains `1`, tags the effect as 1D). The UI never reads defaults itself.

### No-metadata effects

If an effect string has no `@` (e.g. "Oscillate"), fxdata is `""`. `setEffectParameters` then shows speed + intensity, all three color slots labelled `1`,`2`,`3`, and the palette (`index.js:1645`, `1703-1708`, `1725`). For effect IDs >= 128 the code references an undefined variable `nSliders` (`index.js:1645`) and would throw; no built-in effect hits this, but a usermod effect without metadata would.

## 3. Building the effect list

`populateEffects()` `index.js:930-975`:

1. Remove Solid (index 0), map the rest to `{id, name}`, sort by `name.localeCompare`, re-insert Solid first. IDs come from the array index of `/json/effects`.
2. Skip any effect whose name contains `RSVD` (reserved/compiled-out slots; `FX.cpp:11006-11040`).
3. Append glyphs to the visible name, derived from fxdata:
   - `🎨` if palette field is non-empty and non-numeric (effect uses palette)
   - `•` flag `0`, `⋮` flag `1`, `▦` flag `2`, `♪` flag `v`, `♫` flag `f`
4. Render each item with `generateListItemHtml` (`index.js:1084-1096`): `<div class="lstI" data-id=ID data-opt="<fxdata>" onclick="setFX(ID)">` with a hidden radio `name="fx"`. ID 0 gets class `sticky` (pinned at top while scrolling). If fxdata was empty, `data-opt` is `";;!;1"`.

These glyphs are load-bearing: filters, the 2D-mapping visibility logic, and sound-sim visibility all do substring matches on the rendered name (`index.js:1233`, `1401`, `1404`, `3021`).

### Visibility rules applied on every state update

`updateSelectedFx()` `index.js:1361-1407` runs after each state read:
- Marks the current effect's item `selected` (sticky above the slider panel; repositioned every 750 ms by `setSelectedEffectPosition`, `index.js:1669-1679`).
- Hides every non-Solid effect if `segLmax == 0`.
- Hides effects without flag `0` when `segLmax == 1` (single-pixel segment).
- Hides 2D-only effects (flag `2` and no `1`) when no selected segment is 2D (`has2D` false).
- `segLmax` is commented as "largest selected segment" but is computed over **all** segments (`index.js:1494-1498`), so the 0/1 cases only trigger when every segment is that small.
- Shows/hides per-segment "Expand 1D FX" (map2D) and "Sound sim" controls in the Segments tab based on the selected effect's glyphs.
- The `▦` 2D filter button is hidden unless the device has a matrix (`index.js:669-673`).

There is no favorites feature in the stock UI. Ordering is alphabetical only.

## 4. Search and filter

Search box `index.htm:176-206`, logic `search()` `index.js:2913-2975`:
- Case-insensitive substring match on the rendered name (including glyphs).
- Non-matches get `display:none` unless they are the currently selected item. Item index 0 (Solid / Default) is never hidden in effect and palette lists.
- Matches are re-sorted by match position, then name, and the list is reordered in the DOM. First visible non-sticky result is scrolled into view.
- Clearing the palette search calls `populatePalettes()` to restore order; clearing effect search does not rebuild (order stays as last sorted until reload or next search).
- Typing in effect search clears all filter checkboxes; if any filter is checked, `search()` does nothing.

Filter checkboxes (`index.htm:180-205`, `filterFx()` `index.js:3013-3024`): `🎨` uses palette, `•` single pixel, `⋮` 1D, `▦` 2D, `♪` volume, `♫` frequency. Checked filters are ANDed (item must contain every checked glyph). The filter row is faded in on search-field focus and stays visible while any filter is checked (`filterFocus` `index.js:2988-3011`). Volume/frequency filters are always shown (the code to hide them without AudioReactive is commented out, `index.js:675-682`).

## 5. Effect controls (sliders, checkboxes, color slots)

`setEffectParameters(idx)` `index.js:1632-1752`, run when the selected effect changes and on every state update.

| Control | Element | Show condition | Label source | Sends |
|---|---|---|---|---|
| Speed | `#sliderSpeed` 0-255 `index.htm:220-227` | fxdata pos 0 non-empty, or no metadata | pos 0 text or "Effect speed" | `{"seg":{"sx":N}}` `index.js:2478-2482` |
| Intensity | `#sliderIntensity` 0-255 | pos 1 | pos 1 or "Effect intensity" | `{"seg":{"ix":N}}` `index.js:2484-2488` |
| Custom 1 | `#sliderC1` 0-255 | pos 2 | pos 2 or "Custom 1" | `{"seg":{"c1":N}}` `index.js:2490-2499` |
| Custom 2 | `#sliderC2` 0-255 | pos 3 | pos 3 or "Custom 2" | `{"seg":{"c2":N}}` |
| Custom 3 | `#sliderC3` 0-31 | pos 4 | pos 4 or "Custom 3" | `{"seg":{"c3":N}}` |
| Option 1-3 | `#checkO1..3` `index.htm:260-273` | fxdata field 0 has >5 entries and pos 5/6/7 non-empty | pos 5-7 text or "Check N" | `{"seg":{"o1":bool}}` etc. `index.js:2501-2509` |
| Freeze | icon on speed slider `index.htm:221` | always | - | `{"seg":{"frz":"t"}}` (toggle, all selected segments) `index.js:2427-2436` |
| Labels toggle | icon on intensity slider | always | - | UI-only (`cfg.comp.labels`) |
| Color slots 1-3 | `#csl0..2` on Colors tab | field 1 entry non-empty, or no metadata | first 2 chars of label on the button; `Fx`/`Bg`/`Cs` for `!`; `1/2/3` if no metadata | color picker sends `{"seg":{"col":[[],[],[]]}}` with only the active slot filled (covered in the color doc) |
| Palette list | `#palw` | segment has RGB (`hasRGB`) AND (no metadata OR palette field non-empty and non-numeric) | palette field text or "Color palette" | see section 7 |

Details:
- Slider labels are only applied as the `title` attribute. They appear as hover tooltips (`tooltip()` `index.js:3205-3242`); there is no visible text label. Checkbox labels are the same: each checkbox shows a fixed icon (palette, segments, presets glyphs) and the effect-specific name is only in the tooltip.
- Slider values are sent on `change` (release), not on `input`.
- Color slot labels longer than 2 chars produce a legend under the slot buttons, e.g. `Gl=Glitter color` (`#cslLabel`, `index.js:1691-1717`).
- When the effect hides a color slot but the selected palette is one of the color-derived palettes (IDs 2-5), the needed slots are force-shown (`updateSelectedPalette` `index.js:1350-1358`): ID 2 shows slot 1, ID 3 shows 1-2, IDs 4-5 show 1-3.
- Slider/checkbox values displayed are read from the first selected segment, or the main segment if none is selected (`readState` `index.js:1492-1537`).

### Selecting an effect

`setFX(id)` `index.js:2438-2453` sends:
```json
{"seg": {"fx": 42, "fxdef": true}}
```
`fxdef` comes from UI setting "Use effect default parameters" (`cfg.comp.fxdef`, default true). No `id` in `seg` means firmware applies it to every active, selected segment (`json.cpp:466-478`). Firmware behavior (`json.cpp:288-292`, `FX_fcn.cpp:711-747`):
- An `fx` key while a playlist is running (and not from a preset) unloads the playlist.
- Reserved IDs are skipped forward to the next real effect; out-of-range falls back to 0.
- With `fxdef` true, sliders/options/mapping/sound-sim/palette are reset to the effect defaults.

All commands also carry `"v":true`, `"time":<unix s>`, and `"transition":<tenths>` if the Transition field on the Segments tab differs from the last known value (`requestJson` `index.js:1764-1772`).

## 6. Palettes: list and IDs

### ID space (`const.h:9-24`)

| IDs | Kind | Name source |
|---|---|---|
| 0 | "Default" - renders the effect's default palette (`_default_palette`, Party if unset) | `/json/palettes` |
| 1 | "* Random Cycle" | same |
| 2 | "* Color 1" | same |
| 3 | "* Colors 1&2" | same |
| 4 | "* Color Gradient" | same |
| 5 | "* Colors Only" | same |
| 6-12 | FastLED palettes | same |
| 13-72 | gradient palettes | same |
| 200 downward (200, 199, ...) | user custom palettes, file `/palette<N>.json` maps to ID `200-N` | UI labels them `~ Custom N ~` |
| 255 downward | usermod palettes | `info.umpalnames[j]` -> ID `255-j` |

There are no negative palette IDs in this version (older WLED used them). Max custom palettes: `info.cpalmax` (129 on ESP32, 10 on ESP8266).

Custom palette gaps: firmware loads `/palette0.json`..`/palette<max>.json`; a missing file between existing ones becomes a solid gray (128,128,128) placeholder so later IDs stay stable (`colors.cpp:267-280`). `cpalcount` includes placeholders. The UI skips entries whose palx data is 16 entries all `[*,128,128,128]` (`index.js:1014`).

### Building the list

`populatePalettes()` `index.js:977-1027`:
1. `lJson = Object.entries(namesArray)` -> `[["0","Default"],...]` (IDs are strings).
2. Remove Default, sort the rest by name (`localeCompare`; the `* ...` dynamic palettes sort near the top), put Default back first (sticky).
3. Each item: `generateListItemHtml('palette', id, name, 'setPalette', '<div class="lstIprev" style="<gradient>">')`.
4. Append usermod palettes (unsorted), then custom palettes (unsorted).
5. Re-apply selection highlight.

Called twice on load: once right after `/json/palettes`, again after info + palx are loaded so custom/usermod entries and previews appear.

### Selecting a palette

`setPalette(id)` `index.js:2455-2470`:
```json
{"seg": {"pal": 7}}
```
Applied to all selected segments. Firmware ignores `pal` for segments without RGB capability (`lc & 1`) (`json.cpp:297-300`), and `setPalette` maps out-of-range custom/usermod IDs to 0 (`FX_fcn.cpp:749-757`).

### Preview gradients

`loadPalettesData()` `index.js:2855-2881`:
- Cache in `localStorage["wledPalx"]` as `{p: {...}, vid, pcount}`. Reused only if `vid == info.vid` and `pcount == info.palcount`. Settings > UI has a button that clears it (`settings_ui.htm:160-161`).
- Otherwise fetch `/json/palx?page=0..m` sequentially with 75 ms gaps, retry 5x per page, merge all `p` objects.

palx entry formats (`json.cpp:1016-1057`):
- `[index, r, g, b]` arrays (index 0-255 = gradient stop position)
- `"r"` = random color (palette 1: four `"r"`)
- `"c1"`, `"c2"`, `"c3"` = current segment color slot 1/2/3 (palettes 2-5)

`genPalPrevCss(id)` `index.js:1039-1082` builds `background: linear-gradient(to right, rgb(...) P%, ...)`. Stop position = `index/255*100`; for string entries position = `j/len*100`. `cN` entries read the current slot colors from the `#csl` buttons' `data-r/g/b`, so previews of palettes 2-5 change with the selected segment's colors. `"r"` entries get `Math.random()` colors on every redraw. A 1-entry palette is duplicated so the gradient has two stops. Previews are redrawn on every state read and slot selection (`redrawPalPrev`, `index.js:1029-1037`, called from `readState` and `selectSlot`).

The palette list has a search box (`index.htm:154-158`) using the same `search()` logic; no filter buttons.

### Custom palettes

The Colors tab has a "Palettes" button that navigates to `/cpal.htm` (`index.htm:145-148`), a separate editor page. It uploads `/palette<N>.json` via `/upload` and deletes with `{"rmcpal":N}` (`cpal.htm:457-533`, firmware `json.cpp:549-554`). The main UI has no inline custom palette editing. Editing colors of an existing custom palette does not change `palcount`, so the main UI's palx cache keeps showing the old preview until the cache is cleared or firmware `vid` changes.

### Palettes that depend on colors

IDs 2-5 derive from segment colors (and 1 is random). The UI handles this by force-showing color slots (section 5) and by recomputing previews from current colors. An effect whose palette field is empty still hides the palette list even if a color-based palette is selected.

## 7. Related segment-level controls driven by effect metadata

Rendered in the Segments tab but shown/hidden by the selected effect (`index.js:1399-1405`):
- "Expand 1D FX" (`m12`): shown only on 2D segments (width>1 and height>1) when the selected effect name lacks `▦`.
- "Sound sim" (`si`): shown only when the effect name contains `♪` or `♫` and the AudioReactive usermod is not active (`state.AudioReactive.on` false or absent).

See `segments.md` for their JSON.

## Replacement notes

**MVP scope (PRD sections 9-11):**
- Effect list from `/json/effects` + `/json/fxdata`, alphabetical with Solid first, skip `RSVD`, searchable.
- Per-effect controls driven by fxdata: speed/intensity/c1-c3 sliders, o1-o3 toggles, color slot visibility and labels, palette visibility and label. Show the labels as visible text, not tooltips.
- Effect selection with `fxdef:true` (make this a preference if desired).
- Palette list from `/json/palettes` + palx for gradient previews, plus custom (200 down) and usermod (255 down) IDs from `info`. Search.
- Favorites: not in stock WLED. Store per device in the app's `preferences` table keyed by device + effect ID (or effect name, since IDs can shift between firmware builds).

**Out of scope for MVP:** custom palette editor (link to `/cpal.htm` or the "Open WLED Advanced UI" escape hatch), 0D/1D/2D/audio filter chips (cheap to add later from the same flags), simplified UI mode.

**Gotchas:**
- `/json/effects` and `/json/fxdata` must be zipped by index. Parse fxdata on the server once per device per firmware `vid` and cache it; both lists are static for a given build plus usermods.
- Effect IDs are array indexes, not stable across firmware builds with different compile flags. Do not persist favorites by ID alone.
- `c3` is 0-31, not 0-255.
- Treat a missing flags field as `1`. Do not infer flags by string-matching glyphs like the stock UI does; keep structured data.
- The last-`;` defaults rule means a 4-field string may carry defaults in the "flags" slot. If you show defaults, apply the firmware's rule; to know what the firmware actually applied, re-read state after `fx` changes.
- `seg` objects without `id` apply to all selected segments. If no segment is selected, nothing changes. The replacement should either always send explicit `id`s or guarantee a selection.
- Palette changes are silently ignored on non-RGB segments. Hide the palette picker when no target segment has `lc & 1`.
- Palette 0 "Default" is effect-dependent; label it as such.
- palx previews for IDs 1-5 need the target segment's current colors; render `c1..c3` client side.
- Fetch palx pages sequentially. Devices return 503 under parallel load; the server-side WLED client should serialize requests per device.
- A selected effect change while a playlist runs unloads the playlist.
- After sending `fx`, the device may have changed `sx/ix/c1-3/o1-3/pal/m12/si/rev/mi`. Use the state echoed back (send `"v":true` or wait for the WebSocket push) instead of optimistic values.
