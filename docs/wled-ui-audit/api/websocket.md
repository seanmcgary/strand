# WLED WebSocket API (`/ws`)

Source: `wled00/ws.cpp`, `wled00/led.cpp:154-217`, and the pinned `ESPAsyncWebServer` fork (`Aircoookie/ESPAsyncWebServer@ac44e32`, referenced from `platformio.ini:153`). Compiled in unless `WLED_DISABLE_WEBSOCKETS` (`wled00/wled.h:47-51`). `info.ws` is `-1` when compiled out.

Endpoint: `ws://<host>/ws` on port 80 (`wled00/wled.h:791`). Standard RFC 6455 upgrade, version 13 only. No authentication, no subprotocol check.

## Connection limits

- `handleWs()` runs roughly every 40 ms and calls `ws.cleanupClients(max)` (`ws.cpp:245-259`). If more than `max` clients are connected, the **oldest** client is closed, one per call (`AsyncWebSocket.cpp:922-927` in the library).
  - ESP8266: `max = 3` (explicit, `ws.cpp:249-250`).
  - ESP32 family: `max = DEFAULT_MAX_WS_CLIENTS = 8` (`AsyncWebSocket.h:50-54`).
- A new connection therefore evicts the oldest one rather than being refused. A server holding one persistent socket per device will be evicted if users also open the stock UI in several tabs (each tab opens a socket).
- Per-client outbound queue: 32 messages (ESP32) / 8 (ESP8266) (`AsyncWebSocket.h:28-37`). When full, new messages for that client are **dropped silently** (`AsyncWebSocket.cpp:459-473`). A slow reader misses state updates instead of being disconnected.
- WebSocket connections do not count against the HTTP request queue limit (`const.h:697`).

## Keepalive

- The server never sends pings (`_keepAlivePeriod = 0`) and sets no RX timeout on WS clients (`AsyncWebSocket.cpp:389-390`). A half-open connection (device rebooted, WiFi dropped) is not detected by the device or by an idle client.
- Protocol-level PING frames from the client are answered with PONG by the library (`AsyncWebSocket.cpp:670-671`).
- Application-level ping: any text message with length 1-9 whose first byte is `p` gets the text reply `pong` (`ws.cpp:40-45`). It does not take the JSON lock. Use this (or protocol pings) with a client-side timeout to detect dead sockets.

## Server → client messages

### Full state+info (text)

Format: `{"state": {...}, "info": {...}}`, same shapes as `GET /json/si` (`ws.cpp:133-184`). Sent:

1. To a client immediately on connect (`ws.cpp:25-28`).
2. As a broadcast to all clients from `updateInterfaces()` (`led.cpp:198-216`) when `interfaceUpdateCallMode` is set and at least `INTERFACE_UPDATE_COOLDOWN = 1000 ms` has passed since the previous broadcast (`const.h:726`). Pending updates are retried every loop via `handleTransitions()` (`led.cpp:219-221`). Net effect: **at most one broadcast per second**, coalescing all changes in between; the last change is always delivered.
3. To a single client in reply to a WS command that asked for it (see below).

`interfaceUpdateCallMode` is set by `stateUpdated()` whenever brightness or `stateChanged` changed (`led.cpp:159-167`). Sources include: JSON API (HTTP or WS), presets and playlist steps (`presets.cpp:212-214`), buttons, IR, MQTT, Alexa, Hue, incoming UDP sync notifications (`udp.cpp:404`), nightlight start, ledmap load (`FX_fcn.cpp:2262`), and an HTTP JSON POST with `"v":true` (`wled_server.cpp:463-464`). This covers PRD §22's "Home Assistant changes brightness" case.

Not pushed:
- Segment **selection-only** changes (`sel`) (`json.cpp:362-363`).
- Info-only changes (RSSI, uptime, fps, power estimate, heap). Info rides along with state broadcasts but has no own trigger; poll `/json/info` if you need fresh values.
- Entering realtime/live mode does not schedule a broadcast; `exitRealtime()` calls `updateInterfaces()` which only fires if an update was already pending (`udp.cpp:440-453`).
- `state.error` is cleared after it is serialized once (`json.cpp:658`); with several consumers only one sees it.

### Error messages (text)

- `{"error":3}`: JSON buffer lock not obtained within 250 ms when building a push. If it was a broadcast, this message is sent **to all clients instead of state** (`ws.cpp:137-145`). Clients must not treat it as a state object and should re-request (`{"v":true}`) later.
- `{"error":9}`: received a fragmented (multi-frame) text message (`ws.cpp:111-116`).
- Close code `1013` to **all** clients: buffer allocation for the push failed (low heap). `ws.closeAll(1013)` plus `cleanupClients(0)` (`ws.cpp:165-171`). Reconnect with backoff.

### Command acknowledgements (text)

- `{"success":true}`: reply to a command when no broadcast is pending and no verbose reply was requested (`ws.cpp:76-79`).
- `pong`: reply to `p…` ping.

### Liveview (binary)

Sent only to the single client registered with `{"lv":true}`, every ~40 ms, and only when that client's send queue is empty (`ws.cpp:186-243`, `:245-258`). If the queue is not empty, it retries ~20 ms later.

| Byte | 1D (version 1) | 2D (version 2) |
|---|---|---|
| 0 | `'L'` (0x4C) | `'L'` |
| 1 | `1` | `2` |
| 2 | RGB data starts | width / n (uint8) |
| 3 | | height / n (uint8) |
| 4.. | | RGB data |

RGB data is 3 bytes per sampled LED. White is added into R, G and B with saturation (`qadd8(w, r)`). Values are **not** scaled by brightness; all zeros when `bri == 0` (`ws.cpp:236-238`). Sampling: 1D sends every n-th LED where `n = ceil(count / 1024)` (ESP32) or `/256` (ESP8266). 2D uses the matrix size (ignoring any trailing strip) with n = 1, 2 or 4 by row/column decimation (`ws.cpp:191-208`). Width/height are single bytes, so matrices wider or taller than 255 after decimation are not representable.

## Client → server messages

Only single-frame messages are processed. The comment in `ws.cpp:37` gives the practical frame limit as 1428 bytes on ESP32 and 528 bytes on ESP8266 (one TCP segment). The stock UI falls back to HTTP for payloads over 1340 bytes, or over 500 bytes on ESP8266 (`wled00/data/index.js:1774-1775`). Multi-frame text yields `{"error":9}` and is discarded.

### Text (JSON)

Processing order in `ws.cpp:47-82`:

1. Take the JSON lock (wait up to 250 ms). On failure reply `{"error":3}` and drop the command.
2. Parse. Invalid JSON or non-object is **silently dropped** (no reply).
3. Dispatch:
   - Exactly `{"v":true}` (one key): no state change; reply with full state+info to this client.
   - Object containing `lv`: `{"lv":true}` makes this client the liveview receiver (replacing any previous one; there is only one per device). `{"lv":false}` clears it. **Other keys in the same message are ignored.** The registration is also cleared when that client disconnects.
   - Anything else: `deserializeState(root)`, the same as `POST /json/state` (json-state.md). Callmode is `CALL_MODE_DIRECT_CHANGE`. The `pin` key is **not** processed over WS.
4. Reply, only if **no broadcast is already pending** (`interfaceUpdateCallMode == 0`):
   - `v:true` present → full state+info to this client (and MQTT publish).
   - otherwise → `{"success":true}`.

   If a broadcast is pending, the client gets no direct reply; it will receive the broadcast within about a second. A command that changes state normally sets a pending broadcast, so a client should expect either a direct reply or the next broadcast, not both.

### Binary (realtime pixel data)

First byte selects the protocol; the rest is the raw packet (`ws.cpp:83-98`):

| Byte 0 | Protocol |
|---|---|
| `0x00` | E1.31 packet (marked untested) |
| `0x01` | Art-Net packet (marked untested) |
| `0x02` | DDP packet |

Payloads go to `handleE131Packet()` and put the device into realtime mode like the UDP equivalents. The stock UI's `sendDDP()` (`wled00/data/common.js:216-252`) sends `0x02` + 10-byte DDP header + RGB, at most 472 RGB pixels per frame on ESP32 (172 on ESP8266), with the push flag (0x41) on the last chunk. This is relevant for the PRD's LED identification feature (§14): it allows lighting specific pixels without touching segments, at the cost of entering live mode.

## Interaction with HTTP

- A `POST /json/state` with `"v":true` sets `lastInterfaceUpdate = now`, delaying the next WS broadcast by up to 1 s (`wled_server.cpp:463`).
- WS pushes and HTTP JSON requests share one JSON document and lock (`pDoc`). Every WS broadcast holds the lock while serializing. See limits-and-gotchas.md.

## Recommended server usage

1. Open one socket per device. On open you receive full state+info; no need to send `{"v":true}`.
2. Treat every text message as one of: `{"state","info"}` snapshot, `{"success":true}`, `{"error":N}`, `pong`. Ignore binary unless liveview is active.
3. Send control commands over HTTP `POST /json/state` (no frame size limit below 16 KB, explicit status codes) or over WS for small, high-rate updates (slider drags). Over WS, expect no per-command acknowledgement.
4. Run an app-level `p` ping every ~10-20 s and reconnect if `pong` does not arrive.
5. Expect eviction when more than 3 (ESP8266) / 8 (ESP32) clients connect; reconnect with backoff, and avoid reconnect storms against another client that is also reconnecting.
6. For liveview, only one consumer per device can receive frames. If the server multiplexes liveview to several browsers, it must hold the single `lv` registration itself.
