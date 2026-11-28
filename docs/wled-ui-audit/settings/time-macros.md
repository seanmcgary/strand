# Time & Macros (`settings_time.htm`)

Source: `wled00/data/settings_time.htm`. Loaded at `/settings/time`, values from `GET /settings/s.js?p=5` (`wled00/xml.cpp:597-651`), saved via `POST /settings/time` → `wled00/set.cpp:554-645`. Save response "Time settings saved." with 1-second redirect. All fields apply live; nothing on this page needs a reboot.

## Page load sequence

1. `populatePresets(true)` reads the preset list from `localStorage["wledP"]`, the cache the main UI writes (`settings_time.htm:35-49`). If the main UI has never been opened in this browser, it shows a toast "Please visit the main UI first to load presets" and all preset dropdowns stay as raw numbers / "Select preset" only. The page never fetches `/presets.json` itself.
2. `loadJS('/settings/s.js?p=5')`: before-hook `BTa()` writes the timer table header; the script then sets form values and calls `addRow(...)` per button and `addTimerRow(...)` per timer; after-hook `updLatLon()` and `Cs()` (`:26-34`).
3. On submit, `Wd()` packs weekday checkboxes into each `W{i}` hidden field, re-enables the hour input with 255/254 for sunrise/sunset rows, and turns N/S, E/W selects into signed lat/lon (`:265-283`).

## Time setup

| Label | Field | Type / range | set.cpp |
|---|---|---|---|
| Get time from NTP server | `NT` | checkbox (`settings_time.htm:382`) | `set.cpp:556`. If enabled and connected, opens NTP UDP socket now; forces an NTP query (`:563-564`). |
| (NTP server host, unlabeled) | `NS` | text, maxlength 32 (`:383`) | `set.cpp:557`. Default `0.wled.pool.ntp.org`. |
| Use 24h format | `CF` | checkbox (`:384`) | `set.cpp:558` → `useAMPM = !CF`. Affects clock display (overlays, info). |
| Time zone | `TZ` | select 0-24: 0 GMT(UTC), 1 GMT/BST, 2 CET/CEST, 3 EET/EEST, 4 US-EST/EDT, 5 US-CST/CDT, 6 US-MST/MDT, 7 US-AZ, 8 US-PST/PDT, 9 CST (AWST, PHST), 10 JST (KST), 11 AEST/AEDT, 12 NZST/NZDT, 13 North Korea, 14 IST (India), 15 CA-Saskatchewan, 16 ACST, 17 ACST/ACDT, 18 HST (Hawaii), 19 NOVT (Novosibirsk), 20 AKST/AKDT (Anchorage), 21 MX-CST, 22 PKT (Pakistan), 23 BRT (Brasília), 24 AWST (Perth) (`:386-412`; table `wled00/ntp.cpp:29-55`) | `set.cpp:559`. Fixed table with built-in DST rules; no arbitrary POSIX TZ strings. |
| UTC offset (seconds, max 18 h) | `UO` | number -65500..65500, required (`:413`) | `set.cpp:560`. Added on top of the selected zone. |
| Current local time is ... | read-only `.times[0]` | from `getTimeString()` (`xml.cpp:608-609`) | — |
| Latitude | `LTR` (N/S select) + `LT` (number 0-66.6, step 0.01) (`:415`) | `LTR` not read by server; `Wd()` negates `LT` for S. | `set.cpp:567` → `latitude` float. |
| Longitude | `LNR` (E/W select) + `LN` (number 0-180, step 0.01) (`:416`) | `LNR` not read by server; `Wd()` negates `LN` for W. | `set.cpp:566`. Recomputes sunrise/sunset immediately (`:569`). |
| Get location (button) | — | opens `https://locate.wled.me` in a new tab and listens for a `postMessage` with `{lat, lon}` (`:354-367`) | — |
| Sunrise / Sunset | read-only `#sun` (`.times[1]`) | "Sunrise: HH:MM Sunset: HH:MM", only when lat or lon non-zero (`xml.cpp:610-613`) | — |

## Clock (overlays and countdown)

| Label | Field | Type / range | Visibility | set.cpp |
|---|---|---|---|---|
| Analog Clock overlay | `OL` | checkbox, `onchange=Cs()` (`:423`) | always | `set.cpp:571` → `overlayCurrent` (0/1) |
| First LED | `O1` | number 0-1024, required (`:425`) | `#cac`, shown when `OL` checked (`Cs()`, `:89`) | `set.cpp:573` |
| Last LED | `O2` | number 0-1024, required | `#cac` | `set.cpp:574` |
| 12h LED | `OM` | number 0-1024, required (`:426`) | `#cac` | `set.cpp:575` |
| Show 5min marks | `O5` | checkbox (`:427`) | `#cac` | `set.cpp:576` |
| Seconds (as trail) | `OS` | checkbox (`:428`) | `#cac` | `set.cpp:577` |
| Show clock overlay only if all LEDs are solid black | `OB` | checkbox (`:429`) | `#cac` | `set.cpp:578` |
| Countdown Mode | `CE` | checkbox (`:431`) | always | `set.cpp:580` |
| Countdown Goal date: 20`CY`-`CI`-`CD` | `CY` (0-99), `CI` (1-12), `CD` (1-31), all required (`:433`) | always | `set.cpp:581-583` |
| Countdown Goal time: `CH`:`CM`:`CS` | `CH` (0-23), `CM` (0-59), `CS` (0-59), required (`:434`) | always | `set.cpp:584-586`; `setCountdown()` at `:587` |

The HTML caps overlay LED indices at 1024; the server does not clamp, so larger strips need a different input range.

## Macro Presets

Intro text: presets act as macros; enter preset ID; 0 = default action. Once presets are loaded from localStorage, `pMP()` converts these number inputs into `<select>`s of "id: name" with "Default Action (0)" (`:199-220`).

### Timer & Alexa Presets

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Countdown-Over Preset | `MC` | number 0-250 → select (`:445`) | `set.cpp:591` → `macroCountdown` |
| Timed-Light-Over Presets (nightlight end) | `MN` | number 0-250 → select (`:446`) | `set.cpp:592` → `macroNl` |
| Alexa On Preset | `A0` | number 0-250 → select (`:447`) | `set.cpp:589` |
| Alexa Off Preset | `A1` | number 0-250 → select (`:447`) | `set.cpp:590` |

### Button Action Presets (`#macros`)

Rows are created by xml.cpp calling `addRow(index, shortPreset, longPreset, doublePreset, buttonType)` for every configured button (`xml.cpp:625-628`). The number of rows equals the number of buttons defined on the LED settings page (up to `WLED_MAX_BUTTONS`, 10 on ESP8266 / 32 on ESP32, `const.h:141-145`). Button index `i` is encoded as one char `b`: `0`-`9`, then `A`.. for 10+ (`settings_time.htm:286`; `set.cpp:595-597`).

| Button type (from LED page) | Rendered fields (`addRow`, `:284-353`) |
|---|---|
| Pushbutton (2), Push inverted (3), Touch (6), Disabled/other | "Button i - type": `MP{b}` Short press, `ML{b}` Long press, `MD{b}` Double press; each a preset select with "Default Action (0)" |
| Switch (4), PIR sensor (5), Touch switch (9) | "Switch i - type": `MP{b}` labelled "On → Off", `ML{b}` labelled "Off → On". No `MD`. |
| Analog (7), Analog inverted (8) | "Analog i - type": only `MD{b}` labelled "Analog function", options: 250 Global brightness, 249 Effect speed, 248 Effect intensity, 247 Palette, 200 Primary color hue, 0-32 Segment N opacity (`bAO()`, `:231-236`). |

set.cpp loops over all configured buttons and reads `MP{b}`, `ML{b}`, `MD{b}`; missing fields default to 0 (`set.cpp:593-603`). Stored in cfg.json at `hw.btn.ins[i].macros = [short, long, double]` (`cfg.cpp:1040-1048`).

### Time-Controlled Presets (schedules) (`#TMT`)

Up to `WLED_MAX_TIMERS` timers: 16 on ESP8266, 64 on ESP32 (`const.h:70`, `:115`; xml injects `maxTimers`, `xml.cpp:630`). Rows are dynamic, created by `addTimerRow(hour, minute, preset, weekdays, monthStart, dayStart, monthEnd, dayEnd)` (`settings_time.htm:94-170`). If no timers exist, one blank row is added (`xml.cpp:631-632`). `+` adds a row (`:458`); `-` removes it client-side immediately (`rTR`, `:171-174`); removal persists on Save.

Per timer, index `i` (0..63):

| Label | Field | Type / range | Notes |
|---|---|---|---|
| En. (enabled) | checkbox `W{i}0` (no name) | bit 0 of `W{i}` | Packed by `Wd()` |
| Type | select `TS{i}` (no name): 0 Regular, 255 Sunrise, 254 Sunset (`:133-137`) | UI only | `TT(i)` toggles hour input and minute range (`:175-198`) |
| Hour | `H{i}` | number 0-24 | For sunrise/sunset rows the input is disabled and unnamed; `Wd()` restores the name and sets value 255/254 before submit. Hour 24 means "every hour" (`ntp.cpp:465`). |
| Minute | `N{i}` | number 0-59 (regular) or -120..120 offset (sunrise/sunset) | `set.cpp:621-625` clamps to ±120 |
| Preset | `T{i}` | select of presets, 0 = "Select preset" (`:146`) | A timer with preset 0 never fires (`Timer::isEnabled`, `fcn_declare.h:249`) |
| Calendar icon | `CB{i}` | expands `#WD{i}` (`expand()`, `:85-88`) | — |
| Run on weekdays M T W T F S S | checkboxes `W{i}1`..`W{i}7` (no name) | bits 1-7 of `W{i}` (Mon=bit1 … Sun=bit7) | |
| (hidden) weekday bitmask | `W{i}` | 0-255 | `set.cpp:626-627` |
| from month | `M{i}` | select 1-12 | `set.cpp:629-631` (0 → 1) |
| from day | `D{i}` | number 1-31 | `set.cpp:635-637` (0 → 1) |
| to month | `P{i}` | select 1-12 | `set.cpp:632-634` (0 → 12) |
| to day | `E{i}` | number 1-31 | `set.cpp:638-640` (0 → 31) |

Server handling (`set.cpp:605-643`): `clearTimers()`, then for `ti` in 0..WLED_MAX_TIMERS-1, skip if `T{ti}` absent, otherwise `addTimer(...)` with validation in `wled00/ntp.cpp:594-629` (hour ≤24 or 254/255, minute range, months ≤12, days ≤31), then `compactTimers()`. Every save replaces the whole list. Execution: `checkTimers()` once per minute; matches hour/minute (or sunrise/sunset + offset), weekday bit, and date range, then `applyPreset()` (`ntp.cpp:429-475`). A date range with end before start wraps around the year.

cfg.json: `timers.ins[] {en, hour, min, macro, dow (weekdays>>1), start {mon, day}, end {mon, day}}`, `timers.cntdwn {goal[6], macro}` (`cfg.cpp:1227-1251`). Rows with preset 0, hour 0, minute 0 are dropped on serialize.

## Field-name collisions to watch

Names are only unique within this page: `CS`/`CM` here are countdown seconds/minutes, but `CM` is mDNS on the WiFi page and `CS` is DMX start channel on the DMX page. `D{i}` timer day vs `D0`-`D3` DNS on WiFi page. Do not merge forms across pages.

## Other cfg.json keys

`if.ntp {en, host, tz, offset, ampm, ln, lt}`, `ol {clock, cntdwn, min, max, o12pix, o5m, osec, osb}`, `if.va.macros[2]`, `light.nl.macro` for `MN` (`cfg.cpp:1207-1225`).

## Replacement notes

PRD scope: this page is not in §18-§20. None of it is MVP. Time-controlled presets are close to "complex automation" (PRD §3 non-goal) and are not in §15 presets requirements. Use the §21 escape hatch to `/settings/time`.

If a later version adds schedules:

- Timers are a full-replace list. Read `/json/cfg` `timers.ins`, edit, and write back the whole array (via form POST with every `T{i}/H{i}/N{i}/W{i}/M{i}/D{i}/P{i}/E{i}`, or `POST /json/cfg {"timers":{"ins":[...]}}`).
- Weekday encoding: form field `W{i}` has enable in bit 0 and Mon..Sun in bits 1-7; cfg.json `dow` is the same value shifted right by one with `en` separate. Mixing these up silently shifts days.
- Sunrise/sunset need non-zero lat/lon and a working NTP sync; otherwise those timers never fire.
- The stock page depends on `localStorage.wledP` for preset names. The replacement server should fetch `/presets.json` itself.
- Button macro rows depend on button definitions on the LED page; changing button types there changes which of `MP/ML/MD` are meaningful.
- Timezone and NTP are "System" adjacent and low risk; they could be added to §20 cheaply if wanted (`NT`, `NS`, `TZ`, `UO`, `CF`), but must be posted together with every other field on this page or the form POST will wipe timers and button macros. Using `POST /json/cfg {"if":{"ntp":{...}}}` avoids that.
