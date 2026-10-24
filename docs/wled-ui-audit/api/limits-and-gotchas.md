# WLED API limits, concurrency and gotchas for a proxying server

Source: WLED 17.0.0-dev, plus the pinned web server library `Aircoookie/ESPAsyncWebServer@ac44e32` (`platformio.ini:153`; ESP8266 uses `@2d3af2c`, `platformio.ini:258`). Library line references are from that commit.

## Hardware-dependent limits

| Limit | ESP8266 | ESP32-S2 | ESP32 / S3 / C3 / others | Source |
|---|---|---|---|---|
| Shared JSON document (`pDoc`) | 10240 B | 24576 B | 32767 B | `const.h:657-665` |
| Max segments (`info.leds.maxseg`) | 16 | 32 | 32, or 64 with PSRAM | `FX.h:85-97` |
| Max LEDs | 1536 | 2048 | 4096 (C3/C5/C6/C61), 16384 (others) | `const.h:567-577` |
| Segment name length | 32 | 64 | 64 | `const.h:174-188` |
| Custom palettes | 10 | 129 | 129 | `const.h:21-25` |
| WS clients before oldest is evicted | 3 | 8 | 8 | `ws.cpp:249-252`, `AsyncWebSocket.h:50-54` |
| WS outbound queue per client | 8 msgs | 32 | 32 | `AsyncWebSocket.h:28-37` |
| WS liveview LED sample cap | 256 | 1024 | 1024 | `ws.cpp:192-196` |
| WS single-frame text size (practical) | ~528 B | ~1428 B | ~1428 B | `ws.cpp:37` |
| `/json/palx` page size | 5 | 8 | 8 | `json.cpp:986-990` |
| Node list size | 24 | 150 | 150 | `const.h:700-705` |
| HTTP min heap to queue a request | 8 KB | 12 KB | 12 KB | `const.h:684-695` |

## HTTP request queue (library)

`AsyncWebServer server(80, {nParallel=0, nMax=6, queueHeapRequired, requestHeapRequired})` (`wled.h:789`, `const.h:681-698`):

- At most **6 HTTP requests** active + queued per device. The 7th connection gets a bare `HTTP/1.1 503 Service Unavailable` with `Connection: close` and no body or `Retry-After` (`WebServer.cpp:74-86`, `:164-181`).
- 503 is also returned when free heap is below `WLED_REQUEST_MIN_HEAP` (12 KB ESP32 / 8 KB ESP8266).
- Below the library's absolute floor (8 KB heap on ESP32, 2 KB on ESP8266, or too little contiguous memory) the TCP connection is **closed without any response** (`WebServer.cpp:152-160`).
- New HTTP connections get a 3 s RX timeout (`WebServer.cpp:183`). A client that stalls mid-request for 3 s is dropped.
- WebSockets do not count against the queue (`const.h:697`).

Server implications: limit concurrency per device to a small number (1-2 in flight), retry 503 and connection resets with backoff, and do not fan out `/json/info`, `/json/state`, `/presets.json`, `/json/cfg` in parallel on page load. Serialize requests per device.

## JSON buffer lock (`pDoc`)

One global `JsonDocument` is shared by every JSON operation: HTTP GET/POST `/json*`, WS receive and every WS broadcast, preset load and save, config load/save, MQTT, IR, serial, ledmap loading (`const.h:512-535` lists 22 lock owners). `requestJSONBufferLock()` waits up to 250 ms and then fails (`util.cpp:273-309`).

Behaviour on failure:

| Path | Result |
|---|---|
| HTTP `GET /json*` | `request->deferResponse()`: the request is pushed to the back of the server queue and retried; the client just sees a slower response (`json.cpp:1384-1387`, library `WebRequest.cpp:1060-1065`). It still occupies one of the 6 queue slots. |
| HTTP `POST /json*` | Same defer (`wled_server.cpp:426-429`) |
| WS command | `{"error":3}` sent to that client, command dropped (`ws.cpp:48-51`) |
| WS broadcast | `{"error":3}` sent **to all clients** instead of state (`ws.cpp:137-145`) |
| Preset load | Retried next loop (`presets.cpp:155`) |
| Preset save | Retried next loop; `presetToSave` stays set until the lock is obtained (`presets.cpp:35`, `:148-153`) |

The lock for a GET response is held until the response body has been fully generated (`LockedJsonResponse`, `json.cpp:1328-1349`). A slow-reading client holds the lock for the duration, blocking WS pushes, preset application and other API calls. Read responses promptly; do not stream them slowly through a proxy with backpressure.

Since the buffer is fixed size and ArduinoJson does not grow it, very large outputs can be silently truncated. `GET /json` (state + info + effects names + palette names in one document) is the largest; on ESP8266 with many segments it can exceed 10 KB. Prefer `/json/si`, `/json/effects`, `/json/palettes` separately. `/json/fxdata` is streamed without the lock.

## Request size limits

| Input | Limit | Over limit |
|---|---|---|
| HTTP JSON POST body | < 16384 bytes (`_maxContentLength`, `AsyncJson-v6.h:118`, `:151`) | `413`, no body |
| HTTP JSON POST parsed size | Must fit in `pDoc` (10/24/32 KB of ArduinoJson nodes, not bytes) | `400 {"error":9}` (`wled_server.cpp:433-436`) |
| WS text | One frame, ~1428 B (ESP32) / ~528 B (ESP8266) | `{"error":9}` |
| Preset name | 32 chars (`presets.cpp:225-228`) | Truncated |
| Segment name | 32/64 chars | Truncated |
| Playlist entries | 100 (`playlist.cpp:70`) | Rest ignored |
| Preset IDs | 1-250 (255 temporary) | Ignored |

The POST body buffer is `malloc(total)` with no terminating NUL and is parsed as a C string (`AsyncJson-v6.h:149-154`, `wled_server.cpp:431`). Send compact, well-formed JSON and avoid trailing bytes.

## Rate considerations

- WS state broadcasts are coalesced to at most one per second (`INTERFACE_UPDATE_COOLDOWN`, `const.h:726`, `led.cpp:198-203`). The server's view lags device state by up to ~1 s. For immediate confirmation after a command, use `POST /json/state` with `"v":true` (this also delays the next broadcast by 1 s).
- Every state change also sends a UDP sync notification (if enabled) and, on brightness changes, a node broadcast (`led.cpp:162-164`). High-rate slider streams multiply network traffic on the LAN. Throttle slider updates (the stock UI sends on input events; ~10-20 Hz is a reasonable ceiling) and consider `"udpn":{"nn":true}` for intermediate values.
- Every `POST /json/state` takes the strip suspend path when it contains `seg` (`json.cpp:466-490`), which waits for the current frame to finish.
- `psave` and `pdel` rewrite `/presets.json` on flash; frequent saves cost loop time and flash wear.
- Each `POST /json/cfg` with `sv` true rewrites `cfg.json` and `wsec.json`, and backs up the config first (`cfg.cpp:831-849`).
- Low heap for 15 s makes the firmware drop effects to Solid and purge segments; 30 s resets segments; 45 s re-creates the strip object and forces WiFi reconnect (`wled.cpp:193-233`). Aggressive polling on ESP8266 can contribute.

## Semantics that surprise

1. **`state.bri` is the last non-zero brightness**, not 0 when off. Use `state.on` (`json.cpp:651-652`).
2. **Segment IDs can have gaps.** Deleted segments become inactive slots and are omitted from `state.seg`. Do not use array position as ID. A bulk delete can trigger `purgeSegments()` which renumbers later segments (`json.cpp:488`).
3. **`seg` object without `id` applies only to selected segments** (`json.cpp:469-478`). Always send `id` from a server.
4. **New segment ID is not the requested ID.** Requesting `id: 10` on a 3-segment device creates segment 3 (`json.cpp:79-84`).
5. **Changing `start`/`stop` without `n` erases the segment name** (`json.cpp:148-151`). Always resend `n` when editing bounds.
6. **Segment `bri:0` turns the segment off** but keeps the stored opacity (`json.cpp:194-198`).
7. **Integer values are not range-checked** in most fields; they are truncated to a byte. `bri:256` is 0 (off). `grp`/`spc` above 255 wrap. Clamp on the server.
8. **Setting `fx` stops a running playlist** (`json.cpp:290`); `ps` also stops it (`presets.cpp:129`).
9. **`ps` is asynchronous.** The response (even with `v:true`) shows the pre-preset state. Wait for the next WS broadcast or re-read state.
10. **`psave` state snapshots are asynchronous**: written in a later loop iteration, after the HTTP response (`presets.cpp:29-85`, `:145-153`). Verify via `info.fs.pmt` change or by re-reading `/presets.json`.
11. **Saving a custom-API preset or playlist also executes it** (presets in json-state.md).
12. **`state.error` is read-once** (`json.cpp:658`). If the server polls state, it must forward the error to clients itself; other consumers (the WS broadcast, other tabs) will not see it.
13. **Selection-only changes are not broadcast** over WS (`json.cpp:362-363`).
14. **`time` overrides NTP** when it differs by ≥60 s (`ntp.cpp:584-587`). Send correct UTC or omit it.
15. **`rmcpal` takes the file index, not the palette ID** (`json.cpp:549-554`).
16. **The JSON comment and the code disagree on 8-digit hex**: the code reads `RRGGBBWW` (`colors.cpp:575-580`).
17. **`/json/live` is not available** in default builds (WS enabled); it returns 501 (`wled.h:47-51`, `json.cpp:1369-1382`).
18. **POST to any `/json/...` path applies state**, including `/json/info` or `/json/effects`. Only URLs containing `cfg` go to config (`wled_server.cpp:441`). Watch for URL typos.
19. **PIN unlock is global and lasts 15 minutes** from the last PIN-related edit (`util.cpp:502-508`, `wled.cpp:189-191`). A server unlocking for one user unlocks the device for everyone on the LAN. Config GETs are not PIN-protected at all.
20. **`/settings` POSTs and OTA are restricted by source subnet** (`wled_server.cpp:76-82`, `:543`, `:787-790`). The server must reach devices from a private-range LAN address.
21. **`/json/cfg` partial updates reset some fields** (`hw.led.fps`, `hw.led.rgbwm`, `light.gc`; see other-endpoints.md). Read-modify-write the full config, or always include these keys.
22. **Network config via `/json/cfg` does not reconnect**; it needs a reboot. The form path does reconnect.
23. **The WS socket never pings.** Detect dead connections with the `p` → `pong` application ping.
24. **Only one liveview client per device** (`ws.cpp:17`, `:62-63`).
25. **`/edit?func=delete` is a GET** that deletes files.

## Build/version differences visible in code

| Flag / platform | API effect |
|---|---|
| `WLED_DISABLE_2D` | No `startY/stopY/rY/mY/tp` in segments, no `info.leds.matrix`, 2D effects show as `"RSVD"`, no `/liveview2D` |
| `WLED_DISABLE_WEBSOCKETS` | No `/ws`; `info.ws = -1`; `/json/live` becomes available |
| `WLED_DISABLE_OTA` | `/update` returns 501; `info.opt & 0x01` clear; no `bootloaderSHA256` |
| `WLED_DISABLE_ALEXA` | No `id.inv`, `if.va`; `info.opt & 0x40` clear |
| `WLED_DISABLE_MQTT` / `WLED_DISABLE_HUESYNC` | Corresponding `if.mqtt` / `if.hue` config sections absent |
| `WLED_DISABLE_LOXONE` | No `lx`/`ly` segment keys |
| `WLED_ENABLE_DMX` | `/dmxmap`, settings page 7, `dmx` config |
| `WLED_DISABLE_PARTICLESYSTEM1D/2D` | Those effects show as `"RSVD"` |
| `BOARD_HAS_PSRAM` | `info.psram`, `info.psrSz`; maxseg 64; presets served from RAM cache |
| ESP8266 | `info.arch:"esp8266"`, `lwip` present, ledmap names absent from `info.maps`, smaller limits (table above) |
| ESP32 family | `info.arch` is the chip model except classic ESP32 which reports `"esp32"`; `/update?revert` and `/updatebootloader` exist |
| ESP-IDF ≥ 6 | `info.deviceId` absent |
| 5 GHz chips (C5) | `info.wifi.band` can be `"5GHz"`; `wifi.band` config key |

Effect IDs are stable across builds; names and metadata are not guaranteed identical (usermods can append effects). Cache effect and palette lists per device, keyed by `info.vid` plus `fxcount`/`palcount`/`cpalcount`. Custom palettes are files (`/palette<N>.json`); uploading one does not change `fs.pmt`, so refresh `/json/palx` when `cpalcount` changes or after the server itself uploads a palette. Refresh `/presets.json` when `fs.pmt` changes.
