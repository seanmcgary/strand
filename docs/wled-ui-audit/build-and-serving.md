# Build Pipeline and HTTP Serving

How the files in `wled00/data/` become firmware, and which URL serves what. Sources: `tools/cdata.js`, `pio-scripts/build_ui.py`, `wled00/wled_server.cpp`, `handleFileRead()` in `wled00/file.cpp:478-498`, `serveJson()` in `wled00/json.cpp:1351-1432`.

## Build pipeline (`tools/cdata.js`)

PlatformIO runs `pio-scripts/build_ui.py` as a pre-build script (`platformio.ini:124`). It requires Node.js on PATH, runs `npm ci`, then `npm run build` → `node tools/cdata.js` (`package.json` scripts). `npm run dev` re-runs it on every change under `tools/` or `wled00/data/` via nodemon.

The script is skipped if every output header is newer than every file in `wled00/data/`, `package.json` and `cdata.js` itself; `--force`/`-f` overrides (`tools/cdata.js:226-252`). Outputs are git-ignored (`.gitignore:32-33`), so a fresh checkout has no `html_*.h` until the first build.

Dependencies: `web-resource-inliner` (inline `<link>`/`<script>`), `html-minifier-terser`, `clean-css`, Node `zlib` (`tools/cdata.js:18-24`).

### Two processing modes

**`writeHtmlGzipped(src, out, name, inlineCss=true)`** (`tools/cdata.js:137-160`): inlines referenced CSS and JS into the HTML, substitutes version/repo, minifies HTML+inline CSS/JS, gzips at max level, writes one header with `#define WEB_BUILD_TIME <unix ts>`, `PAGE_<name>_length` (`uint16_t`) and `PAGE_<name>[] PROGMEM`.

**`writeChunks(srcDir, specs, out)`** (`tools/cdata.js:162-202`): processes each file standalone (no inlining). Per-file `method`:
- `gzip`: optional `mangle`, minify with `filter` (`html-minify`, `css-minify`, `js-minify`, or `plain`), gzip → `uint8_t` array.
- `plaintext`: minify and emit a C++ raw string `R"=====( ... )====="` (used for templates the server expands at runtime).
- `binary`: raw bytes, no compression.

`adoptVersionAndRepo()` replaces `##VERSION##` with `package.json` version and rewrites `github.com/atuline/WLED` / `github.com/wled-dev/WLED` links to the repo URL in `package.json` (`tools/cdata.js:94-107`).

### What goes where

| Header | Source | Symbol | Mode | Notes |
|---|---|---|---|---|
| `html_ui.h` | `index.htm` (+ inlined `index.css`, `index.js`, etc.) | `PAGE_index` | inline+gzip | `tools/cdata.js:254` |
| `html_pixart.h` | `pixart/pixart.htm` (+ inlined css/js) | `PAGE_pixart` | inline+gzip | `:255` |
| `html_pxmagic.h` | `pxmagic/pxmagic.htm` | `PAGE_pxmagic` | inline+gzip | `:256` |
| `html_pixelforge.h` | `pixelforge/pixelforge.htm` | `PAGE_pixelforge` | inline+gzip, **CSS not inlined** (links `style.css` at runtime) | `:257` |
| `html_edit.h` | `edit.htm` | `PAGE_edit` | chunk gzip (not inlined; old inline call commented out) | `:258`, `:288-299` |
| `html_cpal.h` | `cpal/cpal.htm` | `PAGE_cpal` | chunk gzip | `:301-312` |
| `js_iro.h` | `iro.js` | `JS_iro` | gzip, no minify, license comment stripped | `:260-272` |
| `js_omggif.h` | `pixelforge/omggif.js` | `JS_omggif` | gzip + js-minify, license stripped | `:274-286` |
| `html_settings.h` | `style.css` | `PAGE_settingsCss` | gzip + clean-css | `:316-325` |
| | `common.js` | `JS_common` | gzip + js-minify | `:326-331` |
| | `settings.htm`, `settings_wifi/leds/dmx/ui/sync/time/sec/um/2D/pin/pininfo.htm` | `PAGE_settings*` | gzip + html-minify | `:332-403` |
| `html_other.h` | `usermod.htm` | `PAGE_usermod` | gzip, rewrites `fetch("http://.../win` → `fetch("/win` | `:410-418` |
| | `msg.htm` | `PAGE_msg` | plaintext template, body replaced with `<h2>%MSG%</body>` | `:419-427` |
| | `dmxmap.htm` | `PAGE_dmxmap` | plaintext template, `%DMXVARS%` injected; empty unless `WLED_ENABLE_DMX` | `:428-442` |
| | `update.htm`, `welcome.htm`, `liveview.htm`, `liveviewws2D.htm`, `404.htm` | `PAGE_*` | gzip + html-minify | `:443-472` |
| | `favicon.ico` | `favicon` | binary | `:473-477` |

Not embedded at all: `icons-ui/*` (IcoMoon source; the font is base64 inside `index.css`), `pixart/favicon*`, `pixart/site.webmanifest` (only if the inliner pulls them in via `pixart.htm`).

Size limit: lengths are `uint16_t`, so each gzipped asset must stay under 64 KB.

Pages built with `writeChunks` (edit, cpal, settings pages) are not inlined. They fetch `common.js`, `style.css`, `iro.js` from the device at runtime, typically with retry loops to survive 503s when heap is low (e.g. `wled00/data/cpal/cpal.htm:78-86`, `wled00/data/edit.htm:112-137`). These pages also work when opened from disk in "file mode", where `getLoc()` prompts for a device IP (`wled00/data/common.js:133-155`).

## Serving model

### `handleStaticContent()` — PROGMEM with FS override and ETags

`wled_server.cpp:140-147`:
1. If a path is given and `handleFileRead()` finds that file (or `<path>.gz`) on the filesystem, serve the FS copy. **A file uploaded to FS with the same name replaces the built-in page.**
2. Else, if `If-None-Match` matches the current ETag, return 304.
3. Else send the PROGMEM array with `Content-Encoding: gzip` (unless `gzip=false`), `Cache-Control: no-cache` and `ETag`.

ETag = `"<WEB_BUILD_TIME>-<cacheInvalidate hex>-<suffix>"` (`wled_server.cpp:88-90`). `cacheInvalidate` (a byte, `wled00/wled.h:417`) increments on every `/upload` (`wled_server.cpp:233`) and nowhere else, so all cached UI pages revalidate after any upload. It also invalidates the PSRAM presets cache (`file.cpp:449`). Debug builds send `no-store` instead (`wled_server.cpp:97-103`).

### `handleFileRead()` — generic FS serving

`file.cpp:478-498`:
- Path ending in `/` gets `index.htm` appended.
- **Any path containing `sec` is refused** (protects `wsec.json`; also blocks e.g. `/second.gif`).
- On PSRAM boards, `/presets.json` is served from an in-memory cache.
- Serves `<path>` or `<path>.gz` (AsyncWebServer adds gzip encoding for the `.gz` variant). `?download` forces attachment.
- No PIN check. `/cfg.json`, `/presets.json`, `/palette0.json`, `/ledmap.json` etc. are readable by anyone on the network.

### CORS

All responses get `Access-Control-Allow-Origin/Methods/Headers: *` (`wled_server.cpp:352-354`). `OPTIONS` to any unregistered path returns 200 with `Access-Control-Max-Age: 7200` (`wled_server.cpp:679-685`).

## Route table

Registered in `initServer()` (`wled_server.cpp:349-693`). "FS override" means an FS file at that path wins over PROGMEM.

| Method | URL | Serves | Source | FS override | Condition / notes | Ref |
|---|---|---|---|---|---|---|
| GET | `/` | Main UI, or welcome page | `PAGE_index` / `PAGE_welcome` | `/index.htm` | Welcome if `showWelcomePage` and no `?sliders`; captive-portal redirect in AP mode | `:624-631` |
| GET | `/liveview` | 1D live view | `PAGE_liveview` | no | | `:363-365` |
| GET | `/liveview2D` | 2D live view | `PAGE_liveviewws2D` | no | WebSockets on, 2D on | `:356-362` |
| GET | `/common.js` | shared JS | `JS_common` | yes | also `/settings/common.js` via `serveSettingsJS` | `:367-369`, `:721-724` |
| GET | `/iro.js` | color picker lib | `JS_iro` | yes | | `:371-373` |
| GET | `/omggif.js` | GIF codec | `JS_omggif` | yes | `WLED_ENABLE_GIF` (ESP32) | `:375-379` |
| GET | `/style.css` | settings/tool CSS | `PAGE_settingsCss` | yes | also `/settings/style.css` | `:387-390` |
| GET | `/favicon.ico` | icon | `favicon` (not gzipped) | yes | | `:392-395` |
| GET | `/skin.css` | user CSS for main UI | FS only | — | empty 200 if absent | `:397-402` |
| GET | `/welcome` | welcome page | `PAGE_welcome` | no | | `:404-406` |
| GET | `/reset` | message page, then reboot | `PAGE_msg` | — | **reboots on GET** | `:408-411` |
| GET | `/settings`, `/settings/<sub>` | settings pages | `PAGE_settings*` | no | sub chosen by substring: `wifi`, `leds`, `ui`, `sync`, `time`, `sec`, `dmx`, `um`, `2D`, `pins`, `lock`; `.js` → `serveSettingsJS`, `.css` → style | `:382-384`, `:746-873` |
| POST | `/settings/<sub>` | save settings (form-encoded) | — | — | local-subnet only; responds with `msg` page | `:413-415`, `:785-824` |
| GET | `/settings/s.js?p=N` | generated `GetV()` JS that fills a settings form | runtime | — | PIN required for N>0 if PIN set | `:719-743` |
| GET | `/json`, `/json/state`, `/json/info`, `/json/si`, `/json/nodes`, `/json/eff`, `/json/effects`, `/json/palx?page=N`, `/json/fxdata`, `/json/net`, `/json/cfg`, `/json/pins`, `/json/pal` | JSON API | runtime | — | substring match, see below | `:418-420`, `json.cpp:1351-1432` |
| GET | `/json/live` | LED colors JSON | runtime | — | **only if WebSockets disabled**; else 501 | `json.cpp:1369-1374` |
| POST | `/json`, `/json/state`, `/json/cfg` | apply state, or config if URL contains `cfg` | — | — | `{"pin":"..."}` in body sets `correctPIN`; cfg requires PIN if set; `"v":true` returns full state | `:422-477` |
| GET | `/version` | plain `VERSION` build number | — | — | | `:479-481` |
| GET | `/uptime` | plain millis | — | — | | `:483-485` |
| GET | `/freeheap` | plain bytes | — | — | | `:487-489` |
| GET | `/u` | usermod page | `PAGE_usermod` | no | `WLED_ENABLE_USERMOD_PAGE` | `:491-495` |
| GET | `/teapot` | 418 message | — | — | | `:497-499` |
| POST | `/upload` | write file to FS | — | — | PIN; multipart; side effects on cfg.json/palette*.json | `:501-504`, `:206-236` |
| GET | `/edit` | file editor page | `PAGE_edit` | `/edit.htm` | PIN | `:240-259` |
| GET | `/edit?func=list` (or `?list=/`) | file list JSON | — | — | PIN; hides `wsec.json` | `:261-286` |
| GET | `/edit?func=edit\|download\|delete&path=` | read / download / delete | — | — | PIN; `wsec.json` 403 | `:288-329` |
| GET | `/update` | OTA page | `PAGE_update` | no | 401 if OTA locked; `?revert` rolls back on ESP32 | `:508-516`, `:843-855` |
| POST | `/update` | firmware upload | — | — | subnet + PIN + OTA lock checks | `:518-562` |
| POST | `/updatebootloader` | ESP32 bootloader upload | — | — | same checks | `:571-616` |
| GET | `/dmxmap` | DMX map | `PAGE_dmxmap` template | no | `WLED_ENABLE_DMX` | `:618-622` |
| GET | `/pixart.htm` | Pixel Art Converter | `PAGE_pixart` | yes | `WLED_ENABLE_PIXART`, 2D | `:634-639` |
| GET | `/pxmagic.htm` | PixelMagic | `PAGE_pxmagic` | yes | `WLED_ENABLE_PXMAGIC`, 2D | `:641-646` |
| GET | `/pixelforge.htm` | PixelForge | `PAGE_pixelforge` | yes | 2D, not `WLED_DISABLE_PIXELFORGE`; else stub page | `:648-661` |
| GET | `/cpal.htm` | palette editor | `PAGE_cpal` | yes | | `:664-667` |
| WS | `/ws` | WebSocket | — | — | WebSockets on (default) | `:669-671`, `wled00/wled.h:791` |
| any | anything else | not-found chain | see below | | | `:674-692` |

### Not-found chain (where `/cfg.json`, `/presets.json` etc. come from)

There are no explicit routes for FS files. Everything else falls into `onNotFound` (`wled_server.cpp:674-692`), in order:

1. Captive portal: in AP mode, a `Host` that is not an IP, `wled.me`, the mDNS name, or contains `:` → 302 to `http://4.3.2.1`.
2. `OPTIONS` → 200 (CORS preflight).
3. `handleSet()`: **if the URL contains `win` anywhere**, it is treated as the legacy HTTP API and answered with XML (`wled00/set.cpp:913-915`, `set.cpp:1298-1307`). This shadows FS files like `/winter.gif` or `/twinkle.json`.
4. Alexa (Hue emulation) API.
5. `handleStaticContent(url, 404, PAGE_404)`: FS file at that path (or `.gz`) with 200 via `handleFileRead()`; else the 404 page.

So `GET /cfg.json`, `GET /presets.json`, `GET /palette3.json`, `GET /ledmap.json`, `GET /holidays.json`, `GET /pftools.json`, `GET /image.gif` are all just filesystem reads through step 5, with no auth.

### JSON GET sub-paths

`serveJson()` picks the sub-document by **substring** (`json.cpp:1358-1383`), checked in this order: `state`, `info`, `si`, `nodes`, `eff`, `palx`, `fxda`, `net`, `cfg`, `pins`, `live` (if compiled), `pal`. Anything else longer than `/json` → 501. Because it is substring matching, order matters (e.g. `/json/effects` and `/json/eff` both hit `eff`).

`/json` with no suffix returns `{state, info, effects, palettes}`.

## Replacement notes

**MVP scope:** The replacement does not need to build or embed anything into WLED; it runs as a separate server (PRD §4). This document matters for the server's WLED client:

- Use `/json/state`, `/json/info`, `/json/si`, `/json/eff`, `/json/pal`, `/json/palx?page=N`, `/json/fxdata`, `/json/cfg`, `/json/nodes`, `/presets.json`, and `/ws`. These are the endpoints the MVP needs.
- Config writes: `POST /json/cfg` (URL contains `cfg`). If a settings PIN is set, include `"pin"` or the write is 401.
- Reboot: `POST /json/state {"rb":true}` (`json.cpp:440`) is preferable to `GET /reset`, which returns an HTML page.
- The "Open WLED Advanced UI" escape hatch (PRD §21) must open the device directly (`http://<device>/settings` or `/?sliders`); the stock pages use absolute `/` paths and `ws://` and only partially support sub-path proxies via `getLoc()`.

Gotchas:
- FS files override built-in pages. A device may serve a customized or outdated `/index.htm`, `/cpal.htm`, `/edit.htm`, `/common.js` from flash. Don't assume stock behavior when linking out.
- Files with `sec` in the path are never served; files with `win` in the path are hijacked by the legacy API. Avoid both in any filenames the replacement creates.
- `cfg.json` and `presets.json` are readable without auth. Passwords live in `wsec.json`, which is blocked. Do not proxy raw device files to remote users without thinking about what they expose (WiFi SSIDs, MQTT host, etc.).
- PIN state (`correctPIN`) is a single global on the device, not per session. Unlocking from the replacement server also unlocks for every other client until locked (`/settings/lock`) or timed out.
- Settings POST endpoints check the client is on a local subnet (`inLocalSubnet`, `wled_server.cpp:76-82`, `:786-790`). A server on the same LAN passes; a server reaching the device over a routed VPN subnet may not.
- Response bodies for errors vary: JSON `{"error":N}` for the JSON API, plain text for `/upload` and `/edit` functions, HTML `msg` pages for settings/OTA/`/edit` without PIN.
