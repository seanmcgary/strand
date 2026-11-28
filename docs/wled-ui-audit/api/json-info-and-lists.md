# WLED JSON API: info and list endpoints

Source: WLED 17.0.0-dev. Routing is in `serveJson()` (`wled00/json.cpp:1351-1433`). Sub-paths are matched with `url.indexOf(...) > 0` in this order: `state`, `info`, `si`, `nodes`, `eff`, `palx`, `fxda`, `net`, `cfg`, `pins`, `live` (only if `WLED_ENABLE_JSONLIVE`), `pal`. Any other path longer than `/json` returns `501 {"error":4}` (`json.cpp:1379-1382`).

| Path | Response | Uses JSON buffer lock |
|---|---|---|
| `/json` | `{state, info, effects, palettes}` | yes |
| `/json/state` | state (json-state.md) | yes |
| `/json/info` | info | yes |
| `/json/si` | `{state, info}` | yes |
| `/json/effects` (`eff`) | array of effect names | yes |
| `/json/fxdata` (`fxda`) | array of effect metadata strings, chunked | **no** |
| `/json/palettes`, `/json/pal` | array of built-in palette names (static flash string) | no |
| `/json/palx?page=N` | palette color data, paged | yes |
| `/json/nodes` | other WLED devices seen via UDP | yes |
| `/json/net` (`/json/networks`) | WiFi scan results | yes |
| `/json/cfg` | full config (other-endpoints.md) | yes |
| `/json/pins` | GPIO usage | yes |
| `/json/live` | LED colors snapshot; **only compiled when WebSockets are disabled** (`wled00/wled.h:47-51`). With the default build it returns 501. | no |

## /json/info

`serializeInfo()` (`wled00/json.cpp:707-941`).

### Identity and version

| Key | Type | Meaning | Source |
|---|---|---|---|
| `ver` | string | Version string, e.g. `"17.0.0-dev"` (from build metadata) | `json.cpp:709`, `wled_metadata.h:37` |
| `vid` | int | Build number `YYMMDDB` style, `2607201` for this tree. Same value as `GET /version`. | `json.cpp:710`, `wled.h:10` |
| `cn` | string | Codename, `"Kagayaki"` | `json.cpp:711`, `wled.h:288` |
| `release` | string | Release name (build target, used for OTA compatibility check) | `json.cpp:712` |
| `repo` | string | Source repository | `json.cpp:713` |
| `deviceId` | string | 42-char salted SHA1 of MAC + chip info; stable across flash erase. Omitted on ESP-IDF ≥ 6. | `json.cpp:714-721`, `util.cpp:1548-1566` |
| `name` | string | Device name (`serverDescription`, max 32) | `json.cpp:769` |
| `brand` | string | `"WLED"` unless overridden at build | `json.cpp:931`, `const.h:39` |
| `product` | string | `"FOSS"` unless overridden | `json.cpp:932` |
| `mac` | string | 12 lowercase hex chars, no separators | `json.cpp:933`, `wled.cpp:499-501` |
| `ip` | string | Current IP, `""` if not connected | `json.cpp:934-940` |
| `arch` | string | `"esp8266"`, `"esp32"` (classic), or `ESP.getChipModel()` e.g. `"ESP32-S3"`, `"ESP32-C3"` | `json.cpp:853-857`, `:871` |
| `core` | string | SDK / core version | `json.cpp:858`, `:872` |
| `clock` | int | CPU MHz | `json.cpp:859` |
| `flash` | int | Flash size in MB | `json.cpp:860` |
| `lwip` | int | ESP8266: lwIP major version; ESP32: always 0 (deprecated) | `json.cpp:866`, `:879` |
| `bootloaderSHA256` | string | ESP32 with OTA only | `json.cpp:867-869` |

### LEDs (`info.leds`)

| Key | Type | Meaning | Source |
|---|---|---|---|
| `count` | int | Total LEDs (for 2D: max of matrix size, configured length, and ledmap size) | `json.cpp:724`, `FX_fcn.cpp` `getLengthTotal()` |
| `pwr` | int | Estimated current, mA (0 if ABL disabled) | `json.cpp:725` |
| `fps` | int | Actual frames per second | `json.cpp:726` |
| `maxpwr` | int | ABL budget mA, 0 if ABL off | `json.cpp:727` |
| `maxseg` | int | Max segments: 16 (ESP8266), 32 (ESP32/S2/C3 without PSRAM), 64 (ESP32 with PSRAM) | `json.cpp:728`, `FX.h:85-97` |
| `bootps` | int | Boot preset ID, 0 = none | `json.cpp:731` |
| `matrix` | `{w,h}` | Present only if 2D matrix configured | `json.cpp:733-739` |
| `seglc` | int[] | Deprecated; capabilities of each active segment, same as `state.seg[].lc` | `json.cpp:742-749` |
| `lc` | int | OR of all active segments' capabilities (0x01 RGB, 0x02 W, 0x04 CCT) | `json.cpp:751` |
| `rgbw` | bool | Deprecated; any RGBW bus | `json.cpp:753` |
| `wv` | int | Deprecated; `lc & 0x02` (note: emitted as 0 or 2, not bool) | `json.cpp:754` |
| `cct` | int | Deprecated; `lc & 0x04` (0 or 4) | `json.cpp:755` |

Use `state.seg[].lc` per segment and `info.leds.lc` globally. A segment's `lc` is computed by walking every pixel through the ledmap to the bus that owns it (`FX_fcn.cpp:1153-1185`): RGB if the bus has RGB (or CCT with "CCT from RGB"); CCT if the bus has CCT, or white-balance correction is on; W slider if the bus has white and its auto-white mode is "none" or "dual"; buses with white in "brighter"/"accurate" mode report RGB instead of W.

### Runtime, network, storage

| Key | Type | Meaning | Source |
|---|---|---|---|
| `str` | bool | Always `false` (legacy) | `json.cpp:767` |
| `udpport` | int | UDP sync port (default 21324) | `json.cpp:770` |
| `simplifiedui` | bool | Simplified UI setting | `json.cpp:771` |
| `live` | bool | Realtime mode active | `json.cpp:772` |
| `liveseg` | int | Main segment ID if "use main segment only" live mode, else -1 | `json.cpp:773` |
| `lm` | string | Live source: `""`, `"UDP"`, `"Hyperion"`, `"E1.31"`, `"USB Adalight/TPM2"`, `"Art-Net"`, `"tpm2.net"`, `"DDP"`, `"DMX"` | `json.cpp:775-786` |
| `lip` | string | Live source IP or `""` | `json.cpp:788` |
| `ws` | int | Connected WebSocket clients; `-1` if WS compiled out. The stock UI uses `ws < 0` to decide not to open a socket (`data/index.js:1430`). | `json.cpp:790-794` |
| `fxcount` | int | Number of effect slots (including reserved) | `json.cpp:796` |
| `palcount` | int | Fixed (72) + usermod + custom palettes. A **count**, not a max ID. | `json.cpp:797`, `colors.h:77` |
| `cpalcount` | int | Custom palette slots, including gray placeholders for missing files | `json.cpp:798`, `colors.cpp:276-280` |
| `umpalcount` | int | Usermod palettes | `json.cpp:799` |
| `cpalmax` | int | Max custom palettes: 129 (ESP32), 10 (ESP8266) | `json.cpp:800`, `const.h:21-25` |
| `umpalnames` | string[] | Usermod palette names, only if any | `json.cpp:802-809` |
| `maps` | `[{id, n?}]` | Available ledmaps; `n` (name) only on ESP32 | `json.cpp:811-820` |
| `wifi.bssid` | string | Connected AP BSSID | `json.cpp:823` |
| `wifi.rssi` | int | dBm | `json.cpp:825` |
| `wifi.signal` | 0-100 | Quality % (-100 dBm → 0, -50 dBm → 100) | `json.cpp:826`, `network.cpp:312` |
| `wifi.channel` | int | Channel | `json.cpp:828` |
| `wifi.band` | string | `"2.4GHz"`, `"5GHz"`, `"(other)"` or `"not connected"` | `json.cpp:829-838` |
| `wifi.ap` | bool | Soft AP active | `json.cpp:839` |
| `wifi.txPower`, `wifi.sleep` | | ESP32 debug builds only | `json.cpp:849-852` |
| `fs.u` | int | FS used, **kB (÷1000)** | `json.cpp:842` |
| `fs.t` | int | FS total, kB | `json.cpp:843` |
| `fs.pmt` | int | Presets modified time (unix s). Changes on every preset save/delete/upload; use it to invalidate a cached `/presets.json`. | `json.cpp:844` |
| `ndc` | int | Node count from UDP discovery, `-1` if node list disabled | `json.cpp:846` |
| `freeheap` | int | Free heap bytes | `json.cpp:882` |
| `psram` | int | Free PSRAM bytes (only `BOARD_HAS_PSRAM` builds) | `json.cpp:883-889` |
| `psrSz` | int | PSRAM size MB | `json.cpp:888` |
| `uptime` | int | Seconds | `json.cpp:890` |
| `time` | string | Local time string | `json.cpp:892-894` |
| `opt` | bitmask | Build options: 0x01 OTA, 0x02 Adalight, 0x04 Hue sync, 0x08 filesystem (always), 0x10 Cronixie, 0x40 Alexa, 0x80 debug, 0x100 net debug | `json.cpp:898-929` |
| `maxalloc`, `resetReason*`, `i2c`, `spi` | | Debug builds only | `json.cpp:757-765`, `:861-865` |
| *(usermods)* | | `UsermodManager::addToJsonInfo()`; usermods typically add a `u` object of `name: [value, unit]` rows | `json.cpp:896` |

For discovery cards (PRD §6) the needed fields are `name`, `ip`, `ver`, `vid`, `leds.count`, `mac`, `arch`.

## /json/effects

Array of effect names; index = effect ID (`serializeModeNames()`, `json.cpp:1241-1253`). Metadata after `@` is stripped. Reserved/unused IDs are present as `"RSVD"` (`FX.cpp:11006`, `:11033-11041`). Effects compiled out by build flags (2D effects with `WLED_DISABLE_2D`, particle-system effects with `WLED_DISABLE_PARTICLESYSTEM*`) also show as `"RSVD"`, so the list differs between builds while IDs stay stable. Count is `MODE_COUNT` = 221 slots in this tree (`FX.h:379`), plus any usermod effects appended up to 255.

## /json/fxdata

Array with one string per effect ID: the text after `@` in the effect's metadata, `""` if none (`respondModeData()`, `json.cpp:1296-1325`). Streamed with chunked transfer encoding and does not take the JSON lock.

Metadata format, `"<sliders>;<colors>;<palette>;<flags>;<defaults>"`, as interpreted by the stock UI (`wled00/data/index.js:953-970`, `:1632-1745`) and by `extractModeDefaults()`:

| Field | Content |
|---|---|
| 0 sliders | Comma list for `sx, ix, c1, c2, c3, o1, o2, o3`. Empty entry = control hidden. `!` = default label ("Effect speed", "Effect intensity", …). Positions 5-7 are the checkboxes. |
| 1 colors | Comma list for color slots 1-3. Empty = hidden, `!` = default label (Fx/Bg/Cs), otherwise a label. |
| 2 palette | Empty or numeric = palette not used; `!` = palette used; a label = palette used with that label; `label=N` embeds a default. |
| 3 flags | Characters: `0` 0D (PWM/on-off), `1` 1D, `2` 2D, `v` volume reactive, `f` frequency reactive. Missing = `1`. |
| 4 defaults | `key=value` pairs (`sx`, `ix`, `c1`-`c3`, `o1`-`o3`, `pal`, `m12`, `si`, `rev`, `mi`, `rY`, `mY`) applied when `fxdef:true` is sent with `fx` (`FX_fcn.cpp:722-741`). `pal` default is always loaded as the effect's "default palette" (palette 0 resolves to it). |

Examples: `"!,Size;;!"` (Rainbow), `"!,,Blur,,,,,Mutation;!,!;!;2;pal=11,sx=128"` (Game of Life). Effect 0 (Solid) has `""`; the stock UI replaces index 0 with `";!;"` and treats any empty string as `";;!;1"` (`index.js:572-574`, `:955`). Effects without metadata show only speed and intensity (`index.js:1645`).

## /json/palettes (and /json/pal)

Static JSON array of the 72 fixed palette names (IDs 0-71) from flash (`json.cpp:1375-1377`, `FX_fcn.cpp:2404`). It does **not** include custom or usermod palettes. Names starting with `*` (IDs 1-5) are dynamic color-slot palettes.

## /json/palx?page=N

Palette color data for previews (`serializePalettes()`, `json.cpp:983-1058`).

```json
{"m": 15, "p": {"0": [[0,r,g,b], ...], "1": ["r","r","r","r"], "2": ["c1"], ...}}
```

- Items per page: 8 on ESP32, 5 on ESP8266 (`json.cpp:986-990`).
- `m` = last page index = `total / itemsPerPage` (integer division), so valid pages are `0..m` inclusive; the last page can be empty. `page > m` is clamped to `m`.
- Sequential index *i* maps to palette ID: `i < 72` → ID *i*; next `umpalcount` entries → IDs 255, 254, …; then custom palettes → IDs 200, 199, … (`json.cpp:1005-1014`, `const.h:14-20`).
- Each palette is an array of `[pos, r, g, b]` stops (pos 0-255), or placeholder strings for dynamic palettes: `"r"` random (ID 1), `"c1"`/`"c2"`/`"c3"` meaning the segment's color slots (IDs 2-5). ID 0 ("Default") is serialized as Party colors, but at runtime it resolves to the current effect's default palette.
- Custom palettes are read from `/palette<N>.json` (N = 0..cpalmax-1, palette ID = 200 − N). Missing files inside the range become gray placeholders so later IDs stay stable (`colors.cpp:267-280`). The stock UI hides those.

Palette ID ranges overall: 0-71 fixed, 72..200 custom (from the top down), 201..255 usermod (from the top down) (`const.h:14-20`).

## /json/nodes

```json
{"nodes": [{"name":"Kitchen","type":32,"ip":"192.168.1.40","age":0,"vid":2607201}, ...]}
```

`serializeNodes()` (`json.cpp:1092-1108`). Filled from UDP node broadcasts (see discovery.md). `type` low 7 bits = board type ID (`wled00/NodeStruct.h:11-32`: 82 ESP8266, 32 ESP32, 33 S2, 34 S3, 35 C3, 37-45 newer chips); bit 7 = device was on when it broadcast. `age` counts 30 s refresh cycles without a broadcast; entries are dropped at 10 (`udp.cpp:675-692`). The device does not list itself.

## /json/net

`{"networks":[{"ssid","rssi","bssid","channel","enc"}]}` (`json.cpp:1060-1090`). Asynchronous: the first call starts a scan and returns an empty array; poll until results appear. Results are deleted after being returned and a new scan starts on the next call.

## /json/pins

`{"pins":[...]}`, one entry per GPIO that is usable or allocated (`json.cpp:1110-1237`):

| Key | Meaning |
|---|---|
| `p` | GPIO number |
| `c` | Capability bits: 0x02 ADC, 0x08 boot pin, 0x10 strapping pin, 0x20 input-only (`pin_manager.h:14-18`) |
| `a` | Allocated |
| `o`, `n` | Owner ID and owner name (if allocated) |
| `m` | Mode: 0 input (button), 1 output (relay, on/off bus, multi-relay) |
| `s` | Current state 0/1 |
| `t` | Button type (buttons only) |
| `r` | Raw touch or analog reading (touch/analog buttons only) |

## /json/live (only with WebSockets disabled)

`{"leds":["RRGGBB",...],"n":N[,"w":W,"h":H]}` (`json.cpp:1435-1500`). At most 256 LEDs; every Nth LED is sampled. Colors are brightness-scaled, with white added into RGB. With the default build (WebSockets enabled) use the WS binary liveview instead (websocket.md).
