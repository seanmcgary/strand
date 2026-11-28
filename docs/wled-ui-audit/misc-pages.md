# Miscellaneous Pages, Icons and Shared Styles

Covers `welcome.htm`, `404.htm`, `msg.htm`, `usermod.htm`, `dmxmap.htm`, the favicon, the `icons-ui/` icon font, and `style.css`. Sources are under `wled00/data/`; serving logic is in `wled00/wled_server.cpp`.

## welcome.htm — first-run page

| | |
|---|---|
| Served at | `/` while `showWelcomePage` is true, and always at `/welcome` (both via `serveSettings()` → `SUBPAGE_WELCOME`, `wled_server.cpp:404-406`, `wled_server.cpp:624-631`, `wled_server.cpp:771`, `wled_server.cpp:869`) |
| Storage | PROGMEM only (`PAGE_welcome`, no FS override) |
| When shown | `showWelcomePage = true` at boot if the first WiFi SSID is still the default and no config backup exists (`wled00/wled.cpp:556-557`). Cleared once WiFi is configured or Ethernet connects (`wled.cpp:823`, `network.cpp:516`) |

Content: WLED logo (inline base64 PNG), "Welcome to WLED!", and two buttons: "WiFi settings" → `./settings/wifi`, and "To the controls!" → `./?sliders` (`welcome.htm:69-73`). The `?sliders` query bypasses the welcome redirect on `/` (`wled_server.cpp:626`). Has an inline dev-build banner (`welcome.htm:50-63`); it does not load common.js.

## 404.htm — not found

Served by `server.onNotFound` as the last fallback (`wled_server.cpp:674-692`) with status 404 from PROGMEM `PAGE_404`. Before reaching it, the handler: (1) redirects to the captive portal in AP mode, (2) answers CORS preflight `OPTIONS` with 200, (3) tries `handleSet()` for legacy `/win` API URLs, (4) tries Alexa, (5) tries the filesystem (inside `handleStaticContent`, `wled_server.cpp:141`). Content: small Akemi PNG, "404 Not Found", button to `../?sliders` (`404.htm:41-46`).

## msg.htm — server message template

Used by `serveMessage(request, code, headline, subline, optionType)` (`wled_server.cpp:696-703`) for every server-generated status page: settings saved, PIN rejected, access denied, rebooting (`/reset`), OTA results, `/teapot`, etc.

Build-time transform: cdata.js stores it as a raw string (not gzipped) and replaces everything from `<h2>` to `</body>` with `<h2>%MSG%</body>` (`tools/cdata.js:419-427`). At request time AsyncWebServer's template processor `msgProcessor()` expands `%MSG%` (`wled_server.cpp:172-203`).

`optionType` controls the trailing script:

| optionType | Behavior |
|---|---|
| 0-59 | `setTimeout(RS, n*1000)` → go to `../settings` after n seconds |
| 60-119 | unused |
| 120-179 | `setTimeout(RP, (n-120)*1000)` → reload top window at `../` (e.g. 131 = 11 s after reboot) |
| 253 | "Back" button form to `/settings` |
| 254 | "Back" button calling `history.back()` |

The page imports `style.css` via `@import url("style.css")` (relative, so it resolves against the current path) (`msg.htm:12-14`).

A replacement client that calls `/settings/*` POST endpoints, `/reset`, `/update`, or `/edit` without a PIN will get this HTML page back, not JSON. Status codes are meaningful (200/401/500/501).

## usermod.htm — placeholder for a usermod page

Five-line placeholder: "No usermod custom web page set." (`usermod.htm`). Served at `/u` only with `-D WLED_ENABLE_USERMOD_PAGE` (`wled_server.cpp:491-495`). cdata.js rewrites any `fetch("http://.../win` to `fetch("/win` so a page developed against a real device works when embedded (`tools/cdata.js:411-418`). Intended to be replaced by a usermod author.

## dmxmap.htm — DMX channel map

Served at `/dmxmap` only with `WLED_ENABLE_DMX` (`wled_server.cpp:618-622`). Stored as a raw template; cdata.js injects `%DMXVARS%` into `function FM()` (`tools/cdata.js:428-442`), and `dmxProcessor()` fills in `CN` (channels per fixture), `CS` (start), `CG` (gap), `LC` (LED count) and the `CH` fixture map (`wled_server.cpp:149-170`). Renders 512 boxes labeled SET 0 / RED / GREEN / BLUE / WHITE / SHUTTER / SET 255 / DISABLED. Without DMX, `PAGE_dmxmap` is an empty string.

## favicon

`wled00/data/favicon.ico` (156 bytes) is embedded as a binary array (not gzipped) and served at `/favicon.ico` with `image/x-icon`; an FS file of the same name overrides it (`tools/cdata.js:473-477`, `wled_server.cpp:392-395`).

`wled00/data/pixart/favicon*.png|ico` and `site.webmanifest` belong to the Pixel Art Converter only; nothing serves them as standalone routes.

## icons-ui/ — icon font source

`icons-ui/` is the IcoMoon project for the UI icon font, not a runtime asset:
- `selection.json` (re-importable IcoMoon project), `fonts/wled122.{ttf,woff,woff2,svg}`, `style.css` and `demo.html` (IcoMoon export), `HowTo_AddNewIcons.txt`.
- None of these files are referenced by cdata.js or served by the firmware.

At runtime the font is a base64 WOFF2 embedded at the top of `index.css` as `font-family: "WIcons"` (`wled00/data/index.css:1-4`). Icons are used as `<i class="icons">&#xe2c6;</i>` with raw code points (`index.css:153-159`; e.g. `index.htm:133`, `index.js:844`). The `i-*` class names in `icons-ui/style.css` are not used by the UI. Updating icons means regenerating the WOFF2, base64-encoding it, and pasting it into `index.css` (`icons-ui/HowTo_AddNewIcons.txt`).

Glyph map (from `icons-ui/selection.json`):

| Code | Name | Code | Name |
|---|---|---|---|
| e037 | del | e2a2 | night |
| e04c | presets | e2a6 | brightness |
| e066 | info | e2b3 | palette |
| e08f | power | e2c6 | edit |
| e0a1 | search | e325 | speed |
| e0a2 | settings | e333 | sun |
| e0e8 | eye | e34b | segments |
| e116 | sync | e38f | cancel |
| e139 | playlist | e390 | confirm |
| e18a | add | e395 | expand |
| e22d | nodes | e409 | intensity |
| e23d | pattern | e410 | star |
| e900 | pixelforge | e901 | editor |

## style.css — shared settings styles

`wled00/data/style.css` (221 lines) is the stylesheet for the settings pages and the tool pages. It is not used by the main control page (which has `index.css`).

Served at `/style.css` (and `/settings/style.css` through `serveSettings` → `SUBPAGE_CSS`) from PROGMEM `PAGE_settingsCss`, gzipped and minified with clean-css, FS override allowed (`wled_server.cpp:387-390`, `wled_server.cpp:752`, `wled_server.cpp:867`; `tools/cdata.js:317-325`).

Loaded by: all `settings_*.htm`, `msg.htm` (`@import`), `edit.htm`, `cpal.htm`, `pixelforge.htm` (runtime via `loadResources()`).

What it defines:
- Dark theme: body `#111`, panels `#222`, controls `#333`, accent link `#28f`, Verdana, centered text, `line-height: 200%` (`style.css:4-25`).
- `.sec` card (max 520 px, rounded 20 px) (`style.css:26-32`).
- Pill buttons `button, .btn` (20 px font, radius 24 px), `button.sml` (`style.css:33-58`).
- Inputs/selects on `#333`, `input:invalid` red, number input width classes `.xxl/.xl/.l/.m/.s/.xs` (`style.css:86-146`).
- `.hide`, `.err` (red), `.warn` (amber), `.toprow` sticky header, `.helpB` help button position (`style.css:63-85`).
- `#toast` with `.show` (green) and `.error` (red) states used by `showToast()` in common.js (`style.css:168-195`, `common.js:162-170`).
- Mobile tweaks under 767 px and 480 px: 16 px input font (prevents iOS zoom), narrower number inputs (`style.css:197-221`).

`/skin.css` is a separate, user-supplied override for the main UI: served from FS if present, otherwise an empty 200 `text/css` response (`wled_server.cpp:397-402`). The main UI links it (`index.js:219`); users upload it in UI settings (`settings_ui.htm:256`).

## Replacement notes

**MVP scope:**
- Welcome page: Not needed. The replacement does its own onboarding (device discovery, PRD §6). WiFi provisioning of an unconfigured device in AP mode is outside the PRD.
- 404 / msg / usermod / dmxmap: Deferred or not applicable. The replacement has its own error pages.
- Icons: The replacement should use its own icon set. The WLED glyph map is useful only for visual parity.
- style.css: Not reused. Its color values (`#111`, `#222`, `#333`, `#28f`) are a reference if visual continuity with stock WLED matters.

Gotchas:
- Several WLED endpoints respond with the `msg.htm` HTML page (with 401/500/501 codes) instead of JSON: settings POSTs, `/reset`, `/update`, `/edit` without PIN. The server's WLED client must treat these as HTML and branch on status code.
- `/reset` reboots on GET. Do not prefetch or link it in a way a browser might preload.
- `/?sliders` is needed to reach the stock control page when the device is still in welcome mode; the "Open WLED Advanced UI" link should use `/settings` or `/?sliders` rather than bare `/` if the device might be unconfigured.
