# Main UI: Info panel, Nodes panel, Peek (live view), realtime overlay

## Info panel

- Opened by the Info top-bar button (`toggleInfo()`, `wled00/data/index.js:1879-1887`). Opening closes the Nodes panel and, on 2D setups, the 2D Peek panel. It slides up from the bottom and covers everything under the top bar (`.modal`, `index.css:586-600`).
- On open it calls `requestJson()` (WS `{"v":true}` or `GET /json/si`) to refresh. While open, `populateInfo()` re-renders on every info update (every WS broadcast, every HTTP response), so values like uptime, heap and FPS update whenever state changes, but there is no timer refreshing them.
- Markup: `index.htm:340-354`. Close button (rotated "+" icon), WLED pixel logo (inverted in light theme), `#kv` content, buttons, footer "Made with ♥ by Aircoookie and the WLED community" (heart cycles color while open).

### Fields

`populateInfo(i)` (`index.js:700-748`), `i` = `/json/info`. Rows appear in this order:

| Shown as | Source key(s) | Formatting / condition |
|---|---|---|
| Version line | `ver`, `cn`, `release` | `v{ver} "{cn}"` (codename defaults to "Kuuhaku"), then `({release})` on a new line if set. |
| Usermod rows | `u` | One row per key of `info.u`. If `val[1]` is truthy the row is `val[0]` + unit `val[1]`, else `val` as-is. Values are inserted as raw HTML. A horizontal rule follows if any rows exist. Sliders inside these rows get their trails painted (`index.js:744-747`). |
| Debug | `opt` | Only if `opt & 0x100` (net debug build). Power-icon button showing `on`/`off` by `opt & 0x80`; click sends `{"debug": true|false}`. |
| Build | `vid` | Raw build number, e.g. 2510xxx. |
| Signal strength | `wifi.signal`, `wifi.rssi` | `{signal}% ({rssi} dBm)` |
| WiFi band | `wifi.band`, `wifi.channel` | `{band} (Ch {channel})`, only if `band` set. Firmware sends "2.4GHz", "5GHz", "(other)" or "not connected". |
| Uptime | `uptime` (seconds) | `getRuntimeStr()` (`index.js:394-407`): e.g. "3 days, 4 hours", "2 hours, 5 min", "12 min, 3 sec", "40 sec". |
| Time | `time` | Device local time string as sent. |
| Free heap | `freeheap` (bytes) | `/1024`, 1 decimal, " kB". |
| Free PSRAM | `psram` (bytes) | Same formatting; only if present (ESP32 with PSRAM). |
| (rule) | | |
| Total LEDs | `leds.count` | Only if nonzero. |
| Estimated current | `leds.pwr` (mA) | 0 → "Not calculated"; ≤ 1000 → rounded to nearest 50 mA; > 1000 → amps with 1 decimal (0 decimals above 10 A). Nonzero only when the current limiter (ABL) is enabled. |
| Average FPS | `leds.fps` | |
| (rule) | | |
| MAC address | `mac` | Lowercase hex without separators (`wled.cpp:498-500`). |
| CPU clock | `clock` | " MHz" |
| Flash size | `flash` | " MB" |
| Filesystem | `fs.u`, `fs.t` (kB) | `{u}/{t} kB ({pct}%)` |
| Environment | `arch`, `core`, `lwip` | `{arch} {core}` plus ` ({lwip})` if `lwip` nonzero (ESP8266 only). |
| GitHub | `repo` | Link to `https://github.com/{repo}`, only if set. |

Info keys sent by the firmware but **not** shown in the panel (`json.cpp:707-981`): `ip`, `name` (shown elsewhere as the name label), `brand`, `product`, `deviceId`, `wifi.bssid`, `wifi.ap`, `udpport`, `leds.maxpwr`, `leds.maxseg`, `leds.lc`, `leds.bootps`, `leds.matrix`, `str`, `live`, `liveseg`, `lm`, `lip`, `ws` (connected WS client count), `fxcount`, `palcount`, `cpalcount`, `umpalcount`, `cpalmax`, `umpalnames`, `maps`, `ndc`, `opt` (other bits), `psrSz`, `bootloaderSHA256`, `fs.pmt`, `simplifiedui`. Debug builds add `i2c`, `spi`, `maxalloc`, `resetReason*`, `wifi.txPower`, `wifi.sleep`.

`opt` bit flags (`json.cpp:930-965`): `0x01` OTA enabled, `0x02` Adalight, `0x04` Hue sync, `0x08` filesystem (always), `0x10` Cronixie usermod, `0x40` Alexa, `0x80` debug build (or net debug currently enabled), `0x100` net debug host build.

### Buttons

`index.htm:346-351`:

| Button | Action |
|---|---|
| Refresh | `requestJson()`: WS `{"v":true}` or `GET /json/si`. |
| Instance List | `toggleNodes()` (closes Info, opens Nodes). |
| Update WLED | Navigates the page to `/update` (firmware upload page). Hidden unless `info.opt & 1` (`index.js:674`). |
| Reboot WLED | `cnfReset()` (`index.js:2829-2838`): first click turns the button red with text "Confirm Reboot"; second click navigates the page to `GET /reset`. The firmware serves a "Rebooting... Please wait ~10 seconds." page that reloads after about 11 s, and sets `doReboot` (`wled_server.cpp:408-411`). The confirm state never resets until the page reloads. |

JSON alternative for reboot (not used by the UI): `{"rb": true}` in a state request (`json.cpp`, ignored when `psave` is present).

## Nodes panel

- Opened by the Nodes top-bar button, the "Instance List" button in Info, or by clicking the vertical device name label at the bottom-right (`index.htm:339`). `toggleNodes()` (`index.js:1889-1897`) closes Info and 2D Peek, then calls `loadNodes()`.
- The top-bar button is hidden unless `info.ndc > 0` and is also hidden by CSS at widths ≤ 420 px and 640-767 px; the name label always works.
- `loadNodes()` (`index.js:1151-1167`): `GET /json/nodes`. Non-OK → error toast "Could not load Node list!". Panel has its own Refresh button (`index.htm:361`). No auto-refresh.

Response (`json.cpp:1092-1107`): `{"nodes": [{"name", "type", "ip", "age", "vid"}, ...]}`. Nodes are other WLED devices heard via UDP sync/discovery broadcasts. Only entries with a nonzero IP are included.

Rendering (`populateNodes`, `index.js:1126-1149`):
- Header "WLED instances".
- If `info.ndc < 0`: "Instance List is disabled." If no named nodes: "No other instances found."
- Table, first row "Current instance:" with `info.name`.
- Each node, sorted by name: a button-styled link to `http://{ip}` (opens in the same tab) labeled with the node name, or its IP if the name is the default "WLED". The value column shows the chip from `type & 0x7F` via `btype()` (`index.js:1098-1118`: 1/82 ESP8266, 2/32 ESP32, 3/33 ESP32-S2, 4/34 ESP32-S3, 5/35 ESP32-C3, 39 ESP32-C6, 40 ESP32-C61, 41 ESP32-C5, 42/43 ESP32-P4, else "?") and the build number `vid` in italics ("N/A" if 0). `age` is not shown.
- If `vid >= 2307130`, the link also has a power icon; `type & 0x80` gives its on/off state. Clicking it calls `rmtTgl(ip)` (`index.js:2795-2813`), which fetches `http://{ip}/win&T=2` **directly from the browser** (cross-origin; WLED sends `Access-Control-Allow-Origin: *`). `T=2` toggles power; the XML response's `<ac>` (brightness, 0 = off) updates the icon.

Note: `btype()` maps 43 to ESP32-P4, but `NodeStruct.h` defines 43 as ESP32-H21; 45 (ESP32-P4 rev3) shows "?".

## Peek (live view)

Top-bar Peek button, `toggleLiveview()` (`index.js:1858-1877`).

### 1D (no matrix, or WebSocket not open)

- `#liveview` is a 4 px tall, full-width iframe directly under the top bar (`index.htm:43`, `index.css:288-292`). Toggling on sets its `src` to `/liveview?ws` when the WebSocket is open, else `/liveview`. Toggling off sets `about:blank` and, if WS is open, sends `{"lv":false}`. The content area shifts down 4 px (`size()`, `index.js:3164`).
- `liveview.htm` draws one canvas rectangle per LED across the strip width, with a CSS `brightness(175%)` filter.
  - WS mode: obtains the parent page's open WebSocket through `connectWs()` in `common.js:193-209` (`top.window.ws`), or opens its own, and sends `{"lv":true}`. Frames are binary (see below).
  - HTTP mode: polls `GET ./json/live` every 40 ms while visible (250 ms check when hidden); on errors retries every 2.5 s, up to 5 times, then stops. Response `{"leds": ["RRGGBB", ...], "n": step}`, at most 256 LEDs (every n-th LED when the strip is longer), colors scaled by master brightness with white added to RGB (`json.cpp:1438-1500`). Requires `WLED_ENABLE_JSONLIVE`, which is on by default (`wled.h:50`).

### 2D (matrix configured and WebSocket open)

- Closes Info/Nodes, injects an iframe `#liveview2D` with `src=/liveview2D?ws` into the `#mlv2D` modal, and slides the modal up to cover the content area. Toggling off slides it down, blanks the iframe, sends `{"lv":false}`.
- `liveviewws2D.htm` draws each LED as a circle on a grid sized to fit the window, centered horizontally, redrawn on every frame; canvas resized (throttled 250 ms) on window resize.
- 2D Peek has no HTTP fallback; without WS the 1D strip is used even on matrices.

### Binary Peek frame format (`ws.cpp:180-237`)

| Byte | Content |
|---|---|
| 0 | `'L'` (76) |
| 1 | Version: 1 = 1D, 2 = 2D |
| 2, 3 | (version 2 only) width, height after downsampling |
| rest | RGB triplets |

- Max 1024 LEDs on ESP32, 256 on ESP8266; longer strips send every n-th LED. On matrices the step is 1, 2 or 4 in both dimensions, and any LEDs past the matrix are left out.
- White is added into R, G, B. Colors are not scaled by master brightness, but are all zero when brightness is 0.
- Sent every 40 ms (`WS_LIVE_INTERVAL`) to the single client registered with `{"lv":true}`, skipped when that client's send queue is not empty. Only one client per device can receive Peek; the latest `lv:true` wins.
- The main page's own `onmessage` ignores binary frames, and also ignores JSON with a `leds` key.

## Realtime (live data) overlay

When the device receives realtime pixel data (E1.31, Art-Net, DDP, UDP, Hyperion, Adalight, DMX, tpm2.net), `displayRover(info, state)` (`index.js:1409-1415`) runs on every update:

- `#rover` modal (`index.htm:369-377`) slides up when `info.live && state.lor == 0 && info.liveseg < 0`. Content: large icon, "WLED is receiving live {info.lm} data from {info.lip}" (the "from" part only if `lip` is longer than 2 chars), explanation text, and two buttons:
  - "Override once" → `{"lor": 1}`
  - "Override until reboot" → `{"lor": 2}`
  - Footnote recommending turning off the streaming source when unused.
- `#roverstar` (icon, top-left under the top bar) is shown when `info.live && state.lor` is nonzero; clicking sends `{"lor": 0}` to return to realtime mode.
- When live data goes only to the main segment (`info.liveseg >= 0`), the overlay is not shown. Instead that segment is frozen; its freeze icon in the Segments tab shows a different glyph, and clicking it sends `{"lor":1}` (`index.js:2433`). Power-on also exits live mode in this case (see power-brightness-color.md).
- Page title gets the prefix "(Live) ".

Firmware (`json.cpp` `deserializeState`): `lor` 0 = none, 1 = override once (reset to 0 when the current realtime session ends, `udp.cpp:441`), 2 = override until reboot; values > 2 are clamped to 2. With "use main segment only", `lor` only toggles that segment's freeze and is reset to 0. `live: true` enters realtime mode with no timeout (`realtimeLock(65000)` maps to an infinite timeout, `udp.cpp:430`) until `live: false` exits it.

## Replacement notes

**In MVP scope (PRD §20, acceptance 19-20):** a System view with WLED version (`ver`), hardware/platform (`arch`; `btype`-style mapping only if needed), IP (`ip`, which the stock Info panel does not show), uptime (`uptime`), Wi-Fi signal (`wifi.rssi`/`wifi.signal`), free memory (`freeheap`, `psram`), and a reboot action. Use `{"rb": true}` via the JSON API or `GET /reset` from the server; expect the device to drop off for about 10 s. Online status on the dashboard (PRD §8) is the server's job; the stock UI has nothing comparable beyond the connection indicator.

**Out of scope:** the Update WLED button (PRD §29 defers firmware updates; the escape-hatch link to the stock UI covers it), the debug toggle, usermod info rows (they can contain arbitrary HTML), the Nodes panel as such (PRD §6 discovery uses mDNS; the node list from `/json/nodes` is a usable extra discovery source since it lists WLED devices the controller has heard on the LAN, with IP, name, chip and build), remote power toggling of nodes, and Peek (not mentioned in the PRD; it would also need a binary WS proxy).

**Gotchas:**
- `info.u` values may be `[value, unit]` arrays or plain values, and the stock UI inserts them as HTML. If shown at all, render as text. The stock check `val[1]` also misreads plain strings longer than one character (shows the first character with the second as the unit).
- `uptime` is in seconds; `freeheap`/`psram` in bytes; `fs.u`/`fs.t` in kB (firmware divides by 1000, UI labels them kB); `leds.pwr` in mA and 0 when the current limiter is off.
- `mac` is 12 lowercase hex digits without colons.
- `wifi.band` is "not connected" when on Ethernet or AP; `wifi.ap` tells whether the device is running its own access point.
- Realtime mode makes the device ignore normal effect rendering. The replacement should show when `info.live` is true (with `info.lm` and `info.lip`) and offer the `lor` override, or users will think control is broken.
- `GET /reset` and `/win&...` are side-effecting GETs. Keep them server-side and never let a browser prefetch them.
- If Peek is ever added, only one WS client per device gets frames, and the server's own WS connection would be that client.
