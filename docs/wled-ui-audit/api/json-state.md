# WLED JSON API: state (GET and POST)

Source: WLED 17.0.0-dev (`VERSION 2607201`, `wled00/wled.h:10`). All line references are into `/Users/seanmcgary/Code/WLED`.

## Routing

| Request | Handler | Notes |
|---|---|---|
| `GET /json/state` | `serializeState()` | `wled00/json.cpp:1359`, `:1396` |
| `GET /json/si` | `{"state":…, "info":…}` | `wled00/json.cpp:1361`, `:1412` |
| `GET /json` | `{"state","info","effects","palettes"}` | `wled00/json.cpp:1413-1423` |
| `POST/PUT/PATCH /json` or `/json/<anything>` except URLs containing `cfg` | `deserializeState()` | `wled00/wled_server.cpp:422-476` |

The POST handler is `AsyncCallbackJsonWebHandler` from WLED's bundled copy (`wled00/src/dependencies/json/AsyncJson-v6.h:106-158`). It accepts POST, PUT and PATCH, matches `/json` and any `/json/...` sub-path, and does **not** check `Content-Type` (`AsyncJson-v6.h:124-135`). So `POST /json/state`, `POST /json/si`, `POST /json/info` and `POST /json` all apply state identically. Only the response differs when `"v":true` is set (see below).

Sub-path detection in `serveJson()` is substring based (`url.indexOf("state") > 0` etc., `wled00/json.cpp:1359-1382`), not exact match.

### POST response

- Body not parseable / empty: `400` with `{"error":9}` (`wled_server.cpp:433-436`). Empty body or body ≥16384 bytes never reaches the callback: the handler answers `400` or `413` with no JSON body (`AsyncJson-v6.h:139-155`).
- Without `"v":true`: `200 {"success":true}` (`wled_server.cpp:475`).
- With `"v":true`: the server calls `serveJson(request)` for the same URL (`wled_server.cpp:461-470`). `POST /json/state` returns state, `POST /json/si` returns state+info, `POST /json` returns state+info+effects+palettes. It also sets `lastInterfaceUpdate=millis()` and schedules a WS broadcast after the 1 s cooldown.
- If the request contains `"ps"` that triggers a preset load, `deserializeState()` returns early (`json.cpp:537-538`). The preset is applied asynchronously in the main loop (`presets.cpp:127-134`, `:145-215`), so a `"v":true` response reflects state **before** the preset is applied.
- If `"pin"` is present at top level it is checked against the settings PIN for any `/json` POST, not only `/json/cfg` (`wled_server.cpp:438`).

## GET /json/state response

Produced by `serializeState(root, forPreset=false, includeBri=true, segmentBounds=true, selectedSegmentsOnly=false)` (`wled00/json.cpp:648-704`, defaults in `wled00/fcn_declare.h:188`).

| Key | Type | Meaning | Source |
|---|---|---|---|
| `on` | bool | `bri > 0` | `json.cpp:651` |
| `bri` | 0-255 | **`briLast`**, the last non-zero brightness. When off, `on:false` and `bri` stays at the pre-off value. | `json.cpp:652` |
| `transition` | int | Default transition in units of 100 ms (`transitionDelay/100`) | `json.cpp:653` |
| `bs` | int | Blending (transition) style, 0..0x1F; see `TRANSITION_*` in `wled00/FX.h:382-408` | `json.cpp:654` |
| `error` | int | Present only if `errorFlag != 0`. **Cleared after being serialized once** (`errorFlag = ERR_NONE`), so only the first reader sees it. Codes are in the table below. | `json.cpp:658` |
| `ps` | int | Current preset ID 1-250, or `-1` | `json.cpp:660` |
| `pl` | int | Current playlist preset ID, `-1` if none. `0` means an ad-hoc playlist sent directly through the API (not from a preset) is running (`playlist.cpp:146`). | `json.cpp:661` |
| `ledmap` | int | Currently loaded ledmap index | `json.cpp:662` |
| *(usermod keys)* | object | `UsermodManager::addToJsonState()`, e.g. AudioReactive | `json.cpp:664` |
| `nl.on` | bool | Nightlight active | `json.cpp:667` |
| `nl.dur` | 0-255 | Nightlight duration, minutes | `json.cpp:668` |
| `nl.mode` | 0-3 | 0 instant, 1 fade, 2 color fade, 3 sunrise (`const.h:538-541`) | `json.cpp:669` |
| `nl.tbri` | 0-255 | Target brightness | `json.cpp:670` |
| `nl.rem` | int | Seconds remaining, `-1` if inactive | `json.cpp:671` |
| `udpn.send` | bool | Send UDP sync notifications | `json.cpp:674` |
| `udpn.recv` | bool | `receiveGroups != 0` | `json.cpp:675` |
| `udpn.sgrp` | 0-255 | Send group bitmask | `json.cpp:676` |
| `udpn.rgrp` | 0-255 | Receive group bitmask | `json.cpp:677` |
| `lor` | 0-2 | Live override: 0 none, 1 until live ends, 2 always (`const.h:311-313`) | `json.cpp:679` |
| `mainseg` | int | Main segment ID | `json.cpp:682` |
| `seg` | array | Active segments only (see next table). Inactive slots are skipped, so **segment IDs can be non-contiguous**. | `json.cpp:684-703` |

### Segment object (GET)

`serializeSegment()` (`wled00/json.cpp:577-646`).

| Key | Type | Meaning |
|---|---|---|
| `id` | int | Index in the segment vector (stable while the slot exists) |
| `start` | int | Start LED (1D) or start X (2D) |
| `stop` | int | Stop LED/X, exclusive |
| `startY`, `stopY` | int | 2D only; emitted only when `strip.isMatrix` and 2D is compiled in (`json.cpp:583-588`) |
| `len` | int | `stop - start` (not emitted in presets) |
| `grp` | int | Grouping |
| `spc` | int | Spacing |
| `of` | int | Offset |
| `on` | bool | Segment on |
| `frz` | bool | Frozen (effect paused) |
| `bri` | 1-255 | Segment opacity; 0 is reported as 255 (`json.cpp:596-597`) |
| `cct` | 0-255 | White balance; 0=1900K, 255=10091K (`FX.h:470`) |
| `set` | 0-3 | UI "set" (grouping tag) |
| `lc` | bitmask | Light capabilities: 0x01 RGB, 0x02 W slider, 0x04 CCT (`const.h:477-479`, `FX_fcn.cpp:1153-1185`) |
| `n` | string | Name, only if set |
| `col` | `[[r,g,b(,w)],[…],[…]]` | 3 color slots: primary, secondary(bg), tertiary. 4 elements per color only if any bus has a white channel (`strip.hasWhiteChannel()`, `json.cpp:608`) |
| `fx` | int | Effect ID |
| `sx` | 0-255 | Speed |
| `ix` | 0-255 | Intensity |
| `pal` | int | Palette ID (see palette ID ranges in json-info-and-lists.md) |
| `c1`, `c2` | 0-255 | Custom sliders |
| `c3` | 0-31 | Custom slider 3 (5-bit) |
| `sel` | bool | Selected |
| `rev` | bool | Reverse |
| `mi` | bool | Mirror |
| `rY`, `mY`, `tp` | bool | Reverse Y, mirror Y, transpose; only when `strip.isMatrix` (`json.cpp:633-639`) |
| `o1`, `o2`, `o3` | bool | Effect checkboxes |
| `si` | 0-3 | Sound simulation mode |
| `m12` | 0-7 | 1D→2D mapping: 0 pixels, 1 bar, 2 arc, 3 corner, 4 pinwheel (`FX.h:433-437`) |
| `bm` | 0-255 | Segment blend mode (top, bottom, add, subtract, …, `FX.h:484`) |

## POST state: top-level keys

Processed in `deserializeState()` (`wled00/json.cpp:370-575`) in the order below. Order matters for interactions.

Common value syntax, from `getVal()` / `parseNumber()` / `getBoolVal()` (`wled00/util.cpp:43-111`):

- **Integer**: assigned directly to a `byte`. Negative ints are ignored (`util.cpp:87-88`). Ints are **not clamped** to the min/max passed to `getVal`; values >255 wrap (byte truncation).
- **String forms** (up to 12 chars):
  - `"~"`: +1, wrapping max→min. `"~-"`: -1, wrapping. `"~0"`: no-op.
  - `"~N"` / `"~-N"`: add N, clamped to [min,max].
  - `"w~N"`: like `~N` but wraps when already at the limit.
  - `"r"`: random in [min,max] (max 0 is treated as 255).
  - `"A~B~"`, `"A~B~-"`, `"A~Br"`: cycle / random within an explicit range A..B. For strings longer than 3 chars containing `r` or two `~`, the caller's min/max are ignored and the embedded range is used (`util.cpp:93-96`).
  - Any other string: `atoi()`.
- **Bool toggle**: any string starting with `t` inverts the current value (`util.cpp:105-110`). Otherwise normal JSON bool/int coercion.

| Key | Type / range | Effect | Source |
|---|---|---|---|
| `bri` | 0-255, `getVal` forms | Global brightness. Change sets `stateChanged`. `bri:0` turns off. | `json.cpp:380-381` |
| `on` | bool or `"t"` | On/off. Defaults to `bri>0` if absent. `"t"` toggles, except it will not toggle off something that `bri` in the same request just turned on (`{"on":"t","bri":32}` works). Turning on unfreezes all segments (live segment stays frozen in main-segment-only live mode). | `json.cpp:383-397` |
| `transition` | int, ×100 ms | Sets the persistent transition (`transitionDelay`, uint16 ms, so values >655 overflow). Ignored when called from a preset while a playlist is running. | `json.cpp:399-406`, `wled.h:598` |
| `bs` | 0-31 | Blending style, masked `& 0x1F` | `json.cpp:408-409` |
| `tt` | int, ×100 ms | One-shot transition for this request only | `json.cpp:412-416` |
| `tb` | unsigned long | Effect timebase; sets `strip.timebase = tb - millis()` | `json.cpp:418-419` |
| `nl.on` | bool / `"t"` | Nightlight active. Any `nl` object sets `stateChanged`. | `json.cpp:421-423` |
| `nl.dur` | 0-255 | Minutes | `json.cpp:424` |
| `nl.mode` | 0-3 | Not clamped here | `json.cpp:425` |
| `nl.tbri` | 0-255 | Target brightness | `json.cpp:426` |
| `udpn.send` | bool / `"t"` | Runtime UDP send toggle | `json.cpp:429` |
| `udpn.sgrp` | 0-255 | Send groups | `json.cpp:430` |
| `udpn.rgrp` | 0-255 | Receive groups | `json.cpp:431` |
| `udpn.nn` | bool | Suppress UDP notification for this request only | `json.cpp:432` |
| `time` | unix seconds (UTC) | Sets device clock. Applied if the device's time source is less accurate than "JSON", **or if it differs by ≥60 s even when NTP-synced** (`wled00/ntp.cpp:579-591`). The stock UI sends this on every request (`wled00/data/index.js:1766`). | `json.cpp:434-438` |
| `rb` | bool | Reboot. Ignored if `psave` is in the same request. | `json.cpp:440` |
| `mainseg` | int | Main segment. Ignored while in realtime mode; must be an active segment or it falls back to the last active one (`FX_fcn.cpp:2023-2029`). | `json.cpp:443` |
| `lor` | 0-2 | Realtime override; >2 becomes 2. In main-segment-only live mode it freezes/unfreezes the main segment and resets to 0. | `json.cpp:445-450` |
| `live` | bool | `true`: enter generic realtime mode with no timeout (`realtimeLock(65000)` → infinite, `udp.cpp:429-431`), transition 0. `false`: `exitRealtime()`. | `json.cpp:452-460` |
| `seg` | object or array | See segment section. Strip is suspended while segments change. | `json.cpp:462-491` |
| `rSeg` | bool | Reset segments to auto segments (one per bus if `light.aseg`) | `json.cpp:493-499` |
| *(usermod keys)* | any | `UsermodManager::readFromJsonState()` | `json.cpp:501` |
| `ledmap` | int | Load `/ledmap<N>.json` (0 = `/ledmap.json`) in the main loop | `json.cpp:503`, `wled.cpp:249-252` |
| `psave` | 1-250 | Save preset (see preset section) | `json.cpp:505-506` |
| `pdel` | 1-250 | Delete preset (writes an empty object for that ID) | `json.cpp:508-509`, `presets.cpp:280-285` |
| `win` | string | Legacy HTTP API query string applied via `handleSet()` (e.g. `"win":"&A=128&FX=5"`) | `json.cpp:512-517` |
| `pd` | int | "Preset direct": the request already contains the preset's content; marks `pd` as current preset. Only effective when the request also changed state. | `json.cpp:524-529` |
| `ps` | 1-250 or `getVal` string | Load preset. Skipped if `win` is present or ID equals the current preset. Accepts `"1~5~"` (cycle 1..5), `"~"`/`"~-"` (next/prev, wrapping over 1..250), `"r"`, `"1~5r"`. **Async**: queued and applied in the main loop. Applying a preset unloads any running playlist (`presets.cpp:129`). | `json.cpp:530-540` |
| `playlist` | object | Start an ad-hoc playlist (`pl` becomes 0 unless from a preset). See playlist section. | `json.cpp:542-547` |
| `rmcpal` | int | Delete `/palette<N>.json` and reload custom palettes. **N is the file index, not the palette ID** (palette ID = 200 − N). | `json.cpp:549-554` |
| `np` | bool | Advance running playlist to next entry | `json.cpp:556` |
| `wifi.ap` | bool | Start/stop the soft AP immediately | `json.cpp:558-569` |
| `v` | bool | Verbose: respond with full state (see POST response) | `json.cpp:372` |
| `pin` | string | Settings PIN (HTTP handler only, not WS) | `wled_server.cpp:438` |
| `debug` | bool | Network debug toggle; only in `WLED_DEBUG && WLED_DEBUG_HOST` builds | `json.cpp:374-376` |

After processing, `stateUpdated(callMode)` runs if anything changed (`json.cpp:571`), which clears `currentPreset` (`led.cpp:159-160`), sends a UDP sync notification unless suppressed, and schedules a WebSocket broadcast (see websocket.md).

## POST state: `seg`

### Addressing

- `seg` as **object without `id`**: applied to every active segment that is currently **selected** (`json.cpp:469-478`). This is how the stock UI's "apply to selected" works. If nothing is selected, nothing changes.
- `seg` as **object with `id`**: applied to that segment only.
- `seg` as **array**: element *i* applies to segment *i* unless the element has its own `id` (`json.cpp:72`, `:483-487`).
- `id >= maxseg` → ignored (`json.cpp:73`).
- `id >= current segment count`: a new segment is appended **only if `stop > 0`** in that element, and it gets the next free index regardless of the requested `id` (`json.cpp:79-84`). A new segment created outside a preset has primary color set to `0xFFA000` (`json.cpp:88-90`, `FX.h:45`).
- Deleting: `{"id":N,"stop":0}`. The slot becomes inactive and disappears from GET output, but stays in the vector, so IDs of later segments do not shift. If an array request deletes at least half of the segments and more than 3 exist, `purgeSegments()` removes inactive slots, which **renumbers** later segments and resets `mainseg` to 0 (`json.cpp:488`, `FX_fcn.cpp:2077-2090`).

### Segment keys

| Key | Type / range | Behaviour | Source |
|---|---|---|---|
| `id` | int | Target segment | `json.cpp:72` |
| `start` | int | Start LED/X. Invalid values keep the old start (`FX_fcn.cpp:557-561`). | `json.cpp:116` |
| `stop` | int | Stop (exclusive). `stop <= start` deactivates the segment. Clamped to matrix width / total length. | `json.cpp:76`, `FX_fcn.cpp:553-575` |
| `len` | int | Used only when `stop` is absent: `stop = start + len` | `json.cpp:117-120` |
| `startY`, `stopY` | int | 2D rows. `startY >= height` → 0; `stopY` clamped to [1,height]. Ignored on 1D (forced 0/1). | `json.cpp:122-123`, `FX_fcn.cpp:577-593` |
| `rpt` | bool | Repeat: clone this segment's length into successive segments until the strip or `maxseg` is exhausted, alternating `rev`. 1D only. | `json.cpp:126-142` |
| `n` | string | Name, truncated to 32 (ESP8266) / 64 (ESP32) chars (`const.h:174-188`). `""` clears. **If `n` is absent and `start` or `stop` changes, the name is cleared.** | `json.cpp:144-151`, `FX_fcn.cpp:764-781` |
| `grp` | int | Grouping. Stored as uint8 (values >255 truncate). 0 becomes 1 and forces `spc=0`. | `json.cpp:153`, `FX.h:470`, `FX_fcn.cpp:595` |
| `spc` | int | Spacing, uint8 | `json.cpp:154` |
| `of` | int | Offset. Negative allowed; normalized modulo segment length; capped at `len-1`. | `json.cpp:174-182` |
| `si` | 0-3 | Sound sim, clamped | `json.cpp:156`, `:278` |
| `m12` | 0-7 | 1D→2D mapping, clamped | `json.cpp:157`, `FX_fcn.cpp:597` |
| `set` | 0-3 | UI set, clamped | `json.cpp:158`, `:277` |
| `sel` | bool / `"t"` | Selected. Selection-only changes do **not** set `stateChanged` (no UDP/WS broadcast) (`json.cpp:362-363`). | `json.cpp:159` |
| `rev` | bool / `"t"` | Reverse | `json.cpp:160` |
| `mi` | bool / `"t"` | Mirror; change resets the effect | `json.cpp:161`, `:169` |
| `rY`, `mY`, `tp` | bool / `"t"` | 2D reverse-Y / mirror-Y / transpose; `mY`/`tp` change resets the effect. Not parsed if built with `WLED_DISABLE_2D`. | `json.cpp:162-172` |
| `bri` | 0-255 or `getVal` | Opacity. `0` turns the segment **off** and leaves opacity unchanged; `>0` sets opacity and turns the segment on. | `json.cpp:194-198` |
| `on` | bool / `"t"` | Segment on (with transition) | `json.cpp:200` |
| `frz` | bool / `"t"` | Freeze | `json.cpp:201` |
| `cct` | 0-255 or Kelvin | Values >255 are Kelvin, clamped to 1900-10091 and mapped to 0-255 | `json.cpp:203`, `FX_fcn.cpp:676-690` |
| `col` | array of up to 3 | Each slot may be: `[r,g,b]` or `[r,g,b,w]`; `{"r":..,"g":..,"b":..,"w":..}` (any subset, others kept); hex string `"RRGGBB"` or `"RRGGBBWW"`; `"r"` random; int Kelvin (0 = black). Empty array or `null` leaves the slot unchanged. On segments with no RGB and no W capability (on/off buses), any `col` sets primary white / secondary black. | `json.cpp:205-263`, `colors.cpp:564-582` |
| `lx`, `ly` | int | Loxone color for primary/secondary (only if `WLED_ENABLE_LOXONE`, default on) | `json.cpp:266-275`, `wled.h:41-43` |
| `fx` | 0..fxcount-1 or `getVal` | Effect. Reserved slots (`"RSVD"`) are skipped forward; out-of-range becomes 0 (`FX_fcn.cpp:713-716`). **Setting `fx` outside a preset unloads a running playlist** (`json.cpp:290`). | `json.cpp:288-292` |
| `fxdef` | bool | When changing `fx`, load the effect's default `sx/ix/c1-c3/o1-o3/m12/si/rev/mi/rY/mY/pal` from its metadata | `json.cpp:291`, `FX_fcn.cpp:722-741` |
| `sx`, `ix` | 0-255 / `getVal` | Speed, intensity | `json.cpp:294-295` |
| `pal` | palette ID / `getVal` | Ignored on segments without RGB capability. Unknown custom/usermod IDs become 0 (`FX_fcn.cpp:748-762`). | `json.cpp:297-300` |
| `c1`, `c2` | 0-255 | Custom sliders | `json.cpp:302-303` |
| `c3` | 0-31 | Clamped | `json.cpp:304-306` |
| `o1`, `o2`, `o3` | bool / `"t"` | Checkboxes | `json.cpp:308-310` |
| `bm` | 0-255 | Blend mode | `json.cpp:312` |
| `i` | array | Per-LED colors (below) | `json.cpp:314-361` |

Note: `json.cpp:214` says 8-char hex is `[WW]RRGGBB`, but `colorFromHexString()` decodes 8 chars as `RRGGBBWW` (`colors.cpp:575-580`). Trust the code.

### `i`: individual LEDs

Array elements are read left to right:

- Integer: first int sets `start`, second sets `stop`.
- Color (`"RRGGBB"`/`"RRGGBBWW"` or `[r,g,b(,w)]`): paints `[start, stop)` if two ints preceded it with `stop > start`, else only `start`. Index state resets after each color.

Examples: `[0,"FF0000",1,"00FF00"]`, `[0,10,"FF0000"]`, or `["FF0000","00FF00"]` (both go to index 0).

Side effects: transition is set to 0 for this request, global brightness is applied immediately, and **the segment is frozen and cleared to black** the first time (if not already frozen) (`json.cpp:317-326`). Indices are raw, segment-relative, before grouping/spacing/2D expansion (`json.cpp:356`). To resume the effect, send `"frz":false`. Large arrays are bounded by the 16 KB HTTP body limit and the JSON document size (see limits-and-gotchas.md).

## Presets via the state API

`psave` handling is in `savePreset()` (`wled00/presets.cpp:218-278`). Additional keys read from the same request:

| Key | Meaning |
|---|---|
| `n` | Preset name (max 32 chars). Default `"Preset N"`. |
| `ql` | Quick-load label, up to 8 bytes (UI uses 2 chars) |
| `ib` | Include brightness |
| `sb` | Include segment bounds |
| `sc` | Save only selected segments |
| `ledmap` | Store a ledmap index with the preset |
| `bootps` | Set this ID as boot preset (writes cfg) |
| `o` | "Other": save the request body itself, not a snapshot of current state |

Three save modes:

1. **State snapshot** (no `o`): `presetToSave` is set and the snapshot is taken later in the main loop (`presets.cpp:145-153`, `:29-85`), after the rest of the request has been applied. `presets.json` is not updated by the time the HTTP response is sent.
2. **Custom API preset** (`o:true`, no `playlist`): the whole request object, minus `o`, `v`, `time`, `error`, `psave`, is written immediately (`presets.cpp:252-270`). Because `seg`, `win` etc. in that same body are also processed by `deserializeState()`, **saving an API preset also executes it**.
3. **Playlist preset** (`o:true` + `playlist`): saved asynchronously via `serializePlaylist()`. The `playlist` key in the same request also **starts the playlist** (`presets.cpp:271-276`, `json.cpp:542-547`). The stock UI sends `on:true` with it (`data/index.js:2565-2567`).

Preset IDs: 1-250 persistent in `/presets.json`; 255 is a temporary preset (RAM on ESP32, `/tmp.json` otherwise) (`presets.cpp:19-23`, `:58-71`). 251-254 are rejected.

When a preset is loaded: if it has `win`, the legacy API string is applied; otherwise the stored object goes through `deserializeState()` with `ps` removed (to prevent recursion) unless it is the boot preset or a button preset with a `"A~B~"` cycle string (`presets.cpp:186-200`). `currentPreset` is set only if the preset contained `seg`, `on`, `bri`, `nl`, `ps` or `playlist` and no error occurred (`presets.cpp:196`, `:201`). A missing preset sets `error:12` (`presets.cpp:179`, `const.h:492`).

## Playlists

`loadPlaylist()` (`wled00/playlist.cpp:58-149`):

| Key | Type | Meaning |
|---|---|---|
| `ps` | int[] | Preset IDs; max 100 entries (rest ignored) |
| `dur` | int or int[] | Per-entry duration in 100 ms units, clamped 0..42949670. Missing entries copy the last given value. Default 100 (10 s). `0` = stay until advanced (`np`). |
| `transition` | int or int[] | Per-entry transition in 100 ms. Default: current `transition`. |
| `repeat` | int | 0 = infinite; N = play N times; negative = infinite + shuffle |
| `end` | 0-250 or 255 | Preset to apply when done. 255 = restore the preset active when the playlist started. >250 otherwise → 0. |
| `r` | bool | Shuffle after each iteration |

Behaviour: one level of nesting is supported (a playlist entry that is itself a playlist); deeper nesting is ignored (`playlist.cpp:59`). Playlists pause while `bri==0` or nightlight is active (`playlist.cpp:158`). GET state shows the running playlist as `pl`. The playlist's definition is not exposed in state; read it from `/presets.json`.

## Error codes (`state.error`, WS `{"error":N}`, HTTP error bodies)

From `wled00/const.h:482-509`:

| Code | Name | Meaning |
|---|---|---|
| 1 | ERR_DENIED | Permission denied (PIN) |
| 2 | ERR_CONCURRENCY | Concurrency |
| 3 | ERR_NOBUF | JSON buffer lock not obtained in time |
| 4 | ERR_NOT_IMPL | Not implemented (unknown `/json/*` GET path) |
| 7 | ERR_NORAM_PX | Not enough RAM for pixel buffer |
| 8 | ERR_NORAM | Effect RAM depleted / low-heap recovery happened |
| 9 | ERR_JSON | JSON parse failed or WS message fragmented |
| 10 | ERR_FS_BEGIN | FS init failed |
| 11 | ERR_FS_QUOTA | FS full |
| 12 | ERR_FS_PLOAD | Preset does not exist |
| 13 | ERR_FS_IRLOAD | `ir.json` missing |
| 14 | ERR_FS_RMLOAD | `remote.json` missing |
| 19 | ERR_FS_GENERAL | Other FS error |
| 30-32 | | Over-temp / over-current / under-voltage (usermods) |
| 33-37 | ERR_LOW_* | Low memory variants |
| 90 | ERR_SYS_REBOOT | Rebooted after error |
| 91 | ERR_SYS_BROWNOUT | Brownout reboot |
| 100 | ERR_REBOOT_NEEDED | Reboot required after hardware change (e.g. HUB75 on ESP32-S3, `bus_manager.cpp:1242`) |
| 101 | ERR_POWEROFF_NEEDED | Power cycle required |

`serveJsonError()` adds `Retry-After: 1` for codes < 4 (`wled_server.cpp:706-716`).
