# Segments (stock WLED UI, 17.0.0-dev)

Source: `wled00/data/index.htm:277-311`, `wled00/data/index.js`. Firmware: `wled00/json.cpp`, `wled00/FX_fcn.cpp`, `wled00/FX.h`.

## 1. Data model

Segments come from `state.seg[]` (via `GET/POST /json/si` or the WebSocket push). Only active segments (stop > start) are serialized, so IDs can have gaps (`json.cpp:679-704`). Fields per segment (`serializeSegment`, `json.cpp:577-645`):

| Key | Meaning | Range / notes |
|---|---|---|
| `id` | segment index | 0 .. `info.leds.maxseg`-1 |
| `start`, `stop` | first LED, one past last LED (X on matrix) | stop exclusive |
| `startY`, `stopY` | rows on a matrix | only present when `info.leds.matrix` exists |
| `len` | stop - start | read-only; firmware also accepts `len` instead of `stop` on write |
| `grp` | grouping | 1-255 (0 -> 1) |
| `spc` | spacing | 0-255 |
| `of` | offset | normalized modulo length; negative counts from end (`json.cpp:174-181`) |
| `on` | segment power | bool or `"t"` (toggle) |
| `frz` | freeze | bool or `"t"` |
| `bri` | segment opacity | 0-255; 0 turns the segment off (`json.cpp:195-198`) |
| `cct` | white balance / CCT | 0-255 or Kelvin |
| `set` | segment "group" tag | 0-3 |
| `lc` | light capabilities | bit 0 RGB, bit 1 white, bit 2 CCT; read-only |
| `n` | name | max 32 chars (ESP8266) / 64 (`WLED_MAX_SEGNAME_LEN`, `const.h:175-183`) |
| `col` | 3 colors `[[r,g,b(,w)],...]` | |
| `fx, sx, ix, pal, c1, c2, c3, o1, o2, o3` | effect params | see effects doc |
| `sel` | selected | bool |
| `rev`, `mi` | reverse, mirror (X) | bool |
| `rY`, `mY`, `tp` | reverse Y, mirror Y, transpose | matrix only |
| `si` | sound simulation | 0 BeatSin, 1 WeWillRockYou, 2 10/13, 3 14/3 |
| `m12` | 1D->2D mapping | 0 Pixels, 1 Bar, 2 Arc, 3 Corner, 4 Pinwheel (firmware allows 0-7) |
| `bm` | blend mode | 0-16 (see 4.6) |

State-level keys used here: `mainseg`, `ledmap`, `transition`, `bs`. Info keys: `leds.count`, `leds.maxseg` (16 ESP8266, 32 ESP32/S2, 64 ESP32 with PSRAM; `FX.h:85-97`), `leds.matrix.{w,h}`, `maps[]`, `simplifiedui`, `arch`.

## 2. Rendering the list

`populateSegments(s)` `index.js:750-928` rebuilds `#segcont` from scratch on every state update (each WS push). Per segment `i`, a `div.seg.lstI#seg{i}` with `data-set` = `set`:

Header row (always visible):
- **Select checkbox** `#seg{i}sel` (hidden in simplified UI) -> `selSeg(i)`.
- **Freeze icon** `#seg{i}frz` -> `tglFreeze(i)`. Icon: snowflake-off (e325) when not frozen, e0e8 when frozen, e410 when it is the live (realtime) segment and frozen.
- **Name**: `n` or "Segment {i}". Clicking the name -> `selSegEx(i)` (exclusive select).
- **Group/set icon** (popup with 4 colored numbers) -> `setGrp(i, g)`. Hidden unless the highest segment ID > 2 (`resetUtil`, `index.js:1957`).
- **Edit (pencil) icon** `#seg{i}nedit` -> `tglSegn(i)` shows/focuses the name input.
- **Expand icon** `#sege{i}` -> `expand(i)` toggles `expanded` class, which reveals the editor body.
- The main segment (`i == s.mainseg`) gets class `selected` (highlight), except in simplified UI.

Power/opacity row `#segp{i}` (`index.js:774-780`):
- Power icon `#seg{i}pwr` -> `setSegPwr(i)`; slider `#seg{i}bri` 1-255 -> `setSegBri(i)` on change.
- Placement controlled by UI setting "Hide segment power & brightness" (`cfg.comp.segpwr`): off (default) -> row placed after the editor and always visible via CSS var `--sgp:block`; on -> row placed before the editor and only visible when expanded (`index.js:847`, `894`, `110`; `index.css:1074-1079`).
- With a single segment at bri 255 and on, the row is hidden (`index.js:911`).

Editor body `#seg{i}in` (visible when expanded):

| Control | Element | Show condition | Notes |
|---|---|---|---|
| Name | text `#seg{i}t`, maxlength 32/64 by arch | hidden until the pencil icon is clicked (the pencil itself only shows when the card is expanded; `index.css:721`, `1505`) | only sent when Update is pressed |
| Start LED / Start X | number `#seg{i}s` | always | min 0, max `ledCount-1` (1D) or `mw-1` (matrix segment) |
| Stop LED / Stop X (or "LED count" / "Width") | number `#seg{i}e` | always | max `ledCount` or `mw`. Label/semantics switch to length when UI setting "Set segment length instead of stop LED" (`cfg.comp.seglen`) is on: displayed value = stop - start |
| Offset | number `#seg{i}of` | 1D segments only (hidden on matrix segments) | no min/max in UI |
| Start Y, Stop Y (or Height) | `#seg{i}sY`, `#seg{i}eY` | matrix segments (`isM && start < mw*mh`) | max `mh-1` / `mh` |
| Mirror X / Reverse X | checkboxes in offset column | matrix segments | `mi`, `rev` |
| Mirror Y / Reverse Y | checkboxes row 2 | matrix segments | `mY`, `rY` |
| Grouping | `#seg{i}grp` 1-255 | always | |
| Spacing | `#seg{i}spc` 0-255 | always | |
| Update button | check icon | always | `setSeg(i)`; Enter in any number field also calls `setSeg(i)` (`segEnter`, `index.js:2702-2704`). Enter in the name field does nothing. |
| Length readout | `#seg{i}len` | always | "N LEDs", "1 LED", or "(delete)" if length < 1; adds "(V virtual)" when grouping>1 or spacing>0 (`ceil(len/(grp+spc))`); adds "[strip]" for trailing 1D segments after a matrix (`updateLen`, `index.js:1193-1264`) |
| Blend mode | select `#seg{i}bm` | always | `setBm(i)` |
| Reverse direction | `#seg{i}rev` | 1D segments | `setRev(i)` |
| Expand 1D FX | select `#seg{i}m12` | matrix segment with width>1 and height>1, and the current effect is not 2D (name lacks `▦`) | `setM12(i)` |
| Sound sim | select `#seg{i}si` | AudioReactive usermod not on, and current effect has `♪` or `♫` | `setSi(i)` |
| Mirror effect (1D) / Transpose (2D) | `#seg{i}mi` or `#seg{i}tp` | always; Transpose hidden and unchecked on 1-row/1-column segments of a matrix | `setMi(i)` / `setTp(i)` |
| Repeat until end | button `#segr{i}` | only on the highest-ID segment, only 1D, only if its stop < `ledCount`, and only if another segment can be added | `rptSeg(i)` |
| Delete | button `#segd{i}` | hidden when only one segment exists | `delSeg(i)` |

In simplified UI the select checkbox, name editing, expand and editor are hidden; with one segment the whole list is hidden (`index.js:789`, `913`).

UI setting "Always expand first segment" (`cfg.comp.segexp`) keeps segment 0 expanded across re-renders (`index.js:764`). Otherwise expansion state is preserved by checking the old DOM before re-render.

Below the list:
- `#segutil`: "Add segment" bar with **Select all** checkbox `#selall` and a group-select popup (`resetUtil`, `index.js:1943-1958`). The bar is disabled (class `off`, no click) when `lowestUnused >= maxseg`.
- `#segutil2`: **Reset segments** button, shown only when there is more than one segment.
- **Transition** number input `#tt` (seconds, 0-65.5, step 0.1) and **Blending style** select `#bs` (`index.htm:287-309`).
- **Ledmap** select `#ledmap`, shown only if `info.maps.length > 1`.

## 3. Selection, main segment, and how other controls apply

- Selection is a per-segment `sel` flag stored on the device. Effect, palette, color, CCT, speed/intensity/custom/options and the Effects-tab freeze are all sent as `{"seg":{...}}` **without `id`**, which firmware applies to every active segment with `sel:true` (`json.cpp:466-478`). If no segment is selected, those commands change nothing; the UI does not guard against this.
- The UI shows values from the first selected segment in ID order; if none is selected, from `mainseg` (`readState`, `index.js:1492-1517`). `hasRGB/hasWhite/hasCCT/has2D` are ORed over selected segments' `lc` and geometry and decide which color controls appear.
- `mainseg` is a firmware state value. Firmware only accepts an active segment; otherwise it falls back to the last active one (`FX_fcn.cpp:2023-2029`). It cannot change while in realtime mode (`json.cpp:443`). It is changed by the UI only through `selSegEx`.
- Selection changes do not mark state as changed (no preset deselect, no sync broadcast) (`json.cpp:363`).

Selection commands:

| Action | Function | JSON |
|---|---|---|
| Toggle one checkbox | `selSeg` `index.js:2259-2264` | `{"seg":{"id":i,"sel":true\|false}}` |
| Click segment name | `selSegEx` `index.js:2251-2257` | `{"seg":[{"id":0,"sel":false},{"id":i,"sel":true},...],"mainseg":i}` (one entry per existing segment) |
| Select all / none | `selSegAll` `index.js:2244-2249` | `{"seg":[{"id":0,"sel":X},{"id":1,"sel":X},...]}` |
| Select group g | `selGrp` `index.js:2266-2277` | array with all `sel:false`, then entries with `set==g` replaced by `sel:true` |
| Assign group | `setGrp` `index.js:2406-2412` | `{"seg":{"id":i,"set":g}}` (g 0-3) |

`selGrp` writes `obj.seg[i]` using the segment ID as the array index. With ID gaps this misaligns entries (overwrites the wrong one or leaves `null` holes).

## 4. Editing commands

All go through `requestJson` (`index.js:1756-1819`): WebSocket if open and payload <= 1340 bytes (<= 500 on ESP8266), else `POST /json/si`. Every command gets `"v":true`, `"time"`, and `"transition"` if `#tt` changed.

### 4.1 Update geometry: `setSeg(i)` `index.js:2304-2337`

```json
{"seg":{"id":2,"n":"Patio","start":12,"stop":37,
        "startY":0,"stopY":8,          // only matrix segments
        "grp":1,"spc":0,"of":0,        // only for existing segments (not in the new-segment form)
        "tp":false}}                   // only on matrix, if the checkbox exists
```
Validation before sending:
- If start is outside the input's min/max, the field is reset to min and nothing is sent (silent).
- If stop is outside, the field is reset to max and nothing is sent (silent).
- If stop <= start (or length 0 in length mode) the segment is deleted via `delSeg(i)`.
- Same min/max check for startY/stopY.
- The global numeric-input limiter skips IDs starting with `seg` (`index.js:315-329`) because trailing strips after a matrix need special ranges (`updateLen` adjusts min/max: trailing segment start in `[mw*mh, ledCount-1]`, stop in `[mw*mh+1, ledCount]`).
- No overlap check. Overlapping segments are legal; firmware blends them in ID order using each segment's blend mode (`FX_fcn.cpp:1885-1886`).

`n` is always sent. Firmware clears the name if bounds change and `n` is absent (`json.cpp:144-151`).

Firmware sanitizing (`Segment::setGeometry`, `FX_fcn.cpp:552-603`): stop <= start disables the segment; invalid start keeps the old start; stop is clamped to matrix width or total length; grouping 0 -> 1 with spacing 0; offset clamped.

### 4.2 Create: `makeSeg()` `index.js:1899-1941`

Clicking "Add segment" renders a form in `#segutil` for ID `lowestUnused` (lowest ID not present in `state.seg`, computed in `populateSegments`):
- Name input (placeholder "New segment N", maxlength 32).
- Start default: on 1D, the previous segment's (ID `lu-1`) stop if it is < `ledCount`, else 0. On a matrix, 0.
- Stop default: `ledCount` (1D) or `mw` (matrix). In length mode, `ledCount - start`.
- Start Y / Stop Y rows on matrix: defaults 0 and `mh`.
- Confirm -> `setSeg(lu)` (no grp/spc/of). Cancel -> `resetUtil()`.

Firmware: an `id` >= current segment count appends a new segment at the end of the vector (actual ID may differ from the requested one); a lower unused ID reuses that inactive slot. New segments created from the UI get color 0 set to the default orange (`json.cpp:79-90`). Requests with `stop <= 0` for a non-existent ID are ignored. IDs >= `maxseg` are rejected.

### 4.3 Delete: `delSeg(i)` `index.js:2339-2348`

`{"seg":{"id":i,"stop":0}}`. Refused client-side with a toast when fewer than 2 segments exist. Firmware marks it inactive; if it was the main segment, mainseg becomes 0 (`json.cpp:187-190`). When an array request deletes at least half of >3 segments, firmware purges them (`json.cpp:481-488`).

### 4.4 Repeat until end: `rptSeg(i)` `index.js:2279-2302`

`{"seg":{"id":i,"n":..,"start":..,"stop":..,"rev":..,"mi":..,"on":..,"bri":..,"sel":..,"grp":..,"spc":..,"of":..,"rpt":true}}`. Firmware copies the segment's length and settings into following IDs until the strip ends or `maxseg` is reached, alternating `rev` each copy and dropping the name (`json.cpp:125-140`). 1D only.

### 4.5 Reset segments: `rSegs()` `index.js:2841-2853`

Two-click confirm ("Reset segments" -> "Confirm reset"). Sends `{"rSeg":true}`. Firmware calls `makeAutoSegments(true)` (`json.cpp:493-499`, `FX_fcn.cpp:2112-2182`): with "auto segments" enabled in LED settings, one segment per bus (plus one segment for the whole matrix, overlapping buses merged), each with default orange color; otherwise a single full-length segment.

### 4.6 Per-segment toggles and selects

| Control | Function | JSON |
|---|---|---|
| Reverse (X) | `setRev` `index.js:2350` | `{"seg":{"id":i,"rev":bool}}` |
| Reverse Y | `setRevY` `index.js:2357` | `{"seg":{"id":i,"rY":bool}}` |
| Mirror (X) | `setMi` `index.js:2364` | `{"seg":{"id":i,"mi":bool}}` |
| Mirror Y | `setMiY` `index.js:2371` | `{"seg":{"id":i,"mY":bool}}` |
| Transpose | `setTp` `index.js:2399` | `{"seg":{"id":i,"tp":bool}}` |
| Expand 1D FX | `setM12` `index.js:2378` | `{"seg":{"id":i,"m12":0-4}}` (option index) |
| Sound sim | `setSi` `index.js:2385` | `{"seg":{"id":i,"si":0-3}}` |
| Blend mode | `setBm` `index.js:2392` | `{"seg":{"id":i,"bm":"N"}}` (value sent as a string; firmware parses it). 0 Top/Default, 1 Bottom/None, 2 Add, 3 Subtract, 4 Difference, 5 Average, 6 Multiply, 7 Divide, 8 Lighten, 9 Darken, 10 Screen, 11 Overlay, 12 Hard Light, 13 Soft Light, 14 Dodge, 15 Burn, 16 Stencil |
| Power | `setSegPwr` `index.js:2414` | `{"seg":{"id":i,"on":!current}}` |
| Opacity | `setSegBri` `index.js:2421` | `{"seg":{"id":i,"bri":1-255}}` |
| Freeze (row icon) | `tglFreeze(i)` `index.js:2427` | `{"seg":{"id":i,"frz":"t"}}`; if `i` is the live segment during realtime: `{"lor":1}` instead |
| Ledmap | inline `index.js:918-926` | `{"ledmap":id}` (option label: "Default" for 0, `maps[].n`, or `ledmap{id}.json`) |
| Transition | `#tt` | not sent on change. Piggybacked as `"transition": seconds*10` on the next command. Value 0 hides the blending-style select. |
| Blending style | `#bs` | `{"bs":N}`. 2D-only styles (6-15, 18, 19) removed from the list when there is no matrix (`index.js:665-668`) |

Changing `mi`, `mY` or `tp` restarts the effect (`json.cpp:169-171`). Segment CCT has no control in the segment card; it is the white-balance slider on the Colors tab, applied to selected segments.

## 5. Behaviors worth knowing

- **Rebuild on every update**: the whole segment list HTML is regenerated on each state message. Unsaved edits in an expanded segment form (start/stop typed but not submitted) are lost if any state update arrives (another client, effect animation state change, etc.).
- **Max segments**: Add segment is disabled at `lowestUnused >= maxseg`, not at `count >= maxseg`.
- **LED count validation** is per field min/max only. There is no visual layout, no overlap warning, and no indication of LEDs not covered by any segment.
- **Invalid segments** (stop <= start) are treated as delete requests both by the UI and firmware.
- **Name** is only saved by the Update button; there is no rename-only action.
- **Length mode** (`seglen`) changes what the stop field means but the UI always converts back to an absolute `stop` before sending.
- **2D**: a "matrix segment" is any segment with `start < mw*mh` when a matrix is configured. Segments starting beyond the matrix are 1D trailing strips with their own ranges, `startY=0`, `stopY=1`, and get offset/reverse like 1D.
- **Group/set icons** only appear once a segment with ID >= 3 exists.

## Replacement notes

**MVP scope (PRD sections 12-14):**
- List segments with name, range, on/off, opacity.
- Create, rename, resize (drag handles mapping to `start`/`stop`), delete, reverse, select. Per-segment effect/palette selection = select target segment(s) then send effect/palette, or send `{"seg":[{"id":N,"fx":..}]}` with explicit IDs.
- Visual strip designer: needs `info.leds.count`, `info.leds.maxseg`, `state.seg[].start/stop`. For 2D devices, `info.leds.matrix.{w,h}` and `startY/stopY`.
- LED identification ("Flash start/end"): the stock UI has no such feature. Feasible via `{"seg":{"id":N,"i":[index,"FF0000"]}}` (individual LED set, `json.cpp:314-361`), which freezes the segment and blacks it out first, so it must be undone (send `frz:false` or restore the previous state). Alternative: a temporary segment. Either way capture and restore state.
- Grouping, spacing, offset, mirror: small additions, include in an "advanced" section of the segment editor.

**Out of scope for MVP:** segment sets/groups (`set`), blend modes, sound simulation, 1D->2D mapping, transpose and Y mirror/reverse, repeat-until-end, ledmap switching, blending styles. Keep 2D devices working read-only or with basic X/Y bounds.

**Gotchas:**
- Always send `n` along with changed `start`/`stop`, or firmware wipes the name.
- Deleting is `stop:0`. Firmware does not compact IDs. New segment IDs should be the lowest unused ID; the device may still append at the end if the ID is past its vector size, so re-read state after create.
- Overlaps are allowed and composited by ID order. A visual designer should allow and display overlap rather than block it, or warn.
- `stop` is exclusive. A drag handle on LED 37 as the last lit LED means `stop: 38`.
- Commands without `id` hit all selected segments. Make the replacement's targeting explicit (send IDs) and decide whether to mirror selection to the device (`sel`) since other WLED clients and presets use it.
- Selection changes do not trigger a state broadcast in some paths; re-read state after selection changes if the UI relies on it.
- Do not re-render segment editors from every WebSocket push while the user is dragging or typing; merge incoming state carefully.
- WebSocket frames over 1340 bytes (500 on ESP8266) should go over HTTP POST `/json/state` instead.
- `bri` is opacity on top of global brightness; 0 turns the segment off.
- `maxseg` varies by hardware (16/32/64).
