# Security, Backup & About (`settings_sec.htm`)

Source: `wled00/data/settings_sec.htm`. Loaded at `/settings/sec`, values from `GET /settings/s.js?p=6` (`wled00/xml.cpp:653-676`), saved via `POST /settings/sec` → `wled00/set.cpp:648-693`. Page title "Security & Update Setup".

## Security section

| Label | Field | Type / range | set.cpp | Apply |
|---|---|---|---|---|
| Settings PIN | `PIN` | password, exactly 4 digits (`pattern [0-9]*`, `checkNum()` keyboard filter) (`settings_sec.htm:50`) | `set.cpp:657-668`. Length must be 0 or 4. Empty clears the PIN. xml.cpp pre-fills `0` repeated to the PIN length (`xml.cpp:655-659`), and `0000` is treated as "unchanged" placeholder, so a real PIN of `0000` cannot be set. | live |
| Lock wireless (OTA) software update | `NO` | checkbox (`:52`) | `set.cpp:686` → `otaLock`. Only applied if `pwdCorrect`. | live |
| Passphrase | `OP` | password, maxlength 32 (`:53`) | `set.cpp:670-682`. If OTA is locked: must equal stored `otaPass` to unlock, and the previous save must be >3 s ago (`PIN_RETRY_COOLDOWN`, `const.h:728`). If OTA is unlocked: a non-empty value sets a new passphrase. Never pre-filled. Default passphrase is `wledota`. | live |
| Deny access to WiFi settings if locked | `OW` | checkbox (`:58`) | `set.cpp:687` → `wifiLock`; only applied if `pwdCorrect`. With `otaLock` set, the WiFi page returns 401 (`wled_server.cpp:780-783`). | live |
| Factory reset | `RS` | checkbox (`:59`) | `set.cpp:650-655`: `WLED_FS.format()` (erases cfg.json, wsec.json, presets.json, ledmaps, palettes, everything), serves "All Settings erased. Connect to WLED-AP to setup again", sets `doReboot`. Config is not re-saved (`set.cpp:904`). | reboot |

"Settings on this page are only changeable if OTA lock is disabled!" — with `otaLock` set, `NO`, `OW`, `AO`, `SU` changes are ignored unless `OP` matches (`set.cpp:684-692`). `PIN` and `RS` are *not* gated by the OTA lock.

## Software Update section (`#OTA`)

Hidden entirely when built with `WLED_DISABLE_OTA` (`xml.cpp:667-670`).

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Update WLED (button) | — | navigates to `/update` (`U()`, `settings_sec.htm:17`) — see `firmware-update.md` | — |
| Enable ArduinoOTA | `AO` | checkbox in `#aOTA` (`:66`); hidden unless `WLED_ENABLE_AOTA` (`xml.cpp:671-673`) | `set.cpp:688-690` → `aOtaEnabled` (Arduino IDE / espota network upload). `ArduinoOTA.begin()` only in `initInterfaces()` → reboot. |
| Only allow update from same network/WiFi | `SU` | checkbox (`:67`) | `set.cpp:691` → `otaSameSubnet`. Gated by OTA lock. |

`otaSameSubnet` semantics for `/update` and `/updatebootloader` (`wled_server.cpp:543`, `:591`; `inLocalSubnet` at `:76-82`): when on, the client must be in the same subnet unless a settings PIN is set; when off, the client must be in any private/local subnet. The page warns users on multiple VLANs to set a PIN or disable this.

## Backup & Restore section

Warnings: restoring overwrites; bad uploads may need factory reset; passwords are not backed up.

| Control | Element | Behavior |
|---|---|---|
| Backup presets | link `#bckcfg` → `/presets.json`, `download` attr (`settings_sec.htm:76`) | Plain GET of the preset file via `handleFileRead` (`wled00/file.cpp:478-497`). Downloaded name becomes `wled_presets_<DeviceName>.json` (or `wled_presets` if name is "WLED") via `setBckFilename()` (`:25-27`); `sd` (device name) is injected by xml (`xml.cpp:666`). The element ids are swapped relative to their content (`bckcfg` is presets, `bckpresets` is cfg) — cosmetic. |
| Restore presets | file input `data` + Upload (`:77`) | `uploadFile(d.Sf.data, '/presets.json')` (`common.js:171-191`): parses and minifies the JSON client side (asks to continue if invalid), then `POST /upload` multipart with field `data` and filename `/presets.json`. Server writes the file as-is (`wled_server.cpp:206-236`) and bumps `presetsModifiedTime`. No reboot; main UI reloads presets on next visit. Response text "File Uploaded!". |
| Backup configuration | link `#bckpresets` → `/cfg.json` (`:78`) | Downloaded as `wled_cfg_<name>.json`. Contains no passwords, PIN, OTA passphrase, MQTT password, or Hue key — those live in `/wsec.json`, which the file server refuses to serve (any path containing "sec", `file.cpp:481`). Only `pskl` lengths are included. |
| Restore configuration | file input `data2` + Upload (`:79`) | `POST /upload` with filename `/cfg.json`; server writes the file and sets `doReboot`, responds "Config restore ok.\nRebooting..." (`wled_server.cpp:226-228`). On boot cfg.json is parsed; WiFi passwords etc. come from the existing wsec.json, so restoring onto a factory-reset device leaves WiFi passwords empty. |

Upload requires `correctPIN` (`wled_server.cpp:207-210`). Note `uploadFile` posts to the absolute path `/upload`, not `getURL()`, so it breaks when the stock pages are served from a non-root path.

## About section

| Item | Source |
|---|---|
| "WLED version ##VERSION##" | Replaced at build time from package.json by `tools/cdata.js` |
| Contributors link, EUPL v1.2 license link, "(c) 2016-2024 Christian Schwinne" | static (`settings_sec.htm:82-89`) |
| Installed version `.sip` | Runtime: `WLED <versionString> (<VERSION build id>)<br>"<releaseString>"<br>(Processor: <chip model>)` (`fillWLEDVersion`, `xml.cpp:47-60`, `:664-665`) |

There is no licenses list beyond the EUPL link.

## PIN mechanics (relevant to any client)

- PIN lives in `/wsec.json` (`cfg.cpp:1324`, `:1367`). `correctPIN` is a single global flag, not per client or session (`util.cpp:502-508`). Once anyone enters the correct PIN, every client is unlocked until 15 minutes pass with no settings save (`PIN_TIMEOUT`, `const.h:729`; `wled.cpp:190`).
- Unlock: POST form field `PIN` to any `/settings/<page>` URL while locked. `serveSettings` maps the request to `SUBPAGE_PINREQ` and calls `checkSettingsPIN` (`wled_server.cpp:773-777`, `set.cpp:15-19`). Wrong attempts within 3 s of the last attempt are rejected (`util.cpp:504`; `wled_server.cpp:780`).
- Lock immediately: `GET /settings/lock` (`wled_server.cpp:861-865`).
- Any JSON POST (`/json`, `/json/state`, `/json/cfg`) may carry a top-level `"pin"` key, which is passed to `checkSettingsPIN` before the body is applied (`wled_server.cpp:438`). It sets the same global `correctPIN` flag as the form unlock. Without a correct PIN, `POST /json/cfg` returns 401 `{"error":...}` when a PIN is set and not entered (`wled_server.cpp:452-456`). `GET /json/cfg` is **not** PIN-gated, and neither are `/json/state` writes.
- PIN gates: all settings pages except the menu (and WiFi when unconfigured), `/update`, `/upload`, `/edit`, `POST /json/cfg`.

## Reboot summary

| Action | Reboot |
|---|---|
| PIN, OTA lock, passphrase, WiFi lock, same-subnet | no |
| ArduinoOTA toggle | yes (to start/stop) |
| Factory reset | yes, automatic; device returns as unconfigured AP `WLED-AP` |
| Restore cfg.json | yes, automatic |
| Restore presets.json | no |

## Replacement notes

PRD §20 System: version, uptime, IP, signal, platform, free memory, reboot. Of this page, only the version line is relevant, and `/json/info` (`ver`, `vid`, `release`, `arch`, `uptime`, `wifi.rssi`, `freeheap`, `ip`) covers all §20 data better. Reboot is `POST /json/state {"rb":true}` (`json.cpp:440`) or `GET /reset` (`wled_server.cpp:408-411`).

Not MVP: PIN management, OTA lock, factory reset, cfg/presets backup and restore (PRD §29 defers configuration history/rollback). Escape hatch (§21) to `/settings/sec`.

Gotchas for the replacement server even in MVP:

- If a user has set a PIN, `POST /json/cfg` (LED/network/sync config) fails with 401. The server needs a way to unlock: collect the PIN from the user and include `"pin":"nnnn"` in the `POST /json/cfg` body (or form-POST `PIN=nnnn` to any `/settings/...` URL first). Because `correctPIN` is global, unlocking from the server also unlocks the device for everyone else on the LAN for up to 15 minutes; call `GET /settings/lock` after writing.
- The settings form POST requires the client IP to be in a "local" subnet: 10/8, 192.168/16, 172.16/12, the WLED AP subnet, or the device's own subnet (`wled_server.cpp:76-82`, `:786-789`). The replacement server runs on the LAN (PRD §5, host networking), so its requests pass. But the §21 escape hatch opens the stock UI directly in the user's browser: a remote user on Tailscale (100.64/10 CGNAT addresses) reaching the device through a subnet router without SNAT will get "Access denied" on every settings save and on `/update`. Document this next to the "Open WLED Advanced UI" button.
- Never expose factory reset as a casual control. `RS` formats the filesystem, including presets.
- A cfg.json backup taken through the replacement (e.g. before a config write) does not include secrets; restoring it will not restore WiFi passwords.
