# Main UI: layout, navigation, modes, preferences

Source audited: WLED 17.0.0-dev, `wled00/data/index.htm`, `index.js`, `index.css`, `settings_ui.htm`, `common.js`. All paths below are relative to the WLED repo root.

The main page is a single HTML file (`index.htm`) plus one script (`index.js`) and one stylesheet (`index.css`). `common.js` is **not** loaded by the main page; it is used by settings pages and by the Peek iframes (`liveview.htm`, `liveviewws2D.htm`). `index.js` duplicates a few helpers from it (`gId`, `getURL`, `tooltip`, `showToast`).

## Bundled libraries

| File | What it is | How it is loaded |
|---|---|---|
| `wled00/data/iro.js` | iro.js v5.5.2 (MPL 2.0), the color wheel widget. | Injected by `index.js:49-64` as a `<script>` tag before anything else; retries every 100 ms on error. `onLoad()` runs only after it loads. |
| `wled00/data/rangetouch.js` | RangeTouch v2.0.1 (MIT). Makes `<input type="range">` respond to a tap anywhere on the track on touch devices, instead of requiring a thumb drag. | Plain `<script>` in `index.htm:387`. Set up at `index.js:19` for every range input, with a MutationObserver so dynamically created sliders are covered too. |

## Page structure

From top to bottom (`index.htm`):

| Element | Lines | Notes |
|---|---|---|
| `#devBanner` | `index.htm:15` | Static striped yellow/black bar, "DEVELOPMENT BUILD — WORK IN PROGRESS". Fixed, 24 px (`--dbh`). Present in this dev build only. |
| `#cv` overlay | `index.htm:16` | "Loading WLED UI..." text; faded out (`opacity=0`) at the end of `onLoad()` (`index.js:310`). |
| `#bg` | `index.htm:18` | Fixed full-viewport background image layer (see Themes). |
| Top bar `#top` | `index.htm:20-45` | Eight buttons, brightness slider, 4 px `#liveview` iframe. |
| `.container` | `index.htm:47-328` | Four tab panes: `#Colors`, `#Effects`, `#Segments`, `#Presets`. |
| Bottom bar `#bot` | `index.htm:330-335` | Four tab buttons. |
| `#connind` | `index.htm:337` | Small colored square at bottom-left, connection indicator. |
| `#toast` | `index.htm:338` | Toast; clicking it dismisses an error toast after 100 ms. |
| `#namelabel` | `index.htm:339` | Device name, vertical text at bottom-right; click opens Nodes panel. |
| `#info` modal | `index.htm:340-354` | Info panel. |
| `#nodes` modal | `index.htm:356-363` | Nodes (instance list) panel. |
| `#mlv2D` modal | `index.htm:365-367` | Full-panel 2D Peek container. |
| `#rover` modal | `index.htm:369-377` | "Receiving live data" realtime override panel. |
| `#roverstar` | `index.htm:379` | Icon shown top-left while realtime override is active. |

Modals (`.modal`, `index.css:586-600`) are fixed panels covering everything below the top bar, slid in/out with `transform: translateY(0|100%)` and a 0.4 s transition.

### Top bar buttons

All in `index.htm:22-31`. Each is an icon (WIcons font, embedded as base64 woff2 in `index.css:1-4`) with an optional text label under it (`.tab-label`, shown only when "labels" preference is on).

| Button | id | Label | Handler | Purpose (details in other docs) |
|---|---|---|---|---|
| Power | `buttonPower` | Power | `togglePower()` | Master on/off. See power-brightness-color.md. |
| Timer | `buttonNl` | Timer | `toggleNl()` | Nightlight on/off. |
| Sync | `buttonSync` | Sync | `toggleSync()` | UDP sync *send* on/off. |
| Peek | `buttonSr` | Peek | `toggleLiveview()` | Live LED preview. See info-nodes-liveview.md. |
| Info | `buttonI` | Info | `toggleInfo()` | Info panel. |
| Nodes | `buttonNodes` | Nodes | `toggleNodes()` | Instance list panel. Hidden unless `info.ndc > 0` (`index.js:660`). |
| Config | (none) | Config | `location.href = getURL('/settings')` | Opens settings page. |
| PC Mode | `buttonPcm` | PC Mode | `togglePcMode(true)` | Toggle multi-column layout. |

Active state is shown by the `active` class (gray background). Power/Timer/Sync get it from state in `updateUI()` (`index.js:1291-1293`); Peek toggles the class itself; Info/Nodes/PC Mode set it on toggle.

Responsive hiding (`index.css:1560-1621`):
- Width < 1024 px: PC Mode button hidden; buttons become 8% wide.
- Width ≤ 639 px: buttons 16.6% wide; elements with class `hd` (the "Brightness" heading and section labels) hidden.
- Width 420-639 px: buttons 14.28%.
- Width ≤ 420 px and 640-767 px: Nodes button hidden regardless of `ndc`.

### Brightness row

`#briwrap` (`index.htm:32-42`): "Brightness" heading (class `hd`), a sun icon, the slider `#sliderBri` (1-255), and an `<output class="sliderbubble">` showing the value. Clicking the **sun icon toggles light/dark theme** (`tglTheme()`, `index.htm:35`). At ≥ 640 px the row floats right of the buttons, min width 300 px; below that it wraps under the buttons.

### Bottom tabs

`index.htm:330-335`: Colors (`openTab(0)`), Effects (1), Segments (2), Presets (3). Each 25% wide, translucent background `--c-tb`.

`openTab(i)` (`index.js:339-352`) sets CSS var `--i` on `.container`, which translates the 400%-wide container by `-i*25%`, and writes `location.hash` (`#Colors`, `#Effects`, `#Segments`, `#Presets`). `handleLocationHash()` (`index.js:354-361`) does the reverse and runs on load and on `hashchange` (`index.js:3617`), so tabs are deep-linkable. `openTab` is a no-op in PC mode unless forced.

The Colors tab content is covered in power-brightness-color.md. The palette list at the bottom of the Colors tab, and the Effects, Segments, Presets tabs are covered by a separate audit, except for the transition field (Segments tab), which is covered in power-brightness-color.md because every request carries it.

The Colors tab also has three link buttons (`index.htm:131-150`, `#btns`): **Files** → `/edit`, **PixelForge** → `/pixelforge.htm`, **Palettes** → `/cpal.htm` (custom palette editor). Hidden in simplified UI.

### Swipe gestures (mobile layout)

`index.js:3108-3156`, listeners at `index.js:3619-3624`.

- `mousedown`/`touchstart` on `.container` calls `lock()`: records start X and the current tab's `scrollTop`. Ignored when target has class `noslide` (all color sliders, picker, hex input, effect sliders) or an `Iro*` class (the wheel), or when in PC mode or simplified UI.
- `mouseup`/`mouseout`/`touchend` calls `move()`: if horizontal travel exceeds 12% of window width, the tab did not scroll vertically during the gesture, and there is a tab in that direction, it moves one tab left/right. Animation duration scales with remaining distance (`--f`, `.smooth` class, `index.css:415`).
- Swipe does not update `location.hash` (only `openTab` does).

### Slider bubbles and tooltips

- On touch devices, `touchstart`/`touchend` on any range input toggles the class `sliderbubbleshow` on its `<output>` (`index.js:311-314`, `toggleBubble` at `index.js:1186`). On hover-capable devices, hovering the slider shows the bubble (`index.css:1553-1558`). Bubbles are hidden under 335 px.
- `updateTrail(e)` (`index.js:1170-1183`) paints the filled part of a slider as a gradient on the `.sliderdisplay` div behind it and writes the value into the bubble.
- `tooltip()` (`index.js:3205-3242`) replaces native `title` tooltips with a positioned `<span class="tooltip">` on `pointerover`.

### Global number input clamp

`index.js:316-329`: an `input` listener on the document clamps any `<input type="number">` to its min/max while typing, except inputs whose id starts with `seg`.

### Keyboard shortcuts

There are none at page level. The only key handling:
- Enter in the hex color field applies it (`hexEnter()`, `index.js:2697-2700`).
- Enter in segment number fields applies the segment (`segEnter()`, `index.js:2702-2704`).

## PC mode

`togglePcMode(fromB)` (`index.js:3170-3185`), called from `size()` on every resize (`index.js:3158-3168`).

- `pcModeA` is the user preference; `pcMode = (window.innerWidth >= 1024) && pcModeA`.
- On load (`index.js:259`): enabled if `localStorage.pcm == "true"`, or if `pcm` is unset and the user agent does not match `/Mobi/`. Toggling writes `localStorage.pcm`.
- When active: container width is 100% while `--n` stays 4, so each tab pane is 25% wide and all four tabs appear side by side as columns. The bottom bar height is set to 0 unless the `pcmbot` preference is on. Tab switching and swipe are disabled.
- The color wheel is resized to 230 px when 1024 ≤ width < 1250, else 260 px (`index.js:3178`). Extra compact styles for that width range are in `index.css:1623-1664`.
- Simplified UI forces PC mode off.

## Simplified UI

Firmware flag: `info.simplifiedui` (`json.cpp`, `root["simplifiedui"]`), set by the "Enable simplified UI" checkbox on Settings → User Interface (form field `SU`, stored in cfg.json as `id.sui`; `set.cpp:433`, `cfg.cpp:60`). It is per-device, not per-browser.

`simplifyUI()` (`index.js:3245-3334`) runs once, only from the HTTP response path of `requestJson()` (`index.js:1802`). It:
- Forces PC mode off and makes the container a single pane (`--n: 1`).
- Moves `#fx` (effect list) and `#sliders` (effect sliders) into the Colors tab after the palette list; moves `#segcont` (segment list) and `#pql` (preset quick-load buttons) above the palette list.
- Wraps the palette list and the effect search+list in `<dialog>` elements opened by buttons "Change palette" / "Change effect". After selection, the buttons read "Palette: {name}" / "Effect: {name}" (`index.js:1346-1348`, `1395-1397`), and the dialog closes on select (`index.js:2447-2449`, `2464-2466`).
- Hides: the palette and effect labels, Timer, Sync, Peek and PC Mode buttons, the whole bottom bar, the Effects/Segments/Presets tabs, effect filter checkboxes, and the Files/PixelForge/Palettes buttons.
- In segment rendering (`populateSegments`, `index.js:789`, `833-848`), the select checkbox, name, edit and expand controls get class `hide`, so only segment power/brightness remains; with a single segment the whole list is hidden (`index.js:913`). No segment is shown as "selected" (`index.js:832`).
- Swipe is disabled.

Power, Info, Nodes, Config remain.

## Themes and background

### Light/dark

`cTheme(light)` (`index.js:141-187`) rewrites about 20 CSS custom properties (`--c-1` background … `--c-f` foreground, `--c-r`/`--c-g`/`--c-l` red/green/blue accents, `--c-o` modal overlay, `--c-tb`/`--c-tba`/`--c-tbh` tab bar colors). Defaults in `index.css:6-42` are the dark theme. `--c-y` (#a90) is used for the "request pending" connection indicator. The Info panel logo is inverted in light mode.

Toggled by the sun icon next to the brightness slider, or by "I hate dark mode" in UI settings. Stored as `cfg.theme.base` = `"dark"`/`"light"`.

### Background image

`loadBg()` (`index.js:189-211`):
1. Uses `cfg.theme.bg.url` if set. This may be any URL, a `data:` URL (settings page lets you pick a local image file, which is stored inline in localStorage), or `https://picsum.photos/1920/1080[?grayscale][&blur]` when "Random BG image" is on (the settings page builds that URL; the main page does not look at `rndGrayscale`/`rndBlur`).
2. If the URL is empty or `rnd` is true, a holiday image overrides it when today falls in a holiday window. Built-in list `hol` (`index.js:38-46`): Christmas (Dec 24, 4 days), St. Patrick's (Mar 17), Easter 2026/2027, July 4, New Year. Entry format `[year|0, month0-11, day, durationDays, imageUrl]`. Images are fetched from aircoookie.github.io and images.alphacoders.com, so this makes outbound internet requests from the browser.
3. If `cfg.comp.hdays` is true, `/holidays.json` is fetched first and replaces the built-in list if it is an array (`index.js:261-280`).
4. On image load, `#bg` gets `opacity = cfg.theme.alpha.bg` (default 0.6) and the name label color changes for legibility.

### Custom CSS

If `cfg.comp.css` (default **true**), `/skin.css` is loaded as the last step of the initial load sequence (`index.js:300`, `loadSkinCSS` at `213-224`). Uploaded from UI settings. The firmware returns an empty 200 if the file does not exist (`wled_server.cpp:397-402`).

### Other visual details

- Device name label: vertical text bottom-right, rotated 180° unless it contains CJK characters (`index.js:649-650`).
- If the device name is exactly `Dinnerbone`, the whole page is rotated 180° (`index.js:651`).
- Page title: device name, prefixed `(Live) ` when receiving realtime data and `(L) ` when served via file mode/proxy/HTTPS (`index.js:652-654`).
- The heart in the Info footer cycles hue every 910 ms while Info is open (`index.js:2815-2824`).

## UI preferences (`wledUiCfg`)

The main page keeps preferences in `localStorage.wledUiCfg` as JSON. Defaults (`index.js:31-36`) are deep-merged with the stored value on load (`index.js:252-253`), and `applyCfg()` writes the merged object back every load (`index.js:112`). Settings → User Interface (`settings_ui.htm`) edits the same key; the page must be reloaded to apply. Preferences are per browser *and* per origin (device IP/hostname).

| Key | Default | Settings label | Effect on main page |
|---|---|---|---|
| `theme.base` | `"dark"` | "I hate dark mode" | Light/dark palette. Also toggled by sun icon. |
| `theme.bg.url` | `""` | "BG image URL" / BG image file | Background image. |
| `theme.bg.rnd` | `false` | "Random BG image" | Settings page writes a picsum URL; main page lets holidays override when true. |
| `theme.bg.rndGrayscale` | `false` | "Grayscale" | Settings page only (URL param). |
| `theme.bg.rndBlur` | `false` | "Blur" | Settings page only (URL param). |
| `theme.alpha.bg` | `0.6` | "Background opacity" | `#bg` opacity. |
| `theme.alpha.tab` | `0.8` | "Button opacity" | `--t-b`, tab bar alpha. |
| `theme.color.bg` | `""` | "BG HEX color" | Overrides `--c-1` (page background). |
| `comp.colors.picker` | `true` | "Color Wheel" | Show wheel (else hue+saturation sliders). |
| `comp.colors.rgb` | `false` | "RGB sliders" | Show R/G/B sliders. |
| `comp.colors.quick` | `true` | "Quick color selectors" | Show quick color swatches. |
| `comp.colors.hex` | `false` | "HEX color input" | Show hex field. |
| `comp.labels` | `true` | "Show button labels" | Text under top/bottom bar icons, section headings; padding vars `--tbp`, `--bbp`, `--bhd`, `--bmt`. Also toggled by the tag icon on the Effects intensity slider (`tglLabels`). |
| `comp.pcmbot` | `false` | "Show bottom tab bar in PC mode" | Keep bottom bar in PC mode. |
| `comp.pid` | `true` | "Show preset IDs" | Preset list. |
| `comp.seglen` | `false` | "Set segment length instead of stop LED" | Segment editor. |
| `comp.segpwr` | `false` | "Hide segment power & brightness" | Segment list (`--sgp`). |
| `comp.segexp` | `false` | "Always expand first segment" | Segment list. |
| `comp.css` | `true` | "Enable custom CSS" | Load `/skin.css`. |
| `comp.hdays` | `false` | "Enable custom Holidays list" | Load `/holidays.json`. |
| `comp.fxdef` | `true` | "Use effect default parameters" | Sent as `seg.fxdef` with effect changes. |
| `comp.on` | `0` | "Power button preset override for On" | If > 0, Power-on sends `{"ps": on}` instead of `{"on":true}`. Range 0-250. |
| `comp.off` | `0` | "Power button preset override for Off" | If > 0, Power-off sends `{"ps": off}`. |
| `comp.idsort` | `false` | "Sort presets by ID" | Preset list order. |

Quick toggles on the main page that write `wledUiCfg` immediately (via `applyCfg()`):
- Sun icon → `theme.base` (`tglTheme`, `index.js:122`).
- Icon left of the hex input → swaps `comp.colors.rgb` and `comp.colors.picker` (`tglRgb`, `index.js:134-139`).
- Palette icon left of "Color palette" label → `comp.colors.hex` (`tglHex`, `index.js:116-120`).
- Tag icon on the Effects intensity slider → `comp.labels` (`tglLabels`, `index.js:128`).

Note: `tglRgb` flips two booleans independently, so if the user set both on or both off in settings, it keeps them equal rather than swapping.

The settings page also posts two firmware-side values (not localStorage) to `/settings/ui`: Device Name (`DS`, becomes `info.name`) and Enable simplified UI (`SU`). It has a "Clear local storage" button that removes `wledP`, `wledPmt`, `wledPalx` (not `wledUiCfg`).

## All localStorage keys used by the main page

| Key | Written by | Read by | Content |
|---|---|---|---|
| `wledUiCfg` | `applyCfg()` `index.js:112`; settings_ui.htm | `onLoad()` `index.js:252` | UI preferences above. |
| `pcm` | `togglePcMode(true)` `index.js:3175` | `onLoad()` `index.js:259` | `"true"`/`"false"`. |
| `locIp` | `onLoad()` `index.js:237` | `onLoad()` | Device IP when the page is opened from `file://`. |
| `wledPmt` | `populatePresets()` `index.js:635` | `onLoad()` `index.js:287` | Presets-modified timestamp (`info.fs.pmt`) of the cached presets. |
| `wledP` | `populatePresets()` `index.js:637` | `populatePresets(true)`, `presetError()` | Cached copy of presets.json, also offered as backup/restore. |
| `wledPalx` | `loadPalettesData()` `index.js:2872` | `loadPalettesData()` `index.js:2858` | `{p: palette color data, vid, pcount}`; reused while `info.vid` and `info.palcount` match. |

## File mode, reverse proxy, HTTPS

`onLoad()` (`index.js:231-251`) decides how to build URLs:
- `file:` protocol: `loc = true`, device IP prompted once and stored in `locIp`. All requests go to `http://{locIp}`.
- Path not at root (e.g. `https://proxy/wled/kitchen/`): `loc = true`, `locip = host[:port]/wled/kitchen`, protocol kept. All requests become `{proto}//{locip}{path}`.
- HTTPS at root: `loc = true` so the scheme is kept.
- Otherwise relative URLs are used.

`getURL(path)` (`index.js:226-228`) applies this. The WebSocket URL is `getURL('/ws')` with `http` replaced by `ws` (so `https` → `wss`) when `loc` is true, else `ws://{hostname}/ws` (`index.js:1431`). That last form drops any non-default port.

## Other main-page behavior

- **Visibility refresh**: when the tab becomes visible and the last update was more than 3 s ago, `requestJson()` is called (`index.js:67`, listener at `index.js:308`).
- **Version upgrade / telemetry prompt**: on the first info received, `checkVersionUpgrade()` (`index.js:3339-3393`) reads `/edit?func=edit&path=/version-info.json`. If missing (404) or the stored version differs, it shows a modal "Thank you for installing WLED!" / "WLED Upgrade Detected!" asking to report hardware details. "Report update" fetches `/json/cfg` and POSTs a hardware summary (device id, chip, LED count, bus types, features, peripherals, integrations, usermods) to `https://usage.wled.me/api/usage/upgrade`. The choice is saved by uploading `version-info.json` (`{version, neverAsk, alwaysReport}`) via `POST /upload`. Skipped in AP mode.
- **Realtime ("live") overlay**: see info-nodes-liveview.md.

## Replacement notes

**In MVP scope (PRD §9, §21, §26):** a device control screen with power, brightness, color, effect, palette and segment selection; a link out to the stock UI for advanced settings. Light/dark theming is reasonable to keep as a single app-level preference.

**Out of scope:** PC mode as a separate mode (a responsive layout replaces it), swipe-between-tabs, simplified UI mode (the replacement is the simplified UI), background images, holiday images, custom `skin.css`, the "Dinnerbone" rotation, the dev banner, the upgrade telemetry prompt, file-mode/`locIp`, and the Files/PixelForge/custom palette editor links (PRD §29 defers pixel painting and the palette designer; these can be reached through the "Open WLED Advanced UI" escape hatch).

**Gotchas:**
- Stock UI preferences live in the browser's localStorage per device origin. The replacement should store its own preferences server-side (PRD §24 `preferences`) and not try to read `wledUiCfg`.
- `comp.on` / `comp.off` (power button preset override) is a real feature some users rely on: the power button runs a preset instead of toggling. Consider a per-device setting for it.
- `info.simplifiedui` and `info.name` are firmware-side and settable via `/settings/ui`; the replacement can ignore `simplifiedui`.
- The stock UI loads data strictly one request at a time to avoid HTTP 503 on low-heap devices (`index.js:289`). The replacement's server should serialize requests per device the same way.
- Deep links by tab hash (`#Effects` etc.) exist; the "Open WLED Advanced UI" link can point to `http://{device}/settings` or `/#Segments` etc.
