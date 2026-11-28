# File Editor (`/edit`)

Source: `wled00/data/edit.htm` (608 lines). Server side: `createEditHandler()` and `handleUpload()` in `wled00/wled_server.cpp`.

## Purpose

A two-pane manager for the device's flash filesystem (LittleFS). Left pane lists files with sizes; right pane is a text editor (Ace if the CDN is reachable, plain `<textarea>` otherwise) or an image preview. It is the general-purpose way to view, edit, upload, download and delete `cfg.json`, `presets.json`, `palette*.json`, `ledmap*.json`, GIFs, fonts, custom HTML tools, `skin.css`, etc.

## How it is reached

- Main UI: "Files" button in the color panel button row, `wled00/data/index.htm:133` (`window.location.href=getURL('/edit')`, icon glyph `&#xe901;`).
- PixelMagic links to `<host>/edit` as an "upload" hint, `wled00/data/pxmagic/pxmagic.htm:771`.
- Direct URL: `/edit`, optionally `/edit?file=/presets.json` to open a file on load (`wled00/data/edit.htm:579-585`).

## Features

| Feature | Where |
|---|---|
| File list (root only, no subdirectories) with size in KB | `edit.htm:332-340`, `edit.htm:284-291` |
| Filesystem usage footer from `/json/info` → `info.fs.u` / `info.fs.t` | `edit.htm:343-355` |
| Click file → load into editor; image extensions (png/jpg/jpeg/gif/bmp/webp) show `<img>` preview instead | `edit.htm:180-190` |
| Right-click context menu: Download, Delete (with `confirm`) | `edit.htm:297-327` |
| Filename text box (max 31 chars, the LittleFS name limit) + Clear / Save / Upload File | `edit.htm:210-224` |
| JSON files pretty-printed on load (2-space indent); files with `ledmap` in the name get row-aligned `map` arrays using `width` | `edit.htm:385-414`, `edit.htm:527-532` |
| JSON validated and minified before save; invalid JSON blocks the save | `edit.htm:503-512` |
| Live red border on invalid JSON in textarea mode | `edit.htm:488-501` |
| Ace editor (1.23.4 from cdnjs, json mode, monokai theme), falls back to textarea after 3 failed retries or 1 s timeout per script | `edit.htm:112-137`, `edit.htm:441-463` |
| Ctrl/Cmd+S saves | `edit.htm:589-594` |
| "Back to the controls" → `getURL("/")` | `edit.htm:218` |

Requests are serialized through a small `QueuedRequester` (XHR queue with a global spinner), `edit.htm:139-177`. This keeps the ESP from receiving concurrent requests.

## Endpoints used

| Action | Request | Server handler |
|---|---|---|
| Serve editor page | `GET /edit` (no `func`) | `wled_server.cpp:255-259` — FS `/edit.htm` if present, else PROGMEM `PAGE_edit` |
| List files | `GET /edit?func=list&path=/` (legacy `?list=/` also works) | `wled_server.cpp:261-286` |
| Read file | `GET /edit?func=edit&path=<p>` | `wled_server.cpp:309-312` |
| Download | `GET /edit?func=download&path=<p>` (attachment) | `wled_server.cpp:314-317` |
| Delete | `GET /edit?func=delete&path=<p>` | `wled_server.cpp:319-326` |
| Upload / save | `POST /upload` multipart, file part name `file` or `data`, filename is the target path | `wled_server.cpp:206-236`, `wled_server.cpp:501-504` |
| FS usage | `GET /json/info` | standard JSON API |

List response format: a flat JSON array, `[{"name":"cfg.json","type":"file","size":1234}, ...]` (`wled_server.cpp:278`). Names come from `File::name()`; whether they carry a leading slash depends on the platform/core, so clients normalize (edit.htm prepends `/`, PixelForge and PixelMagic strip it with `name.replace('/','')`).

Save does not use a dedicated write endpoint. `saveFile()` wraps the text in a `Blob` and calls `uploadFile()` from `common.js`, which posts to `/upload` (`edit.htm:513`, `wled00/data/common.js:171-191`).

## Server-side behavior worth knowing

- **Auth**: every `/edit` GET checks `correctPIN`; without it the server returns the 401 message page "Please unlock settings using PIN code!" (`wled_server.cpp:245-248`). `/upload` checks `correctPIN` too and returns 401 plain text (`wled_server.cpp:207-210`). With no settings PIN configured, `correctPIN` is true and everything is open.
- **Only GET is registered** for `/edit` (`wled_server.cpp:243`). Delete is a GET with `func=delete`. There is no HTTP DELETE or PUT.
- **`wsec.json` is hidden and blocked**: skipped in list (`wled_server.cpp:272-275`), 403 on any func (`wled_server.cpp:304-307`). The client filters it again (`edit.htm:334`).
- **Upload side effects** (`wled_server.cpp:224-235`):
  - Filename containing `cfg.json` → sets `doReboot = true` and responds "Config restore ok. Rebooting...". Uploading cfg.json from the editor reboots the device.
  - Filename containing `palette` and `.json` → `loadCustomPalettes()` reloads custom palettes immediately.
  - Uploading `/presets.json` updates `presetsModifiedTime` (`wled_server.cpp:219`), exposed as `info.fs.pmt` (`json.cpp:844`), which the main UI uses to decide when to refetch presets.
  - Every upload increments `cacheInvalidate`, which is part of the ETag for all PROGMEM pages (`wled_server.cpp:88-90`), so browsers refetch UI pages after any upload.
- **Overwrites in place**: the file is opened with `"w"` on the first chunk (`wled_server.cpp:217`). A failed/partial upload leaves a truncated file.
- **No path sanitization** beyond prepending `/`. Subdirectories are not listed.
- The page itself is not inlined at build time; it loads `common.js` and `style.css` from the device at runtime and Ace from cdnjs (`edit.htm:126-137`). See build-and-serving.md.

## Notable implementation details

- Inconsistent base URL handling: list, read and upload use absolute `/edit` and `/upload` (`edit.htm:259`, `edit.htm:372`, `edit.htm:523`; `common.js:186`), while download/delete use `getURL()` (`edit.htm:273`, `edit.htm:278`). Under a sub-path reverse proxy, half the operations hit the wrong URL.
- `body { min-width: 850px }` (`edit.htm:15`). Not usable on phones.
- Image preview `src` is `/edit?func=edit&path=...` with a cache-buster (`edit.htm:186`).
- Content is shown pretty-printed but saved minified, so the editor reloads the file after save to show the canonical form (`edit.htm:516`).

## Replacement notes

**MVP scope:** Deferred. The PRD has no file manager. The "Open WLED Advanced UI" escape hatch (PRD §21) covers it. Nothing here blocks MVP.

The MVP still uses some of the same files through other paths:
- Presets: `GET /presets.json` (served from FS by the not-found handler, see build-and-serving.md) is the cheapest way to list presets. Writes should go through `/json/state` with `psave`/`pdel`, not by uploading `presets.json`.
- Backup/restore of `cfg.json` and `presets.json`, if added later, uses `/upload` and `GET /<file>` or `/edit?func=download`.

Gotchas for when this is built:
- Uploading any filename containing `cfg.json` reboots the controller. Guard it in the UI.
- `/edit` and `/upload` depend on the settings PIN session (`correctPIN`), which is per-device global state, not per-client. The server needs to submit the PIN (`POST /json` with `{"pin":"..."}` sets it, `wled_server.cpp:438`) before calling these.
- Filenames are limited to 31 characters, root directory only.
- Delete is `GET /edit?func=delete&path=...`.
- Do not name files with `win` or `sec` in them; see build-and-serving.md for why they cannot be fetched by URL.
