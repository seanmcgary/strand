# Pixel Art Tools: PixelForge, Pixel Art Converter, PixelMagic

Three separate tools that put images (and in PixelForge's case, text) on 2D matrices. They overlap heavily and come from different authors.

| Tool | File(s) | Author | Compiled in by default | Linked from main UI | Mechanism |
|---|---|---|---|---|---|
| PixelForge | `wled00/data/pixelforge/pixelforge.htm` (1426 lines) + `omggif.js` | @dedehai | Yes, except ESP8266 1M envs (`-D WLED_DISABLE_PIXELFORGE`, `platformio.ini:713-749`) and 1D-only builds (`WLED_DISABLE_2D`) | Yes, "PixelForge" button `wled00/data/index.htm:139` | Converts image to a GIF, uploads to FS, plays it with the Image effect (FX 53) |
| Pixel Art Converter ("pixart") | `wled00/data/pixart/*` | werkstrom | No, needs `-D WLED_ENABLE_PIXART` | No | Converts image to `seg.i` JSON pixel arrays, posts to `/json/state` |
| PixelMagic ("pxmagic") | `wled00/data/pxmagic/pxmagic.htm` (1979 lines) | @ajotanc | No, needs `-D WLED_ENABLE_PXMAGIC` | No | Converts image to `seg.i` JSON, can save as presets and playlists |

All three routes sit inside `#ifndef WLED_DISABLE_2D` (`wled00/wled_server.cpp:633-662`). When PixelForge is disabled, `/pixelforge.htm` returns a small "not supported in this build" page (`wled_server.cpp:653-660`).

Because pixart and pxmagic are off by default, the realistic way users get them is PixelForge's "Other Tools" tab, which downloads tool HTML (gzipped) from a remote list and uploads it to the device filesystem (see below). The FS copy is then served at `/<file>` by the generic file handler, or overrides the PROGMEM copy if one is compiled in (`handleStaticContent` checks FS first, `wled_server.cpp:140-147`).

---

## PixelForge (`/pixelforge.htm`)

Three tabs: Image Tool, Scrolling Text, Other Tools. Last tab is remembered in `localStorage.tab` (`pixelforge.htm:1268-1273`).

### Loading

Loads `common.js` with infinite retry, calls `getLoc()` for proxy detection, fetches `/json/info` (FS usage, version, `arch`), then loads `style.css` and, unless ESP8266, `omggif.js` (`pixelforge.htm:437-450`). cdata.js builds this page with `inlineCss=false`, so `style.css` is fetched at runtime from `/style.css` (`tools/cdata.js:257`). `/omggif.js` is only served when the firmware has `WLED_ENABLE_GIF` (ESP32 variants, `platformio.ini:269`; route `wled_server.cpp:375-379`).

### Image Tool

| Feature | Where |
|---|---|
| Target segment dropdown from `/json/state`, labels show `WxH` or `Npx` and tag segments running Image (53) or Scrolling Text (122) | `pixelforge.htm:482-505` |
| Grid of images already on the device: `GET /edit?list=/`, filtered to gif/png/jpg/jpeg/bmp, thumbnails loaded from `/<name>` | `pixelforge.htm:464-470`, `pixelforge.htm:532-581` |
| Click a GIF → play it on the target segment. Non-GIFs get a red border and are offered for conversion | `pixelforge.htm:564`, `pixelforge.htm:834-848` |
| Right-click: download, delete (`/edit?func=delete&path=/name`) | `pixelforge.htm:1218-1260` |
| Upload: drop or pick any image (GIFs decoded frame by frame with omggif `GifReader`) | `pixelforge.htm:729-790` |
| Crop box with handles, pan, zoom, rotation (with snap), "Match Aspect Ratio", "Match Size (1:1)", "Full Size", Reset | `pixelforge.htm:268-292`, `pixelforge.htm:850-1015` |
| Preview at target resolution, dark-pixel cutoff threshold, background color | `pixelforge.htm:1017-1050` |
| Convert & Upload: renders every frame through crop/rotate/scale, builds a global palette, encodes a GIF with omggif `GifWriter`, uploads `<name>.gif` (max 26 chars + `.gif`) to `/upload` | `pixelforge.htm:1108-1191` |
| 1D segments longer than 320 px are packed into a 2D GIF (WLED GIF width limit) | `pixelforge.htm:1092-1106` |
| Not available on ESP8266 (tab shows a message) | `pixelforge.htm:325`, `pixelforge.htm:1274-1278` |

Play request (`pixelforge.htm:1194-1216`):

```json
{"on":true,"seg":{"id":T,"fx":53,"frz":false,"sx":128,"ix":0,"n":"image.gif"}}
```

If another segment is already running FX 53, it sends an array that resets that segment to `fx:0, n:""` and sets the new one.

**The Image effect takes the GIF filename from the segment name** (`wled00/image_loader.cpp:129-135`; effect metadata `"Image@!,Blur,;;;12;sx=128,ix=0"` in `wled00/FX.cpp:4653`). Renaming a segment that runs FX 53 changes or breaks the image.

### Scrolling Text

| Feature | Where |
|---|---|
| Only for 2D segments; 1D shows "Not available in 1D" | `pixelforge.htm:520-526` |
| Text up to 64 chars, sent as the segment name with `fx:122` | `pixelforge.htm:1325-1330` |
| Sliders map to effect params: Speed `sx`, Y Offset `ix`, Trail `c1`, Font `c2` (step 63), Rotate `c3`; checkboxes Gradient `o1`, Custom Font `o2`, Reverse `o3` | `pixelforge.htm:341-360` |
| Token list (`#TIME`, `#HHMM`, `#DATE`, `#DDMM`, ..., `0` suffix for leading zeros) inserted at cursor | `pixelforge.htm:362-385`, `pixelforge.htm:1288-1298` |
| Local canvas preview of the text | `pixelforge.htm:1383+` |
| Custom fonts: lists `*.wbf` files on FS, delete, and "Download Classic WLED Fonts" from `https://dedehai.github.io/wbfFonts/` → `/upload` | `pixelforge.htm:1348-1381` |

Slider changes auto-apply via `POST /json/state` (`pixelforge.htm:1322-1330`).

As with the Image effect, **the Scrolling Text effect reads its text from the segment name**.

### Other Tools

A small plugin installer (`pixelforge.htm:593-700`):

1. Reads local `/pftools.json` (if present).
2. Fetches `https://wled.github.io/wled-web-tools/pftools.json` and merges new tools or newer versions (version compared with `parseFloat`).
3. Saves the merged list back to `/pftools.json` via `/upload`.
4. Install/update downloads the tool's `.gz` from its URL and uploads it as `<file>.gz`. "Open" navigates to `/<file>`.
5. Tools declare `wled_min`; incompatible ones show "Requires WLED x.y".

The remote list's content is not in the repo. The tool `desc` field is inserted as raw HTML (`pixelforge.htm:655`), while other fields go through `esc()`.

---

## Pixel Art Converter (`/pixart.htm`)

Files: `pixart.htm` (markup), `pixart.css`, `statics.js` (element refs and colors), `getPixelValues.js` (conversion), `boxdraw.js` (canvas preview), `pixart.js` (UI wiring and send), favicons and `site.webmanifest`. cdata.js inlines the CSS and scripts into one gzipped page (`tools/cdata.js:255`). Version string "1.0.8" (`pixart.htm:199`).

Features:
- LED setup: plain 2D matrix, serpentine first row right-to-left, serpentine first row left-to-right (`pixart.htm:38-42`). Serpentine remapping is done client-side (`getPixelValues.js:98-133`).
- Output format: WLED JSON, curl command, Home Assistant `command_line` switch YAML (`pixart.htm:50-54`, `getPixelValues.js:268-303`).
- Color code: hex string or `[r,g,b]` (`getPixelValues.js:29-50`).
- Addressing: Single (`"rrggbb"` list with a start index), Range (`start,stop,"rrggbb"` runs), Hybrid (ranges only where a run is longer than one pixel) (`pixart.htm:73-77`, `getPixelValues.js:157-263`).
- Brightness 1-255 and "max colors per JSON" 1-512; output is split into multiple commands when the color count exceeds the limit (`getPixelValues.js:250-281`).
- Optional resize to W x H; unscaled images over 512 px fall back to 16x16 (`getPixelValues.js:71-81`).
- Target segment: free number input, or click the cloud icon to fetch real segments from `http://<host>/json/state` and fill W/H from segment size (`pixart.js:290-331`).
- Preview grid drawn on a canvas with LED index numbers (`boxdraw.js`).
- Copy to clipboard, "Send to device" (`pixart.js:121-157`).

Generated command shape (`getPixelValues.js:269`):

```json
{"on":true,"bri":128,"seg":{"id":0,"i":[0,5,"ff0000",5,"00ff00",6,16,"0000ff"]}}
```

Send posts each command sequentially to `'http://' + host + '/json/state'` (`pixart.js:129`). The host field defaults to `location.host` (`pixart.js:9`). Sending is refused on HTTPS pages (`pixart.js:91-97`). Alpha is ignored with a warning.

Not linked from anywhere in the main UI.

---

## PixelMagic (`/pxmagic.htm`)

Single self-contained page with its own CSS variables and helpers; does not load `common.js`.

Host: `?hn=<host>` query param, else `location.host` (`pxmagic.htm:849-858`). Editing the Hostname field retargets all requests (`pxmagic.htm:863-870`). All requests go to `${protocol}//${host}`.

Features:
- Pattern (`pxmagic.htm:600-610`): Individual (`["rrggbb", ...]`), Index (`[i, "rrggbb", ...]`), Range (`[start, stop, "rrggbb", ...]`, default).
- Output: WLED JSON, Home Assistant YAML, curl (`pxmagic.htm:612-617`, `pxmagic.htm:1729-1754`).
- Segment dropdown from `/json/state` with W/H from segment bounds (`pxmagic.htm:1073-1123`).
- Brightness, transparent-image mode with a replacement color, resize toggle with W/H.
- Image source: drag/drop or pick a local file, or choose an image already on the device (list from `/edit?list=/`, `pxmagic.htm:1026-1071`).
- Generate → preview canvas and JSON in a textarea (`pxmagic.htm:1346-1388`).
- Simulate: `POST /json/state` with the generated `{on, bri, seg:{id, i}}` (`pxmagic.htm:1155-1178`).
- Save: stores the result as a WLED preset via `POST /json` with `psave` and `n` (`pxmagic.htm:1180-1195`, `pxmagic.htm:959-1024`). Preset ID is found by reading `/presets.json` and matching the name, else last key + 1.
- Animation mode: for GIFs, sends the image to **`https://pixelmagictool.vercel.app/api/wled/frames`** (third-party server) to extract frames, then creates one preset per frame (`"<name> 1"`, `"<name> 2"`, ...) spaced 5 s apart and a playlist preset named `<name>` over them (`pxmagic.htm:1390-1475`, `pxmagic.htm:892-957`).
- Download the output as a file; copy to clipboard.
- After saving a preset it calls `window.parent.postMessage("loadPresets", WLED_URL)` (`pxmagic.htm:981`). The current main UI has no listener for it.

Latent bugs observed: the segment `change` handler assigns undefined `w`/`h` (`pxmagic.htm:1227-1232`); `images()` references an undefined `index` (`pxmagic.htm:1059`).

---

## Shared data paths

| Path | Used by |
|---|---|
| `GET /json/state` (segment list, `start/stop/startY/stopY`, `fx`, `n`) | all three |
| `POST /json/state` with `seg.i` arrays | pixart, pxmagic |
| `POST /json/state` with `fx:53` / `fx:122` and `n` | PixelForge |
| `POST /json` with `psave`, `n`, `playlist` | pxmagic |
| `GET /presets.json` | pxmagic |
| `GET /edit?list=/`, `GET /edit?func=delete` | PixelForge, pxmagic (list) |
| `POST /upload` | PixelForge |
| `GET /json/info` (`fs`, `ver`, `arch`) | PixelForge |

`seg.i` semantics (firmware, `wled00/json.cpp:314-358`): integers set a start, or start then stop; each color (hex string or `[r,g,b(,w)]`) fills from start to stop (or one pixel). Setting `i` freezes the segment, clears it to black the first time, disables transitions, and writes raw pixel indices without grouping/spacing/mirroring.

## Replacement notes

**MVP scope:** Deferred. PRD §29 explicitly defers "Arbitrary per-pixel painting". None of these tools are needed for MVP; the "Open WLED Advanced UI" link covers them.

Gotchas that affect the MVP anyway:
- **Presets can contain large `seg.i` arrays** (pxmagic saves one preset per frame). Preset listing should not render or diff full preset bodies; `presets.json` can be large. Fetch it once and show names.
- **Segment names carry data.** Segments running Image (FX 53) use `n` as a GIF filename; Scrolling Text (FX 122) uses `n` as the text. The MVP's segment rename must not silently rewrite these, and it should display them sensibly.
- **Segments can be frozen** (`frz:true`) after any `i` write. The MVP segment view should show and allow clearing the freeze state, or users will see "stuck" segments.
- pixart and pxmagic hardcode `http://` or use the page protocol and talk to the device directly. They will not work through the replacement app's proxy; the "advanced UI" escape hatch must open the device directly.
- pxmagic sends user images to a third-party Vercel endpoint for GIF frame extraction.
