# Firmware Update (`update.htm`)

Source: `wled00/data/update.htm`. Reached from the Security page "Update WLED" button or directly at `/update`. Unlike other settings pages it does not use s.js; it reads `GET /json/info`. Server: `wled00/wled_server.cpp:507-616`, OTA logic in `wled00/ota_update.cpp`.

## Access

| Condition | Result |
|---|---|
| Built with `WLED_DISABLE_OTA` | `GET`/`POST /update` → 501 "This build does not support OTA update." (`wled_server.cpp:563-568`) |
| `otaLock` set (Security page) | `GET /update` → 401 "Access denied", unlock hint (`wled_server.cpp:511-515`); POST also rejected (`:552-556`) |
| Settings PIN set and not entered | GET serves the PIN page (`SUBPAGE_UPDATE` is inside the PIN range, `wled_server.cpp:769`, `:773`); POST → 401 (`:547-551`) |
| Client not allowed by subnet rule | POST → 401 "Client is not on local subnet." Rule: `otaSameSubnet` on → must be same subnet as device unless a PIN is set; off → any private range (`wled_server.cpp:543-546`, `:76-82`) |
| Another update already running | 503 (`ota_update.cpp:229-233`) |

## Page fields and controls

On load `GetV()` (`update.htm:21-72`) fetches `/json/info` and fills:

| Element | Content | Source field |
|---|---|---|
| Installed version `.installed-version` | `${brand} ${ver} (${vid})` e.g. "WLED 17.0.0-dev (2605010)" | `/json/info` `brand`, `ver`, `vid` |
| Release `.release-name` | build/release name, e.g. "ESP32" or a custom env name; becomes a direct download link if a matching asset exists in the latest GitHub release | `release` |
| Latest version badge `#release-download` | shields.io badge linking to `https://github.com/<repo>/releases/latest`; shown only if `repo` is known (not "unknown") | `repo` |
| Auto update button `#autoUpdBtn` + status `#autoUpdStatus` | see below | |
| Bootloader SHA256 `#bootloader-hash` | "Current bootloader SHA256: ..." | `bootloaderSHA256` (ESP32 only, `json.cpp:868`) |

The browser calls `https://api.github.com/repos/<repo>/releases/latest` directly (`:37-49`) and rewrites asset URLs to `https://download.wled.me` (`:44`). Failures are silently ignored.

### Manual upload form (`#upd`)

`<form method=POST action=./update enctype=multipart/form-data>` (`update.htm:132`).

| Label | Field | Type | Server handling |
|---|---|---|---|
| (hidden) | `skipValidation` | hidden, "" or "1" (`:149`) | `ota_update.cpp:248-252`: "1" skips release-name compatibility check. Must appear **before** the file part in the multipart body, because it is read when the upload starts. |
| (file) | `update` | file, required, no `accept` filter (comment: `.bin` filter breaks Android app upload) (`:150`) | Streamed to flash via `handleOTAData` (`ota_update.cpp:323-414`). `.bin` or gzip (`SUPPORT_GZIPPED_OTA` builds). |
| Ignore firmware validation | checkbox `#skipValidation` (no name) (`:151-152`) | sets the hidden field to 1 | — |
| Upload | submit | `hideforms()` hides everything and shows "Updating... Please do not close or refresh the page" (`:73-78`, `:169`) | — |

Validation (`ota_update.cpp:73-93`, `wled00/wled_metadata.cpp:151-201`): the first chunk is scanned for an embedded `wled_metadata_t` block. Rejected if missing ("This firmware file is missing compatibility metadata."), if the release name differs from the running build's `releaseString` ("Firmware release name mismatch: current='X', uploaded='Y'"), or if the image declares a minimum safe-update version newer than the running one ("Cannot update from this version: requires at least a.b.c"). Practically: an ESP32 build can only be updated to another build with the same release name unless validation is skipped, which prevents flashing e.g. an ESP8266 image to an ESP32 by mistake.

Process: on start, effects are suspended, `cfg.json` is backed up (`backupConfig()`), segments reset to free RAM, usermods notified (`ota_update.cpp:236-243`). On success → "Update successful! Rebooting now..." and reboot (`wled_server.cpp:518-531`, `ota_update.cpp:203-209`). On failure → 500 "Update failed!" with the error; the device resumes without reboot (`ota_update.cpp:213-219`). If the client disconnects mid-upload, `endOTA` aborts and resumes (`ota_update.cpp:273`).

### Auto update (`autoUpdate()`, `update.htm:79-120`)

Browser-side only: query GitHub latest release for `repo`, find asset ending `_<tag>_<release>.bin`, download it from `download.wled.me` into a Blob, inject it into the file input with a `DataTransfer`, then submit the same `#upd` form. Shows "Firmware not found" listing available assets if no match. Requires the browser to reach GitHub and download.wled.me.

### Revert update

Button `#rev` (`update.htm:156`): first click turns it red "Revert!", second click navigates to `GET /update?revert` (`cR()`, `:11-20`). Hidden when `arch == "esp8266"` (`:54-56`). Server: if client in local subnet and `Update.canRollBack()`, swap boot partition and reboot ("Reverted to previous version!"), else 500 "Rollback failed!" (`wled_server.cpp:844-855`). Works only on ESP32 while the previous app partition is still intact.

### Bootloader Update (`#bootupd`)

Shown only when `arch` is `esp32` or `esp32-s2` (`update.htm:57-63`). Separate form `POST ./updatebootloader`, file field `update` (`:163-167`). Server (`wled_server.cpp:573-616`, `ota_update.cpp:738-915`): same subnet/PIN/OTA-lock checks; returns "Bootloader update not supported on this chip" where `BOOTLOADER_OTA_UNSUPPORTED`; buffers the whole image in RAM (fails with "Out of memory! Contiguous heap ..." if not enough), checks max size, verifies the image structure (`verifyBootloaderImage`), strips a leading partition table if present, then erases and writes flash at the bootloader offset and reboots ("Bootloader updated successfully!"). A bad bootloader bricks the device until serial reflash; the page's only guard text is "Only upload verified ESP32 bootloader files!".

## Related firmware/version data

`/json/info` provides everything the page shows: `ver` (e.g. "17.0.0-dev"), `vid` (build number), `release`, `repo`, `brand`, `arch`, `core`, `flash`, `bootloaderSHA256`. `/version` returns the build number as plain text (`wled_server.cpp:479-481`). A bootloop detector can automatically roll back a bad OTA on ESP32 (`util.cpp:1106-1112`).

## Replacement notes

PRD scope: firmware updates are explicitly out (§3 "Firmware fleet management", §29 "Firmware updates"). §20 needs only version and platform, which come from `/json/info` (`ver`, `vid`, `arch`, `release`). Escape hatch: link to `http://<device>/update`.

Gotchas if it is ever added:

- Keep `skipValidation` before the file part in the multipart body.
- The release-name check is the main safety net; do not default to skipping it. Match assets using the device's `release` field, as `autoUpdate()` does.
- Uploads go through the replacement server in the PRD architecture. The device sees the server's LAN IP, so the subnet rule passes; but the PIN and OTA lock still apply.
- The device drops off for ~10-30 s during reboot; on failure it stays up. Poll `/json/info` `vid` to confirm the new build.
- Never expose bootloader upload or revert in an MVP UI.
