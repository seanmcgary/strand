# Custom Palette Editor (`/cpal.htm`)

Source: `wled00/data/cpal/cpal.htm` (890 lines). Firmware side: `loadCustomPalettes()` in `wled00/colors.cpp:267-317`, `rmcpal` in `wled00/json.cpp:549-554`, per-pixel `i` arrays in `wled00/json.cpp:314-358`.

## Purpose

Create, edit, preview and delete user gradient palettes. Each custom palette is a file `/paletteN.json` on the device filesystem. The editor also offers a library of built-in WLED palettes and an optional downloaded set of cpt-city palettes as starting points.

## How it is reached

- Main UI: "Palettes" button in the color panel button row, `wled00/data/index.htm:145` (`getURL('/cpal.htm')`, icon `&#xe2b3;`).
- Direct URL `/cpal.htm`. Served from FS if `/cpal.htm` exists there, otherwise PROGMEM `PAGE_cpal` (`wled00/wled_server.cpp:664-667`).
- "Back to the controls" returns to `getURL('/')` (`cpal.htm:58`).

## Features

| Feature | Where |
|---|---|
| iro.js color wheel + value slider, plus R/G/B number inputs | `cpal.htm:91-111` |
| Gradient bar with draggable markers (stops). Click empty area to add a stop (color sampled from the current gradient). First (0) and last (255) stops are locked in position | `cpal.htm:127-162`, `cpal.htm:294-307` |
| Max 16 stops | `cpal.htm:292` |
| Arrow keys nudge the selected stop (Shift = 8) | `cpal.htm:164-171` |
| Generate: random palette (1/3) or harmonic triadic/tetradic (2/3) with 1-4 inner stops | `cpal.htm:342-373` |
| Distribute: space inner stops evenly | `cpal.htm:323-333` |
| Copy / Paste a stop color, Delete stop | `cpal.htm:217-225`, `cpal.htm:309-314` |
| "Preview on selected segments" checkbox: pushes the gradient to the LEDs live | `cpal.htm:119-123`, `cpal.htm:653-684` |
| Custom palette list with per-slot Save (←) and Delete (✖), plus one "Empty slot" to save a new palette | `cpal.htm:445-489` |
| Memory warning when more than 10 custom palettes exist | `cpal.htm:48`, `cpal.htm:488` |
| Built-in WLED palettes (from the main UI's `wledPalx` localStorage cache) as templates | `cpal.htm:187-197` |
| "Download more palettes": fetches a curated cpt-city set from GitHub, cached in localStorage, grouped by category | `cpal.htm:590-599`, `cpal.htm:402-413`, `cpal.htm:492-527` |

Touch support: taller bar and wider markers under `@media (pointer: coarse)` (`cpal.htm:782-793`).

## Endpoints, files and storage

| Purpose | Request |
|---|---|
| Palette count/limits, platform | `GET /json/info` → `cpalcount`, `cpalmax`, `arch` (`cpal.htm:180-185`; fields set in `json.cpp:798-800`) |
| Palette names | `GET /json/pal` (`cpal.htm:180`) |
| Read custom palette N | `GET /paletteN.json` (served from FS, `cpal.htm:561`) |
| Save to slot N | `POST /upload` with file `/paletteN.json` via `uploadFile()` (`cpal.htm:530-536`) |
| Delete slot N | `{"rmcpal": N}` over WS or `POST /json` (`cpal.htm:464`; server `json.cpp:549-554`) |
| Live preview | `{"seg":{"id":S,"i":[start,"rrggbb",...]}}` over WS (or HTTP fallback) |
| Unfreeze on exit / preview off | `{"seg":{"frz":false}}` (`cpal.htm:122`, `cpal.htm:689-691`) |
| Read selected segments for preview | `GET /json/state` (`cpal.htm:660`) |
| External palette library | `GET https://wled.github.io/wled-web-tools/cpt_city_selection.json` (`cpal.htm:591`) |

localStorage keys: `wledPalx` (main UI palette preview cache, read here and deleted after save/delete so the main UI refreshes, `cpal.htm:466`, `cpal.htm:534`), `wledCustomPal` (cached custom palettes, `cpal.htm:549-575`), `wledCptCityJson` (downloaded library).

### Palette file format

What cpal.htm writes (`cpal.htm:375`):

```json
{"palette":[0,"ff0000",128,"00ff00",255,"0000ff"]}
```

Firmware also accepts the numeric form `[index,r,g,b, index,r,g,b, ...]` (`colors.cpp:299-307`). Limits from the parser: hex form reads at most 18 stops (36 entries), numeric form at most 18 stops (72 entries); at least 2 stops (`pal.size()>3`) or the file is rejected as "Wrong palette format" (`colors.cpp:284-310`). Only RGB is used; white is dropped.

### Palette IDs

Custom palette slot N maps to palette ID `200 - N` (`wled00/const.h:15-23`): slot 0 is ID 200, growing downward toward 72. Max slots: 129 on ESP32, 10 on ESP8266 (`const.h:21-25`). Missing files in the middle of the range get gray placeholder palettes so later IDs stay stable; scanning stops after 20 consecutive missing files (`colors.cpp:272-316`, `const.h:26`). `rmcpal` deletes the file and reloads all palettes (`json.cpp:549-554`).

### Live preview mechanics

`applyLED()` (`cpal.htm:653-684`):
1. Fetch `/json/state`, take segments with `sel:true` (or the main segment).
2. For each, compute length as `(stop-start) * ((stopY-startY)||1)` and sample the 256-entry gradient cache across it.
3. Send `{"seg":{"id":id,"i":[start, "rrggbb", "rrggbb", ...]}}` in chunks of 128 colors (50 on ESP8266) to stay within one WS frame (`cpal.htm:184-185`, `cpal.htm:677-681`).

Firmware behavior for `i` (`json.cpp:314-358`): disables transitions, sets `seg.freeze = true`, clears the segment to black once, then writes raw pixels (no grouping/spacing/2D expansion). The segment stays frozen until something sends `frz:false`, which the editor does on unchecking preview and on `beforeunload`.

Throttling: preview fires 50 ms after a change on WS, 500 ms on HTTP (`cpal.htm:276-279`). A sequence counter cancels stale sends (`cpal.htm:656-661`). The HTTP fallback queues at most 5 requests with 120 ms spacing (`cpal.htm:629-648`). WS sends wait 15 ms each and skip WS when `bufferedAmount >= 32768` (`cpal.htm:620-626`).

## Notable implementation details

- Not inlined at build time. The page loads `common.js`, then `style.css` and `iro.js` from the device in sequence with infinite retry to avoid 503s on low heap (`cpal.htm:78-86`). The commented `<!--* ... *-->` block in the head is for local file-mode development (`cpal.htm:6-9`).
- Defines its own `connectWs()` that shadows the one in common.js (`cpal.htm:602-616`). Reuses the parent window's `ws` if open.
- Built-in palettes with IDs above `255 - cpalmax` and IDs below 8 are excluded from the template list (`cpal.htm:191`, `cpal.htm:196`).
- After save, it waits 300 ms then refetches `/json/info` and all palette files (`cpal.htm:535`, `cpal.htm:538-576`). After delete, 500 ms.
- WS URL is built as `ws://` + hostname when not behind a detected proxy (`cpal.htm:609`). Under HTTPS this is a mixed-content failure; the HTTP fallback still works.

## Replacement notes

**MVP scope:** Deferred. PRD §11 says "No custom palette editor required for MVP" and §29 lists "Custom palette designer" as explicitly deferred. MVP only needs to list and select palettes, including custom ones.

What the MVP palette picker must handle anyway:
- Custom palettes live at IDs 200 downward; usermod palettes at 255 downward (`const.h:15-23`). `info.cpalcount` gives how many custom slots exist. Custom palettes have no stored names: the stock UI builds labels `~ Custom N ~` client-side for IDs `200-N` (`wled00/data/index.js:1009-1019`). Do not expect them in `/json/pal`.
- `info.cpalcount` includes gray placeholders for gaps. The stock UI hides them by checking `/json/palx` preview data for an all-(128,128,128) 16-entry palette (`index.js:1014`).

Gotchas for a future palette editor:
- Saving is a file upload to `/paletteN.json`; the firmware reloads palettes when the uploaded filename contains `palette` and `.json` (`wled_server.cpp:230`). Requires the settings PIN session if a PIN is set.
- Preview via `i` freezes the segment. Always send `frz:false` when done, including on navigation/disconnect. A server-side proxy should do this on behalf of a browser that went away.
- WS text frames over ~1428 bytes (ESP32) / 528 bytes (ESP8266) are rejected with `{"error":9}` (`wled00/ws.cpp:99-117`). Chunk `i` arrays.
- Stop positions 0 and 255 must exist; firmware gradient loading assumes a full 0-255 range.
