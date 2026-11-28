# WLED HTTP endpoints other than `/json/state`

Source: route table in `initServer()` (`wled00/wled_server.cpp:349-693`). CORS headers `Access-Control-Allow-Origin/Methods/Headers: *` are added to every response (`wled_server.cpp:352-354`); `OPTIONS` to any unrouted path returns 200 with `Access-Control-Max-Age: 7200` (`wled_server.cpp:679-685`).

## Authentication model (applies to everything below)

- There are no user accounts or tokens. Protection is a 4-digit **settings PIN** (`settingsPIN`) plus an **OTA lock** with password.
- `correctPIN` is a single **global** flag on the device, not per client or session (`wled00/util.cpp:502-508`). Once any client supplies the right PIN, every client is unlocked until 15 minutes after the last PIN-related edit (`PIN_TIMEOUT`, `const.h:729`, checked in `wled.cpp:189-191`). `/settings/lock` relocks.
- PIN comparison uses only the first 4 characters (`strncmp(settingsPIN, pin, 4)`, `util.cpp:506`). After a wrong attempt, further attempts within 3 s are ignored (`PIN_RETRY_COOLDOWN`, `util.cpp:504`).
- Ways to submit the PIN: `"pin"` key in any JSON POST to `/json*` (`wled_server.cpp:438`); `PIN` form field on settings POSTs (`set.cpp:17`).
- When no PIN is set, `correctPIN` is true.
- **Not protected by the PIN**: all GET `/json/*` (including `/json/cfg`), `/presets.json`, `/cfg.json` and any other FS file served by the fallback handler, `POST /json/state`, the WebSocket. Passwords are never serialized (only `pskl` lengths), and any path containing `sec` is refused by the file server (`file.cpp:481`), which hides `wsec.json`.

## Presets file: `GET /presets.json`

Served by the not-found fallback → `handleStaticContent(request, url, 404, …)` → `handleFileRead()` (`wled_server.cpp:674-692`, `file.cpp:478-498`). On PSRAM boards it is served from an in-RAM cache (`file.cpp:482-492`). No ETag/caching headers; use `info.fs.pmt` to decide when to refetch.

Format: an object keyed by preset ID as a string. `"0"` is always `{}` (created by `initPresetsFile()`, `presets.cpp:102-117`). Deleted presets are stored as `{}`.

```json
{
  "0": {},
  "1": {"on":true,"bri":128,"transition":7,"bs":0,"mainseg":0,"seg":[{...},{"stop":0}],"n":"Evening","ql":"E"},
  "2": {"playlist":{"ps":[1,3],"dur":[300,300],"transition":[7,7],"repeat":0,"end":0,"r":false},"on":true,"n":"Cycle"},
  "3": {"win":"&FX=~","n":"Next FX"},
  "4": {"seg":{"fx":"~"},"n":"API preset"}
}
```

Snapshot presets are produced by `serializeState(…, forPreset=true, includeBri, segmentBounds, selectedOnly)` (`presets.cpp:41-50`, `json.cpp:648-704`): no `len`, segments not in the preset are written as `{"stop":0}` when bounds are saved, `n:""` is written for unnamed segments, and `ps`, `pl`, `nl`, `udpn`, `lor`, `error`, `ledmap` are omitted. `ib:false` omits `on/bri/transition/bs`. Optional `ql` (quick-load label) and `ledmap`. A preset is a playlist if it has a `playlist` key.

Write paths: `psave`/`pdel` via JSON (json-state.md), or upload a whole file via `/upload` (sets `fs.pmt`, `wled_server.cpp:219`).

## Config

### `GET /json/cfg`

`serializeConfig()` (`wled00/cfg.cpp:851-1281`) of the live configuration. Top-level keys:

| Key | Contents |
|---|---|
| `rev` | `[1,0]` settings schema revision |
| `vid` | Build number |
| `id` | `mdns`, `name`, `inv` (Alexa name), `sui` (simplified UI) |
| `nw` | `espnow`, `linked_remote[]`, `ins[]` (up to 3 WiFi networks: `ssid`, `pskl`, `bssid`, `ip[4]`, `gw[4]`, `sn[4]`, enterprise fields), `dns[4]` |
| `ap` | `ssid`, `pskl`, `chan`, `hide`, `behav`, `ip` |
| `wifi` | `sleep`, `phy`, `band` (5 GHz chips), `txpwr` (ESP32) |
| `eth` | `type`, `pin[]` (Ethernet builds) |
| `hw` | `led` (`total`, `maxpwr`, `cct`, `cr`, `ic`, `cb`, `fps`, `rgbwm`, `matrix{mpc,panels[]}`, `ins[]` buses: `start`, `len`, `pin[]`, `order`, `rev`, `skip`, `type`, `ref`, `rgbwm`, `freq`, `maxpwr`, `ledma`, `drv`, `text`), `com[]` color order overrides, `btn` (`max`, `pull`, `ins[]{type,pin[],macros[3]}`, `tt`, `mqtt`), `ir` (`pin`, `type`, `sel`), `relay` (`pin`, `rev`, `odrain`, `del`), `baud`, `if` (`i2c-pin`, `spi-pin`) |
| `light` | `scale-bri`, `pal-mode`, `aseg`, `gc{bri,col,val}`, `tr{dur,rpc,hrp}`, `nl{mode,dur,tbri,macro}` |
| `def` | `ps` (boot preset), `on`, `bri` |
| `if` | `sync` (ports, `recv{bri,col,fx,pal,grp,seg,sb}`, `send{en,dir,btn,va,hue,grp,ret}`), `nodes{list,bcast}`, `live` (`en`, `mso`, `rlm`, `port`, `mc`, `dmx{…}`, `timeout`, `maxbri`, `no-gc`, `offset`), `va` (Alexa), `mqtt`, `hue`, `ntp` (`en`, `host`, `tz`, `offset`, `ampm`, `ln`, `lt`) |
| `ol` | Clock overlay |
| `timers` | `cntdwn{goal[6],macro}`, `ins[]{en,hour,min,macro,dow,start{mon,day},end{mon,day}}` |
| `ota` | `lock`, `lock-wifi`, `pskl`, `aota`, `same-subnet` |
| `dmx` | DMX output (if built with DMX) |
| `um` | Usermod settings, one object per usermod |

Not PIN-protected. Contains MQTT user, SSIDs, static IPs, Hue IP.

### `GET /cfg.json`

The raw file from flash via the FS fallback (`file.cpp:478-498`). Same schema as `/json/cfg` but it is the last **saved** config, which can lag behind live state until `configNeedsWrite` is flushed in the loop (`wled.cpp:254`). Prefer `/json/cfg`.

### `POST /json/cfg`

Handled by the same JSON POST handler: any `/json*` URL containing `cfg` goes to `deserializeConfig(root, fromFS=false)` (`wled_server.cpp:441-458`, `cfg.cpp:47-783`).

- If a PIN is set and not unlocked: `401 {"error":1}`. Put `"pin":"1234"` in the same body to unlock in one request (it is checked first).
- Response is always `200 {"success":true}` otherwise. No validation errors are reported; invalid values are silently clamped or ignored.
- `"sv":false` skips saving to flash; default saves (`cfg.cpp:780`). If buses changed, saving happens after bus re-init in the loop (`cfg.cpp:779`, `wled.cpp:239-248`).
- `"rb":true` reboots after processing (`cfg.cpp:778`, `wled.cpp:277`).
- OTA keys (`ota.lock`, `ota.lock-wifi`, `ota.aota`, `ota.same-subnet`, `ota.psk`) are accepted only if the OTA lock is off or `ota.psk` matches the OTA password (`cfg.cpp:738-752`).

Partial updates mostly work because most fields use `x = json | x` (keep if absent, `cfg.cpp:41`). Exceptions where **absence resets a value**:

| Field | Effect if omitted | Source |
|---|---|---|
| `hw.led.rgbwm` | Global auto-white mode reset to "disabled" | `cfg.cpp:183` |
| `hw.led.fps` | Target FPS reset to 42 | `cfg.cpp:189-190` |
| `light.gc.bri` / `light.gc.col` | Brightness gamma turned off; color gamma turned on (if `gc.val` valid) | `cfg.cpp:531-540` |
| `nw.linked_remote` | ESP-NOW linked remotes cleared (always cleared, then refilled) | `cfg.cpp:65` |
| each `nw.ins[i].ip/gw/sn` | Static IP of that network reset to 0 (DHCP) when the entry is present without them | `cfg.cpp:98-109` |

Array replacement semantics:

| Array | Behaviour |
|---|---|
| `hw.led.ins` | Replaces the **entire** bus list; send all outputs. Missing per-bus fields get defaults (`len` 1, `type` WS2812 RGB, `ledma` 55, …). Buses are rebuilt live in the main loop (`doInitBusses`), no reboot needed. Entries with `start+len > MAX_LEDS` are dropped. | 
| `hw.btn.ins` | Replaces all buttons, re-allocating pins immediately |
| `timers.ins` | Clears and replaces all timers |
| `hw.com` | Entries are added to the existing color-order map without clearing it first (`cfg.cpp:350-358`) |

What takes effect when:

| Category | Applied | Notes |
|---|---|---|
| Light/sync/nightlight/defaults/NTP/MQTT/overlay/timers | Immediately (globals set) | MQTT reconnect happens on its own 30 s cycle |
| LED buses (`hw.led.ins`) | Next loop iteration (`wled.cpp:239-248`) | Segments are realigned or fixed |
| Buttons, IR pin, relay pin, I2C/SPI pins, serial baud | Immediately | `Wire.setPins` can fail if already initialised (ESP32) |
| 2D matrix panels (`hw.led.matrix`) | Panel list updated, but `setUpMatrix()` is **not** called from here (`cfg.cpp:219-220`) | Reboot required |
| WiFi networks, AP, mDNS name, Ethernet, UDP ports | Values stored but no reconnect or re-bind is triggered from the JSON path | Send `rb:true` or reboot. The form path (`/settings/wifi`) does set `forceReconnect` (`set.cpp:48-151`). |
| Usermods (`um`) | `readFromConfig()` per usermod | Some usermods need reboot |

## Files: `/upload` and `/edit`

### `POST /upload`

Multipart form upload, one file per request (`wled_server.cpp:206-236`, `:501-504`). The **multipart filename** is the destination path (leading `/` added if missing). Field name is not checked (stock UI uses `data`, `common.js:171-191`).

- Requires `correctPIN`; otherwise `401` "Please unlock settings using PIN code!" (plain text).
- No size check, no path restriction.
- Success: `200 text/plain` "File Uploaded!". If the filename contains `cfg.json`: "Config restore ok.\nRebooting..." and the device **reboots**. If it contains `palette` and `.json`: custom palettes are reloaded. If it is `/presets.json`: `fs.pmt` updated.
- `cacheInvalidate++` changes the ETag of static pages; FS usage refreshed.

### `GET /edit`

PIN-protected (`401` HTML otherwise). Registered for GET only (`wled_server.cpp:240-331`).

| Query | Result |
|---|---|
| (none) | Editor HTML |
| `?func=list` or `?list=…` | JSON `[{"name":"presets.json","type":"file","size":1234}, …]` for root directory; `wsec.json` hidden |
| `?func=edit&path=/x.json` | File content |
| `?func=download&path=/x.json` | File as attachment |
| `?func=delete&path=/x.json` | Deletes the file (**a GET with side effects**); `200` "File deleted" or `500` |

Missing `path` → 400; nonexistent → 404; any path containing `wsec.json` → 403.

Any FS file can also be fetched directly by path through the fallback handler (e.g. `/ledmap.json`, `/palette0.json`, `/presets.json`); `?download` forces attachment (`file.cpp:494`). Gzipped `<path>.gz` is served if present.

## Reboot

- `GET /reset`: HTML "Rebooting now..." then reboot (`wled_server.cpp:408-411`). No PIN check.
- JSON: `{"rb":true}` on `/json/state` (ignored if `psave` present) or `/json/cfg`.
- Legacy: `/win&RB`.
- Reboot is executed at the end of the next loop iteration, after any pending bus init and config write (`wled.cpp:277-278`). Expect the device to be unreachable for ~5-10 s.

## Legacy HTTP API: `/win`

Any GET whose URL contains `win` and is not otherwise routed goes to `handleSet()` (`wled_server.cpp:687`, `set.cpp:913`). Parameters are `&KEY=value` pairs (`A` brightness, `R/G/B/W` color, `FX`, `SX`, `IX`, `FP` palette, `PL` preset, `T` on/off/toggle, `SM/SS/SV` segment select, `S/S2` bounds, `NL/ND/NT/NF` nightlight, `TT` transition, `RB` reboot, `NN` no notify, etc.). Most values accept the same `~` / `r` syntax via `parseNumber()`. Response is XML (`xml.cpp:12-30`):

```xml
<?xml version="1.0" ?><vs><ac>bri</ac><cl>R</cl><cl>G</cl><cl>B</cl><cs>…</cs>…<ds>name</ds><ss>selSeg</ss></vs>
```

It operates on the first selected segment and fills legacy globals. Use the JSON API instead. The JSON API exposes the same parser via `"win":"&FX=5"`, and presets can store `win` strings.

## Settings pages

The settings UI is form-based; details are covered in the settings audit. Endpoints a server would touch:

### `GET /settings/s.js?p=N`

Returns `application/javascript` with `Cache-Control: no-store`: a single function `function GetV(){var d=document; … }` that assigns current values into the settings form fields (`wled_server.cpp:719-743`, `xml.cpp:203+`). It is **JS source, not JSON**; parsing it means evaluating or regex-extracting `d.Sf.XX.value=…` style assignments.

| p | Page (`const.h:544-556`) |
|---|---|
| 0 | Menu |
| 1 | WiFi |
| 2 | LEDs |
| 3 | UI |
| 4 | Sync |
| 5 | Time |
| 6 | Security |
| 7 | DMX (only with `WLED_ENABLE_DMX`) |
| 8 | Usermods |
| 9 | Update |
| 10 | 2D |
| 11 | Pins |

`p > 11` → `501` JS alert. `p > 0` with a PIN set and not unlocked → `401` JS `alert('PIN incorrect.');`. The URL only needs to contain `sett` and `.js` (`wled_server.cpp:750-751`).

### `POST /settings/<page>`

Form-encoded (`application/x-www-form-urlencoded`), routed by substring: `wifi`, `leds`, `ui`, `sync`, `time`, `sec`, `dmx`, `um`, `2D`, `pins`, `lock` (`wled_server.cpp:750-768`). Rules (`wled_server.cpp:773-824`):

- Source IP must be in 10/8, 172.16/12, 192.168/16, the device's own subnet, or the AP subnet 4.3.2.0/24 (`inLocalSubnet()`, `wled_server.cpp:76-82`); otherwise `401`. A proxy server reaching the device from another range (e.g. Tailscale 100.64/10 or a Docker bridge address that is not NATed to the LAN) is rejected.
- PIN required for pages above WiFi (or above menu once WiFi is configured) and below `lock` when a PIN is set.
- Response is an HTML message page (200, or 401), not JSON.
- WiFi page saves trigger `forceReconnect`; security page with a factory-reset or OTA change can set `doReboot`; usermod page reboots if `RBT` is present (`set.cpp:902-905`).

Because `/json/cfg` accepts the same settings as JSON and returns a status, it is the simpler path for a server. Forms are needed only where the JSON path lacks side effects (WiFi reconnect) or for fields only parsed in `set.cpp`.

## Firmware update

### `GET /update`

Serves the update page, or `401` if OTA locked (`wled_server.cpp:511-516`). ESP32: `GET /update?revert` from a local subnet rolls back to the previous OTA partition and reboots (`wled_server.cpp:843-855`).

### `POST /update`

Multipart upload of the `.bin` (or gzipped bin where supported) (`wled_server.cpp:518-562`, `wled00/ota_update.cpp`).

Checks at the first chunk:
1. Client subnet: if `ota.same-subnet` is on and no PIN is set, client must be in the device's subnet; if `same-subnet` is off, client must be in a private range (`wled_server.cpp:543`).
2. `correctPIN`.
3. `otaLock` off.

Failures reply HTML `401`. Release check: the binary's embedded metadata `release_name` must match the running `info.release`, and the running version must be at least the image's "safe update version"; otherwise the update fails with "Firmware release name mismatch…" (`wled_metadata.cpp:151-190`). To bypass, send form field `skipValidation=1`, and it must come **before** the file part because it is read when the first file chunk arrives (`ota_update.cpp:248-252`). `Update.begin()` uses `Content-Length` as the image size (`ota_update.cpp:255`).

Response: HTML "Update successful!" (200) and reboot, or "Update failed!" (500) with the reason. During the upload the strip is suspended and segments are reset (`ota_update.cpp:238-243`).

### `POST /updatebootloader` (ESP32 only)

Same checks; flashes a bootloader image (`wled_server.cpp:571-616`).

## Small utility endpoints

| Endpoint | Response | Source |
|---|---|---|
| `GET /version` | `text/plain` build number (same as `info.vid`) | `wled_server.cpp:479-481` |
| `GET /uptime` | `text/plain` `millis()` | `wled_server.cpp:483-485` |
| `GET /freeheap` | `text/plain` bytes | `wled_server.cpp:487-489` |
| `GET /liveview`, `/liveview2D` | Stock liveview pages | `wled_server.cpp:358-365` |
| `GET /cpal.htm` | Custom palette editor | `wled_server.cpp:664-667` |
| `GET /pixelforge.htm`, `/pixart.htm`, `/pxmagic.htm` | Optional tools | `wled_server.cpp:633-662` |
| `GET /settings`, `/welcome` | Settings HTML | `wled_server.cpp:382-406` |
| `GET /skin.css` | User CSS file or empty | `wled_server.cpp:397-402` |
| `GET /teapot` | 418 | `wled_server.cpp:497-499` |
| `GET /dmxmap` | DMX builds only | `wled_server.cpp:618-622` |
| `GET /u` | Usermod page, `WLED_ENABLE_USERMOD_PAGE` only | `wled_server.cpp:491-495` |

Static pages use `ETag` = `<build time>-<cacheInvalidate>-<suffix>` with `Cache-Control: no-cache` and honor `If-None-Match` (`wled_server.cpp:88-123`). In AP mode, requests with a non-IP, non-mDNS `Host` header are redirected to `http://4.3.2.1` (captive portal, `wled_server.cpp:333-347`).

Alexa/Hue emulation (Espalexa) can also answer unrouted URLs when Alexa is enabled (`wled_server.cpp:688-690`).
