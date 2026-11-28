# Main UI: data flow

How `wled00/data/index.js` loads data from the device, keeps it current, and sends changes. Firmware references are in `wled00/json.cpp`, `wled00/ws.cpp`, `wled00/wled_server.cpp`.

## Initial load sequence

1. `index.htm` loads `rangetouch.js`, then `index.js`.
2. `index.js` injects `iro.js` (`index.js:49-64`), retrying every 100 ms on failure. When it loads, it creates the color wheel and runs `onLoad()` once the window `load` event has fired.
3. `onLoad()` (`index.js:229-330`), synchronous part:
   - Work out `loc`/`locip`/`locproto` for file mode, reverse proxy or HTTPS.
   - Read `localStorage.wledUiCfg`, merge into defaults.
   - Init tooltips, preset util buttons, effect filters.
   - Enable PC mode if needed, `applyCfg()` (theme, CSS vars, writes `wledUiCfg`).
   - If `cfg.comp.hdays`: `GET /holidays.json`, then `loadBg()`; else `loadBg()` (may fetch an external image).
   - `selectSlot(0)`, set tab from `location.hash`, hook picker events, read `localStorage.wledPmt`.
4. Async part (`index.js:290-305`). Every request waits for the previous one ("no parallel requests to avoid 503 errors when heap is low"):

| # | Request | Function | Retries | Result |
|---|---|---|---|---|
| 1 | `GET /json/palettes` | `loadPalettes()` `index.js:527` | 5 × 100 ms | Array of palette names; builds palette list. |
| 2 | `GET /json/fxdata` | `loadFXData()` `index.js:567` | 5 × 100 ms | Array of effect metadata strings (sliders/colors/palette/flags). Element 0 replaced with `";!;"`. |
| 3 | `GET /json/effects` | `loadFX()` `index.js:547` | 5 × 100 ms | Array of effect names; builds effect list (Solid first, rest sorted by name). |
| 4 | `GET /json/si` | `requestJson()` `index.js:1756` | 10, delay `retry*50` ms | `{state, info}`. First call sets `reqsLegal = true`. |
| 5 | `GET /json/palx?page=0..m` | `loadPalettesData()` `index.js:2855`, `getPalettesData()` `2883` | 5 × 100 ms per page; pages 75 ms apart | Palette colors for list previews. Skipped if `localStorage.wledPalx` has matching `vid` and `pcount`. Response `{m: lastPage, p: {id: [[pos,r,g,b]...] or ["c1"...]}}`. |
| 6 | (none) | `populatePalettes()` | | Re-render palette list now that `info.cpalcount`/`umpalcount` are known. |
| 7 | `GET /presets.json` | `loadPresets()` `index.js:511` | none | Skipped if `info.fs.pmt == localStorage.wledPmt`; then presets come from `localStorage.wledP`. 404 is treated as empty. |
| 8 | `GET /skin.css` | `loadSkinCSS()` `index.js:213` | none | Only if `cfg.comp.css` (default true). |
| 9 | WebSocket `/ws` | `makeWS()` `index.js:1429` | see below | Not opened if `info.ws < 0` (WebSockets compiled out). |

Side requests during this sequence:
- `parseInfo()` on the first info calls `checkVersionUpgrade()`: `GET /edit?func=edit&path=/version-info.json`, and possibly `GET /json/cfg`, `POST https://usage.wled.me/api/usage/upgrade`, `POST /upload` (see overview.md).

If anything in the async chain throws, a toast "Init failed: {error}" is shown and **the remaining steps, including opening the WebSocket, are skipped** (`index.js:302-304`). Most loaders resolve instead of rejecting on failure, so in practice this is rare; `loadSkinCSS` rejects on a network error.

Firmware routing for these (`json.cpp:1351-1436`, `serveJson`): the URL is matched by substring, in this order: `state`, `info`, `si`, `nodes`, `eff`, `palx`, `fxda`, `net`, `cfg`, `pins`, `live`, `pal`. So `/json/si` = state+info, `/json/palettes` = names only, `/json/palx` = color data, bare `/json` = state+info+effects+palettes.

## Connection status indicators

`#connind` (bottom-left square, `index.css:630-638`) background color:

| Color | Var | Set when |
|---|---|---|
| Yellow `#a90` | `--c-y` | A request is started (`index.js:1758`). Also the CSS default before anything loads. |
| Green | `--c-g` | HTTP response received OK (`index.js:1796`). |
| Blue | `--c-l` | WebSocket message received (`index.js:1442`). |
| Red | `--c-r` | WS closed (`index.js:1455`) or request timeout (`showErrorToast`, `index.js:378`). |

Steady state with a working WebSocket is blue.

Toasts (`showToast`, `index.js:364-374`): normal toasts fade after 2.9 s. Error toasts (red, class `error`) stay until cleared:
- `clearErrorToast(5000)` on every WS message (`index.js:1441`), `clearErrorToast(3000)` on HTTP success (`index.js:1795`), `clearErrorToast(100)` on toast click or Nodes load.

Connection-related toasts:
- "Connection to light failed!" (error): no response within 3 s of any `requestJson()` call (`index.js:1760`).
- "Init failed: …" (error): initial chain threw.
- Raw error text (error): a loader exhausted its retries.
- "Empty response" (error): HTTP returned no JSON body.
- "No segments!" (error): state had no usable segment (`index.js:1508`).
- "Could not load Node list!" (error): `/json/nodes` non-OK.

There is no "connection lost" banner beyond the red indicator and the timeout toast. The "Loading WLED UI..." overlay is only shown until `onLoad()` finishes; it does not wait for data.

## WebSocket

`makeWS()` (`index.js:1429-1464`):
- URL: `ws://{location.hostname}/ws`, or `getURL('/ws')` with `http`→`ws` in file/proxy/HTTPS mode. `binaryType = "arraybuffer"`.
- `onopen`: reset retry counter, set `reqsLegal = true`. The client does **not** send anything on open; the firmware sends full `{state, info}` to a new client on connect (`ws.cpp:27`, `sendDataWs(client)`).
- `onmessage`:
  - Binary frames are ignored (they are Peek data for the iframe sharing this socket).
  - JSON with a `leds` key is ignored (JSON Peek packet).
  - Otherwise: clear the 3 s timeout, record `lastUpdate`, clear error toast, indicator blue. If `json.info` is present, `parseInfo()` and (if Info is open) `populateInfo()`. State is `json.state` or the message itself. Then `displayRover(info, state)` and `readState(state)`.
- `onclose`: indicator red, `ws = null`, retry with `setTimeout(makeWS, wsRpt*200)` while `wsRpt++ < 10`. After 10 failures it stops retrying for the rest of the page's life; the UI then works over HTTP only, with no automatic updates.

Firmware side (`ws.cpp`):
- Text frame starting with `p` and shorter than 10 bytes → reply `pong` (app-level heartbeat; the stock UI does not use it).
- `{"v":true}` alone → reply with full state+info to that client only.
- Any object with key `lv` → start/stop binary Peek stream for this client (`{"lv":true}` / `{"lv":false}`). Only one client at a time can receive Peek; a new `lv:true` takes it over.
- Anything else → `deserializeState(root)`. If the request had `v:true` and no broadcast is pending, reply with full state+info; otherwise reply `{"success":true}`. Every state change also schedules a broadcast of full `{state, info}` to **all** WS clients (`sendDataWs(nullptr)`), rate-limited by `INTERFACE_UPDATE_COOLDOWN` = 1000 ms (`const.h:726`, `led.cpp:199`).
- Messages must fit in one WS frame (1428 bytes; ESP8266 effectively 528). Fragmented text messages get `{"error":9}`.
- If the JSON buffer is busy: `{"error":3}`. If the device cannot allocate the outgoing buffer it closes all WS clients with code 1013.
- Binary frames with first byte 0/1/2 are E1.31/Art-Net/DDP pixel data (used by `sendDDP()` in `common.js`, not by the main page).

## HTTP fallback

`requestJson(command)` (`index.js:1756-1819`) is the single function for reading and writing state.

1. Indicator → yellow. If `command` is set and `reqsLegal` is still false (no successful load yet), the call silently returns without sending.
2. Start a 3 s timer (if not already running). On expiry: close the WS, set `ws = null`, show "Connection to light failed!".
3. If `command` is set, add:
   - `v: true` (always ask for a full response),
   - `time: Math.floor(Date.now()/1000)` (browser's Unix time; the firmware uses it to set its clock when NTP has not synced, `json.cpp` `setTimeFromAPI`),
   - `transition: round(#tt * 10)` if the Transition field (Segments tab) is valid, the command does not already contain `transition`, and the value differs from the last known `state.transition`.
4. Transport choice: WebSocket if it is open, **unless** the serialized command is longer than 1340 bytes, or longer than 500 bytes on ESP8266 (`info.arch == "esp8266"`). Over WS: send the command (or `{"v":true}` if no command) and resolve immediately; the response arrives via `onmessage`.
5. Otherwise HTTP: `GET /json/si` with no command, `POST /json/si` with `Content-Type: application/json` and the command as body.
   - Response OK → clear timer, indicator green, clear error toast in 3 s. `{"success":true}` → done. With `info` → `parseInfo`, `populateInfo` if open, `simplifyUI()` if `info.simplifiedui`. Then `readState(json.state || json)`, `reqsLegal = true`.
   - Failure → retry up to 10 times with delays 0, 50, 100 … 450 ms, then toast the error.

There is **no periodic polling**. Without a WebSocket the UI updates only after its own requests, when the browser tab becomes visible after > 3 s, or when the user presses Refresh in the Info panel.

Firmware POST handling (`wled_server.cpp:422-472`): body parsed into the shared JSON buffer; if busy, the response is deferred. If `pin` is present, it is checked against the settings PIN. URLs containing `cfg` go to config; everything else to `deserializeState()`. If the body had `v:true`, the response is `serveJson()` for the same URL (so `POST /json/si` returns `{state, info}`, `POST /json/state` returns state only) and a WS broadcast is scheduled; otherwise `{"success":true}`. Parse errors → HTTP 400 `{"error":9}`.

## Applying incoming state: `readState(s)`

`index.js:1466-1609`. Keys read from `state`:

| Key | Used for |
|---|---|
| `on` | `isOn`, Power button active class. |
| `bri` | Brightness slider. Note: firmware sends `briLast` (last non-zero brightness), so it is never 0 when off (`json.cpp` `serializeState`). |
| `nl.on`, `nl.dur`, `nl.tbri` | Timer button state, toast text. (`nl.fade` is also read but the firmware key is `nl.mode`; the UI never gets it.) |
| `udpn.send` | Sync button state. |
| `ps`, `pl` | `currentPreset` = `pl` if a playlist runs (`pl >= 0`), else `ps`. Highlights the preset. |
| `transition` | `tr`; Transition field shows `transition/10` seconds; blending style row hidden when 0. |
| `bs` | Blending style dropdown (falls back to Fade if the option is not present). |
| `seg[]` | Rebuilds the segment list (`populateSegments`), computes light capabilities, picks the segment whose values drive the controls. |
| `mainseg` | Fallback segment when none are selected. |
| `error` | Error/note toast (table below). |
| `lor` | (with `info.live`) realtime override UI. |

Segment used to populate the controls (`index.js:1494-1506`): the first segment with `sel: true`, preferring it over `mainseg` if `mainseg` is not selected; if no segment is selected, `mainseg`. From that segment the UI reads `col` (3 color slots), `cct`, `sx`, `ix`, `c1`-`c3`, `o1`-`o3`, `pal`, `fx`.

Light capability flags (`hasRGB`, `hasWhite`, `hasCCT`, `has2D`) are OR-ed across **all selected** segments from `seg.lc` (bit 0 RGB, bit 1 white, bit 2 CCT) and segment geometry. `segLmax` is the largest segment size (all segments, not just selected), used to hide non-0D effects for 1-pixel segments.

Then `updateUI()` (`index.js:1289-1329`) refreshes button states, effect/palette selection, slider trails, color control visibility, preset highlight.

`state.error` toasts (`index.js:1539-1602`). The firmware clears `errorFlag` after serializing it once, so only the first client to receive state sees it.

| Code | Text | Kind |
|---|---|---|
| 1 | Denied! | Error |
| 3 | Buffer locked! | Error |
| 7 | No RAM for buffer! | Error |
| 8 | Effect RAM depleted! | Error |
| 9 | JSON parsing error! | Error |
| 10 | Could not mount filesystem! | Error |
| 11 | Not enough space to save preset! | Error |
| 12 | Preset not found. | Error |
| 13 | Missing ir.json. | Error |
| 19 | A filesystem error has occured. | Error |
| 90 | Unexpected Restart. | Error |
| 91 | Brownout Restart. | Error |
| 100 | Please reboot WLED to activate changed settings. | Note |
| 101 | Please switch your device off and back on. | Note |

Other codes defined in `const.h:482-509` (2, 4, 14, 30-37) show "Error N: " with no text.

## Applying incoming info: `parseInfo(i)`

`index.js:645-685`. Reads: `name` (name label, page title), `live` (title prefix), `simplifiedui`, `leds.count` (`ledCount`), `leds.maxseg`, `fs.pmt` (preset cache key), `ndc` (Nodes button visibility), `leds.matrix.w/h` (2D mode: shows 2D blend styles and 2D effect filter), `opt & 1` (Update button visible), plus everything the Info panel shows. Stored in `lastinfo`.

## Outgoing request shapes from the main page shell and Colors tab

All go through `requestJson()`, so each also carries `v: true`, `time`, and possibly `transition`.

| Control | Payload |
|---|---|
| Power toggle | `{"on": bool}`; when turning on while realtime with `info.liveseg >= 0`: `{"on":true,"live":false,"seg":[{"id":liveseg,"frz":false}]}`; with power preset override: `{"ps": n}` |
| Brightness slider (on release) | `{"bri": 1-255}` |
| Timer | `{"nl": {"on": bool}}` |
| Sync | `{"udpn": {"send": bool}}` |
| Color change (any color control) | `{"seg": {"col": [[r,g,b,w],[],[]]}}` with only the active slot filled |
| White balance slider | `{"seg": {"cct": 0-255}}` |
| Realtime override buttons | `{"lor": 0|1|2}` |
| Info → Refresh | no command (WS `{"v":true}` or `GET /json/si`) |
| Info → Debug toggle | `{"debug": bool}` |
| Peek off (WS only) | raw `ws.send('{"lv":false}')`, not via `requestJson` |

`seg` is sent as an object without `id`, which the firmware applies to every selected segment (`json.cpp` `deserializeState`, "apply all selected segments"). Effects, palette, speed/intensity and segment edits follow the same pattern and are documented by the Effects/Segments audit.

## Replacement notes

**In MVP scope:** PRD §22 asks the server to hold a WebSocket per device and push changes to the browser; PRD §23 has the browser talk only to the app server. The stock UI's data model maps directly: `GET /json/si` (or the WS hello) for state+info, `GET /json/effects`, `/json/fxdata`, `/json/palettes`, `/json/palx`, `/presets.json` for catalogs.

**Out of scope:** the telemetry/upgrade prompt, `skin.css`, `holidays.json`, localStorage caching of presets/palettes in the browser (the server can cache instead).

**Gotchas:**
- Always include `"v": true` in writes if you want the new state back; without it the device replies `{"success":true}` only.
- WS broadcasts are rate-limited to one per second and contain the full state and info (several KB with many segments). Expect echo lag; a slider that applies incoming state while the user drags will jump. The stock UI avoids this by only sending on release (`onchange`) and overwriting the slider with whatever state arrives.
- WS frames must be ≤ 1428 bytes (keep ≤ 500 for ESP8266); larger payloads must go over HTTP `POST /json/si`. Fragmented WS text messages are rejected with `{"error":9}`.
- `{"error":3}` (buffer busy) can arrive as the whole WS message. The stock UI passes it into `readState()`, which then dereferences `s.nl.on` on an object without `nl` and throws. Handle error-only messages explicitly.
- The device closes all WS clients with code 1013 when it runs low on heap. The stock UI gives up after 10 reconnect attempts; the server should reconnect indefinitely with backoff and mark the device offline in between.
- Requests must be serialized per device. Low-heap devices return 503 or defer the response when the JSON buffer is locked; the stock UI loads everything sequentially for this reason.
- `time` in every request sets the device clock if NTP is not synced. A server-side client may want to keep sending it (server time) to preserve that behavior, or deliberately drop it.
- `state.bri` is the last non-zero brightness; use `state.on` for power. Brightness 0 is never shown.
- `seg` without `id` targets all *selected* segments, so what a color change affects depends on segment `sel` flags set by any client. The replacement should send explicit `seg: [{id, ...}]` when the user has picked a specific segment.
- `state.error` is delivered once and then cleared on the device; if the server consumes it, it must forward it to the browser.
- There is no polling fallback in the stock UI. The server should poll `/json/si` when the WebSocket is down if the dashboard needs online status and live values.
- Only one WS client per device receives Peek frames, so if the server also proxies Peek, browsers must share one stream.
