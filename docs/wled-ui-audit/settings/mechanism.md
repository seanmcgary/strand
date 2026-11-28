# WLED settings pages: load/save mechanism

Source: WLED 17.0.0-dev at `/Users/seanmcgary/Code/WLED`. All paths below are relative to `wled00/`.

## Overview

Every stock settings page is a static HTML form (`<form id="form_s" name="Sf" method="post">`) compiled into flash. Current values are not embedded in the HTML. Each page:

1. Loads `common.js`, then `style.css` (`data/settings_leds.htm:31-37`, `data/common.js:82-112`).
2. Loads a device-generated script `/settings/s.js?p=N` via `loadJS()` (`data/common.js:114-132`). That script defines a single function `GetV()` whose body assigns form values. `loadJS` calls an optional `preGetV` hook, then `GetV()`, then an optional `postGetV` hook.
3. On save, the browser does a normal form POST (`application/x-www-form-urlencoded`) to the page's own URL (`/settings/<page>`). The firmware routes it by URL substring to a subpage number and calls `handleSettingsSet(request, subPage)` (`set.cpp:13`).
4. The response is an HTML message page ("LED settings saved.") with a JS redirect, not JSON (`wled_server.cpp:795-823`, `wled_server.cpp:171-200`).

There is a parallel JSON path: `GET /json/cfg` returns the full config tree and `POST /json/cfg` applies a (partial) config tree through `deserializeConfig()` (`cfg.cpp:47`, `wled_server.cpp:428-475`). See the last section.

## Subpage number map

Constants in `const.h:544-561`. URL-to-subpage routing is substring matching in `serveSettings()` (`wled_server.cpp:746-771`), evaluated in this order: `.js`, `.css`, `wifi`, `leds`, `ui`, `sync`, `time`, `sec`, `dmx`, `um`, `2D`, `pins`, `lock`. Only URLs containing `sett` get settings routing; `/update` maps to 9; anything else served by `serveSettings` is the welcome page.

| # | Constant | URL (GET page / POST target) | HTML file | `s.js?p=N` content (`xml.cpp`) | POST handler (`set.cpp`) | Notes |
|---|---|---|---|---|---|---|
| 0 | `SUBPAGE_MENU` | `/settings` | `settings.htm` | Hides 2D button if `WLED_DISABLE_2D`, shows DMX button if `WLED_ENABLE_DMX` (`xml.cpp:211-219`) | none (rejected, `set.cpp:22`) | Never PIN-protected |
| 1 | `SUBPAGE_WIFI` | `/settings/wifi` | `settings_wifi.htm` | `xml.cpp:221-334` | `set.cpp:25-173` | Not PIN-protected if WiFi not yet configured (`wled_server.cpp:773`). Blocked entirely if `wifiLock && otaLock` (`wled_server.cpp:780`) |
| 2 | `SUBPAGE_LEDS` | `/settings/leds` | `settings_leds.htm` | `xml.cpp:336-470` | `set.cpp:176-427` | See `led-hardware.md` |
| 3 | `SUBPAGE_UI` | `/settings/ui` | `settings_ui.htm` | `xml.cpp:472-476` (only `DS`, `SU`) | `set.cpp:430-438` | Rest of UI page is browser localStorage |
| 4 | `SUBPAGE_SYNC` | `/settings/sync` | `settings_sync.htm` | `xml.cpp:478-595` | `set.cpp:441-551` | Also runs `alexaInit()` after save (`set.cpp:899`) |
| 5 | `SUBPAGE_TIME` | `/settings/time` | `settings_time.htm` | `xml.cpp:597-651` | `set.cpp:554-645` | Also holds button macros (`MP/ML/MD{n}`) and timers |
| 6 | `SUBPAGE_SEC` | `/settings/sec` | `settings_sec.htm` | `xml.cpp:653-675` | `set.cpp:648-693` | PIN set here; factory reset `RS` reboots |
| 7 | `SUBPAGE_DMX` | `/settings/dmx` | `settings_dmx.htm` | `xml.cpp:677-703` | `set.cpp:695-723` | Only with `WLED_ENABLE_DMX` |
| 8 | `SUBPAGE_UM` | `/settings/um` | `settings_um.htm` | `xml.cpp:705-722` (GPIO info + usermod config JS) | `set.cpp:726-861` | Page also reads `/json/cfg`. `RBT` checkbox triggers reboot (`set.cpp:897`) |
| 9 | `SUBPAGE_UPDATE` | `/update` | `update.htm` | nothing | none | OTA page, PIN-checked via `serveSettings` |
| 10 | `SUBPAGE_2D` | `/settings/2D` | `settings_2D.htm` | `xml.cpp:724-754` | `set.cpp:863-893` | Only without `WLED_DISABLE_2D`. Case-sensitive `2D`. See `2d.md` |
| 11 | `SUBPAGE_PINS` | `/settings/pins` | `settings_pininfo.htm` | `xml.cpp:756-759` (GPIO info only) | none (`set.cpp:22` rejects > 10) | Read-only. See `pins.md` |
| 251 | `SUBPAGE_LOCK` | `/settings/lock` | none | n/a | n/a | Re-locks settings: `correctPIN = !strlen(settingsPIN)` (`wled_server.cpp:861-865`) |
| 252 | `SUBPAGE_PINREQ` | (internal) | `settings_pin.htm` (HTTP 401) | n/a | `set.cpp:15-19` calls `checkSettingsPIN` | Substituted for any protected page while locked |
| 253 | `SUBPAGE_CSS` | `/settings/*.css` | `style.css` | n/a | n/a | |
| 254 | `SUBPAGE_JS` | `/settings/s.js?p=N`, `/settings/common.js` | n/a | `serveSettingsJS()` | n/a | `wled_server.cpp:719-743` |
| 255 | `SUBPAGE_WELCOME` | `/welcome` | `welcome.htm` | n/a | n/a | |

`handleSettingsSet` only processes subpages 1-10 and only if `correctPIN` is true (`set.cpp:22`).

## `/settings/s.js?p=N`

Served by `serveSettingsJS()` (`wled_server.cpp:719-743`):

- `p > 11` → HTTP 501 with body `alert('Settings for this request are not implemented.');`
- `p > 0` while locked (PIN set and not entered) → HTTP 401 with body `alert('PIN incorrect.');`
- Otherwise HTTP 200, `Cache-Control: no-store`, body `function GetV(){var d=document; ...}`.

The body is produced by `getSettingsJS()` (`xml.cpp:203`). It is a flat sequence of JS statements built from these helpers (`util.cpp:123-143`):

| Helper | Emits |
|---|---|
| `printSetFormValue(key, int)` | `d.Sf.KEY.value=123;` |
| `printSetFormValue(key, str)` | `d.Sf.KEY.value="text";` (no escaping of quotes or backslashes) |
| `printSetFormCheckbox(key, v)` | `d.Sf.KEY.checked=1;` |
| `printSetFormIndex(key, i)` | `d.Sf.KEY.selectedIndex=2;` |
| `printSetClassElementHTML(cls, i, s)` | `d.getElementsByClassName("cls")[i].innerHTML="s";` |

It also calls page-defined functions to build dynamic rows, for example `addLEDs(1)`, `bLimits(...)`, `resetCOM(n)`, `addCOM(s,l,o)`, `addBtn(i,p,t)` on the LED page and `resetPanels()`, `addPanel(i)` on the 2D page. It also assigns arrays onto `d` (`d.ledTypes`, `d.um_p`, `d.rsvd`, `d.ro_gpio`, `d.max_gpio`, `d.touch`, `d.adc`).

Consequences for a replacement:

- `s.js` is not JSON. Consuming it requires either executing it in a sandbox with stubs for `d.Sf.<name>` and the page functions, or regex-parsing. String values are unescaped, so a device name containing `"` produces broken JS.
- `s.js` is the only source for some data: the LED type list with capability flags, platform bus limits (`bLimits`), reserved/read-only/touch/ADC GPIO lists. See `led-hardware.md` and `pins.md`.

### GPIO info block (`appendGPIOinfo`, `xml.cpp:95-200`)

Emitted for p=2, p=8, p=11.

| Variable | Content |
|---|---|
| `d.um_p` | `[-1, ...]` pins reserved by I2C, SPI and usermods (scanned from usermod config keys ending in `pin`). Leading `-1` is a placeholder; the LED page shifts it off (`settings_leds.htm:56`) |
| `d.rsvd` | Pins where `PinManager::isPinOk(i,false)` is false (flash/PSRAM pins etc.), plus DMX pin 2, debug TX, Ethernet pins when compiled in |
| `d.ro_gpio` | Input-only pins |
| `d.max_gpio` | `WLED_NUM_PINS` |
| `d.touch` | Touch-capable pins (ESP32/S2/S3 only, otherwise `[]`) |
| `d.adc` | ADC-capable pins |

## Form POST semantics

Handled by `serveSettings(request, true)` (`wled_server.cpp:785-823`) then `handleSettingsSet` (`set.cpp:13`).

- Source IP must be RFC1918 (10/8, 172.16/12, 192.168/16), the WLED AP subnet, or WLED's own subnet, otherwise HTTP 401 "Access Denied" (`wled_server.cpp:76-82`, `786-790`). `/json/cfg` has no such check.
- Checkboxes are read as presence: `request->hasArg("X")`. An unchecked box is simply absent. A replacement that omits a checkbox field turns that setting off.
- Numeric fields are read with `request->arg("X").toInt()`. A missing field reads as `""` → `0`. Many handlers have no presence check, so omitting a field writes 0. Examples on the LED page: missing `IR` or `RL` attempts to allocate GPIO0 for IR/relay (`set.cpp:313-329`); missing `FR` sets unlimited FPS (`set.cpp:215`); missing `MA` disables the global limiter (`set.cpp:205`); missing `CA` sets boot brightness 0 (`set.cpp:394`); missing `GV` disables gamma (`set.cpp:401-406`). **A form POST must always carry the full field set of that page.**
- Dynamic lists (LED buses, buttons, color-order overrides, 2D panels, WiFi networks) are rebuilt from scratch from whatever indexed fields are present. Omitted rows are deleted.
- Disabled inputs are not submitted by browsers. The LED page relies on this: bus start (`LS{n}`) fields are disabled unless "Custom bus start indices" is ticked, and the server then computes starts cumulatively (`set.cpp:247`).
- After processing, `lastEditTime = millis()` and `configNeedsWrite = true` for all pages except LEDs (written after bus re-init) and factory reset (`set.cpp:894-897`). The actual write to `/cfg.json` happens in the next `loop()` (`wled.cpp:254`).

### Response

`serveMessage()` returns `PAGE_msg` HTML with a heading and subline (`wled_server.cpp:696-703`):

| Case | Status | Heading | Redirect |
|---|---|---|---|
| Normal save | 200 | `"<Page> settings saved."` | to `/settings` after 1 s |
| Save while locked (treated as PIN entry) and PIN wrong | 401 | `"PIN rejected"` | 3 s |
| WiFi save, or Sec/UM save with reboot | 200 | `"... settings saved."` + reboot/IP note | parent reload after 9 s (`optionType 129`) |
| PIN correct | 200 | serves the originally requested settings page HTML instead of a message | n/a |
| Non-local client | 401 | "Access Denied" | |
| WiFi page with `wifiLock && otaLock`, or a locked POST within 3 s of the last attempt | 401 | "Access Denied" / "Please unlock OTA in security settings!" | |

There is no machine-readable success payload. A replacement should treat 200 as success and 401 as locked/denied, and re-read config afterwards to confirm.

## PIN lock

State: global `settingsPIN` (4 digits or empty) and global `correctPIN` (bool).

- Lock is device-wide, not per client or session. Once anyone enters the PIN, every client is unlocked.
- `checkSettingsPIN(pin)` (`util.cpp:502-508`): if currently locked and the previous attempt was < 3 s ago (`PIN_RETRY_COOLDOWN`, `const.h:728`), the attempt is ignored. Otherwise `correctPIN = (settingsPIN empty || first 4 chars match)` and `lastEditTime = millis()`.
- Auto-relock: in `loop()`, if a PIN is set and `millis() - lastEditTime > 15 min` (`PIN_TIMEOUT`, `const.h:729`), `correctPIN = false` (`wled.cpp:189-192`). Any settings save also refreshes `lastEditTime`, so the window is "15 minutes since last PIN entry or settings save".
- Manual relock: `GET /settings/lock` (`wled_server.cpp:861-865`).

Ways to submit the PIN:

1. Form POST `PIN=1234` to any protected settings URL. While locked, `serveSettings` rewrites the subpage to `SUBPAGE_PINREQ` (`wled_server.cpp:773-777`), `handleSettingsSet` calls `checkSettingsPIN` (`set.cpp:15-19`). On success the originally requested page HTML is served (`wled_server.cpp:815-816`). The stock flow is: GET `/settings/leds` → 401 with `settings_pin.htm` → user submits the PIN form (no `action`, so it posts back to `/settings/leds`).
2. Include `"pin":"1234"` in any JSON POST to `/json/*` (state or cfg) (`wled_server.cpp:438`).

What is protected when locked:

| Endpoint | Locked behavior |
|---|---|
| `GET /settings/<page>` (p ≥ 1, or ≥ 2 if WiFi unconfigured) | 401 + PIN page |
| `POST /settings/<page>` | treated as PIN entry; settings data discarded |
| `GET /settings/s.js?p≥1` | 401 `alert('PIN incorrect.')` |
| `POST /json/cfg` | 401 JSON `{"error":ERR_DENIED}` (`wled_server.cpp:451-455`) |
| `/upload`, `/edit` | 401 (`wled_server.cpp:206-209`, `244-248`) |
| `GET /json/cfg` | **not protected** (`json.cpp:1367`, no PIN check in `serveJson`) |
| `GET /json/pins` | not protected |

`GET /json/cfg` does not leak passwords; it emits only `pskl` (length) fields (`cfg.cpp:879`, `907`).

## Reboot-required behavior

| Page | Applied how | Reboot? |
|---|---|---|
| LEDs (2) | `handleSettingsSet` fills `busConfigs` and sets `doInitBusses`; next `loop()` tears down and recreates all buses (`wled.cpp:239-248`, `FX_fcn.cpp` `finalizeInit`), realigns or fixes segments, then writes config | No. Exceptions flagged by the UI only: HUB75 on ESP32-S3 (`settings_leds.htm:156-158`) and "memory usage is high, reboot recommended" above 80% (`settings_leds.htm:163`) |
| 2D (10) | Applied inline: `strip.suspend()`, `deserializeMap()`, `makeAutoSegments(true)`, `resume()` (`set.cpp:887-892`) | No. Segments are force-recreated |
| WiFi (1) | `forceReconnect` | No, reconnect |
| Sec (6) | Factory reset (`RS`) formats FS and reboots | Only for reset |
| UM (8) | Usermod `readFromConfig`; reboot if `RBT` | Optional |
| Others | Live | No |
| `POST /json/cfg` | Live; `"rb":true` schedules reboot (`cfg.cpp:778`) | Optional |
| Upload of `cfg.json` via `/upload` | Reboots (`wled_server.cpp:225-228`) | Yes |

Reboot endpoints: `GET /reset` (`wled_server.cpp:408-411`) or `{"rb":true}` in a `/json/state` POST (`json.cpp:440`).

## `/json/cfg` as an alternative

- `GET /json/cfg` → `serializeConfig()` (`cfg.cpp:851`). Complete, structured config, same format as `/cfg.json` on flash. Passwords excluded.
- `POST /json/cfg` with a JSON body → `deserializeConfig(root)` (`cfg.cpp:47`) applies whatever subtrees are present, then:
  - if buses were included, `doInitBusses` is set and the config is written after re-init (`cfg.cpp:779`);
  - otherwise saved unless `"sv":false` (`cfg.cpp:780`);
  - `"rb":true` reboots after save (`cfg.cpp:778`);
  - response `{"success":true}` (`wled_server.cpp:474`).
- Request size limit is `JSON_BUFFER_SIZE`: 10240 B on ESP8266, 24576 B on S2, 32767 B otherwise (`const.h:657-664`). Posting the entire GET body back can exceed this on ESP8266; post only the subtrees you change.
- The stock UI already uses this path for usermods (`data/settings_um.htm:25`). `cfg.cpp:6` states the structure "is not to be considered an official API and may change without notice"; the form field names carry the same caveat in practice.

### Partial-POST traps in `deserializeConfig`

Most keys use `CJSON(a,b)` (`a = b | a`), so a missing key leaves the value unchanged. Some do not:

| Key missing | Effect | Source |
|---|---|---|
| `hw.led.rgbwm` | global auto-white override reset to 255 (disabled) | `cfg.cpp:183` |
| `hw.led.fps` | target FPS reset to 42 | `cfg.cpp:189-190` |
| `light.gc.bri` / `light.gc.col` | brightness gamma forced off; color gamma forced on (col defaults to `gammaCorrectVal` ≠ 1) | `cfg.cpp:531-536` |
| `hw.btn.ins[].macros` (when `ins` present) | button macros reset to 0 | `cfg.cpp:414-418` |
| `hw.led.ins[].maxpwr` | recomputed as `maxpwr * len / total` | `cfg.cpp:250` |
| `hw.led.matrix` | cannot be used to turn 2D off; absence leaves `isMatrix` unchanged | `cfg.cpp:194-221` |

Other differences from the form path:

- `hw.led.ins` replaces the whole bus list. Absent `ins` leaves buses untouched, which is better than the form path.
- `hw.ir.pin` / `hw.relay.pin`: absent means unchanged (sentinel `-2`, `cfg.cpp:456`, `473`).
- Units differ: `light.tr.dur` is in 100 ms units (form `TD` is ms); `hw.led.ins[].freq` is the raw frequency (Hz for PWM, kHz for 2-pin), not the 0-4 index the form uses; `hw.led.ins[].order` packs color order (low nibble) and W-swap (high nibble); `hw.relay.rev` is the inverse of form `RM`.
- Panel changes in `hw.led.matrix` are stored but `setUpMatrix()` is not called (`cfg.cpp:219-220`). They take effect only after a bus re-init (include `hw.led.ins` in the same POST) or reboot.
- No UI-side validation runs: no pin-conflict checks, no memory budget, no bus-count limits beyond `WLED_MAX_BUSSES` (`cfg.cpp:229`). Pin allocation failures are silent (pin set to -1).

## Replacement notes

MVP scope (PRD §16-§17, §21): LED Hardware, Network, Sync, System. Everything else links to the stock page (`http://<device>/settings/<page>`).

Recommendation: **read with `GET /json/cfg`, write with `POST /json/cfg`**, for the sections in MVP scope.

- `/json/cfg` gives structured data, supports partial updates, has no private-IP check, returns JSON, and is already used by the stock usermod page.
- Always do read-modify-write of whole subtrees (`hw.led` including `fps`, `rgbwm`, `ins`; `light` including `gc`; `hw.btn` including macros) to avoid the reset-on-missing traps above.
- Fetch `/settings/s.js?p=2` once per device (and after firmware change) for the LED type table, `bLimits` and GPIO lists. Execute it in a sandboxed JS context (e.g. Node `vm`) with a proxy `d.Sf` and stub `addLEDs/bLimits/resetCOM/addCOM/addBtn`, or regex out `d.ledTypes=...;`, `bLimits(...)`, `d.rsvd=[...]` etc.
- Fall back to form POST only where JSON cannot do the job: turning 2D matrix off (`POST /settings/2D` with `SOMP=0`) and forcing immediate 2D re-layout.
- If a form POST is used, send every field of that page, not just changed ones.

PIN handling: the server should accept a device PIN, send it as `"pin"` in every `/json/cfg` POST, and handle 401 by prompting. Unlocking is global on the device for up to 15 minutes, which also unlocks the stock UI for everyone.

Out of scope for MVP: DMX (7), usermods (8), time/macros (5), security/PIN management (6), UI page (3), OTA (9).
