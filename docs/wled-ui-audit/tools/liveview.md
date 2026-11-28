# Live View ("Peek"): `/liveview` and `/liveview2D`

Sources: `wled00/data/liveview.htm` (91 lines), `wled00/data/liveviewws2D.htm` (74 lines), `wled00/ws.cpp`, `serveLiveLeds()` in `wled00/json.cpp:1435-1490`, `connectWs()` in `wled00/data/common.js:193-209`.

## Purpose

Show what the LEDs are currently displaying, rendered in the browser. `/liveview` draws a horizontal strip of colored bars; `/liveview2D` draws a matrix of circles for 2D setups.

## How it is reached

- Main UI "Peek" button, `wled00/data/index.htm:26` → `toggleLiveview()` (`wled00/data/index.js:1859-1878`).
  - Non-matrix (or WS not open): loads `/liveview` (or `/liveview?ws` when the main UI's WebSocket is open) into the `<iframe id="liveview">` strip at the top of the page (`index.htm:43`).
  - Matrix (`isM`, i.e. `info.leds.matrix.w/h > 0`, `index.js:664`) with WS open: injects an iframe for `/liveview2D?ws` into the `#mlv2D` modal (`index.htm:365-366`).
  - Turning Peek off sends `{"lv":false}` on the main WS (`index.js:1876`).
- Direct URLs `/liveview`, `/liveview?ws`, `/liveview2D`.

Both pages are always served from PROGMEM (no FS override): `wled_server.cpp:358-365`. `/liveview2D` exists only with WebSockets enabled and 2D not disabled (`wled_server.cpp:356-362`).

## Data sources

### 1. WebSocket binary frames (default path)

The page calls `connectWs()` from common.js, which reuses `top.window.ws` (the main UI's socket) if it is open, otherwise opens `ws://<hostname>/ws` with `binaryType = "arraybuffer"` (`common.js:193-209`). On open it sends:

```json
{"lv":true}
```

Firmware (`ws.cpp:62-63`) records that client's ID as the single live client. `handleWs()` runs every loop and, every 40 ms (`WS_LIVE_INTERVAL`, `ws.cpp:21`), calls `sendLiveLedsWs()` for that client if its send queue is empty; if the queue is busy it retries 20 ms later (`ws.cpp:245-259`).

**Binary frame format** (`ws.cpp:186-243`):

| Offset | 1D (version 1) | 2D (version 2) |
|---|---|---|
| 0 | `0x4C` (`'L'`) | `0x4C` (`'L'`) |
| 1 | `1` | `2` |
| 2 | first pixel R | matrix width / n (uint8) |
| 3 | first pixel G | matrix height / n (uint8) |
| 4.. | B, then R,G,B triplets | R,G,B triplets, row-major |

Header is 2 bytes for 1D, 4 bytes for 2D. Version 2 is sent whenever `strip.isMatrix` is true; LEDs beyond the matrix (extra strips) are dropped.

Downsampling:
- 1D: every nth LED, `n = ceil(total / MAX)`, MAX = 1024 on ESP32, 256 on ESP8266 (`ws.cpp:191-197`).
- 2D: `n` is 1, 2 (if > MAX pixels) or 4 (if > 4×MAX); both axes are decimated by n and every nth row is skipped (`ws.cpp:200-207`, `ws.cpp:229`).

Color mapping: RGBW is folded to RGB by saturating-adding W into each channel. If global brightness `bri` is 0 the frame is all black; otherwise raw pixel values are sent **without** global brightness scaling (`ws.cpp:231-238`). The HTTP JSON variant does scale (see below).

Only one client at a time can receive live frames: `wsLiveClientId` is a single value (`ws.cpp:17`, `ws.cpp:63`). Any client sending `{"lv":true}` takes it over; disconnect of that client clears it (`ws.cpp:31`).

### 2. HTTP polling `/json/live`

Without `?ws`, liveview.htm polls `./json/live` every 40 ms, backing off to 2.5 s on errors and stopping after 5 consecutive failures; it pauses to 250 ms polling while the tab is hidden (`liveview.htm:42-66`).

Response format (`json.cpp:1438-1490`):

```json
{"leds":["FF0000","00FF00", ...],"n":1,"w":16,"h":16}
```

`leds` are 6-digit hex RGB, brightness-scaled, at most 256 entries (`MAX_LIVE_LEDS`), `n` is the decimation step, `w`/`h` only on matrices.

**This endpoint is compiled only when WebSockets are disabled.** `WLED_ENABLE_JSONLIVE` is defined only in the `WLED_DISABLE_WEBSOCKETS` branch (`wled00/wled.h:47-51`). On a default build, `GET /json/live` falls through to `serveJsonError(501, ERR_NOT_IMPL)` (`json.cpp:1369-1383`). The same `serveLiveLeds()` can also send this JSON over WS text frames when called with a client ID; the main UI ignores such messages (`index.js:1436`).

## Page implementation

`liveview.htm`:
- `<canvas>` absolutely positioned, full width, CSS `filter: brightness(175%)` to compensate for dim colors (`liveview.htm:12-19`).
- `draw(start, skip, leds, fill)` splits canvas width evenly across LEDs and fills a rect per LED (`liveview.htm:34-41`). 2D frames are drawn as a flat strip.
- Sets `window.__noDevBanner = true` so common.js does not inject the dev-build banner (`liveview.htm:21`).
- Loads common.js with 100 ms retry and runs `S()` on load (`liveview.htm:23-29`).

`liveviewws2D.htm`:
- WS only; ignores any frame that is not `'L'` version 2 (`liveviewws2D.htm:43`).
- Computes pixels-per-LED to fit the window, centers horizontally, draws each LED as a circle of radius 0.4 × cell (`liveviewws2D.htm:44-55`).
- Resizes the canvas on window resize, throttled to 250 ms (`liveviewws2D.htm:64-72`).

## Other WS protocol details relevant to a client

From `ws.cpp:23-131`:
- On connect, the server pushes full `{"state":{...},"info":{...}}` (`ws.cpp:25-28`, `sendDataWs()` at `ws.cpp:133-184`).
- Text frame starting with `p` and shorter than 10 bytes → server replies `pong` (app-level heartbeat, `ws.cpp:40-45`).
- `{"v":true}` alone → full state+info to this client only.
- `{"lv":true|false}` → live view on/off.
- Anything else is applied as a state change (`deserializeState`). Response is full state if `"v":true` was included, else `{"success":true}`; skipped if a broadcast is imminent (`ws.cpp:69-82`).
- State changes from any source are broadcast to all WS clients as full `{"state","info"}`.
- JSON buffer busy → `{"error":3}`. Message split across frames → `{"error":9}`; the server only handles single-frame messages (max ~1428 bytes ESP32 / 528 bytes ESP8266 per frame, `ws.cpp:36-37`, `ws.cpp:99-117`).
- Out of memory while building the state message → closes all clients with code 1013 (`ws.cpp:165-171`).
- Binary frames from client: byte 0 selects protocol (0 = E1.31, 1 = Art-Net, 2 = DDP), remainder is the packet (`ws.cpp:83-98`). common.js `sendDDP()` builds DDP-over-WS packets: `0x02`, then 10-byte DDP header, max 472 RGB pixels per frame (172 on ESP8266), push flag on the last chunk (`common.js:216-251`).

## Replacement notes

**MVP scope:** Deferred. The PRD does not list a live preview. It is not in the explicit deferral list either, so it is a reasonable post-MVP feature.

Gotchas:
- **One live client per device.** If the replacement server subscribes with `{"lv":true}`, it steals the stream from the stock UI's Peek and vice versa. If live view is added, the server should hold the single subscription and fan frames out to browsers, and send `{"lv":false}` when no browser is watching.
- Do not rely on `/json/live`: it returns 501 on standard builds.
- The PRD's server-holds-the-WebSocket design (§22) matches WLED's model: one WS per device on the server, which receives `{"state","info"}` pushes. Note that every state push includes the full `info` object, so expect several KB per message.
- Binary frames are not brightness-scaled; multiply by `state.bri/255` client-side if the preview should look like the physical LEDs.
- 2D header width/height are `uint8`; decimation keeps them under 256 in practice, but treat them as bytes.
- `connectWs()` in the stock pages uses `ws://` unconditionally unless a sub-path proxy is detected; through an HTTPS reverse proxy the stock live view will fail. Not an issue for the replacement, since the browser talks to the app server.
