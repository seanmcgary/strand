# UI Settings (`settings_ui.htm`)

Source: `wled00/data/settings_ui.htm`. Loaded at `/settings/ui`, values from `GET /settings/s.js?p=3` (`wled00/xml.cpp:472-476`), saved via `POST /settings/ui` → `wled00/set.cpp:430-438`.

The page mixes two unrelated storage locations:

1. Two server-side fields stored on the device (cfg.json).
2. Browser-only preferences stored in `localStorage["wledUiCfg"]`, scoped to the browser *and* the device origin (IP/hostname).

The Save button calls `Save()` (`settings_ui.htm:165-168`): it always writes localStorage (`SetLS()`), and submits the form to the device only if `DS` or `SU` changed from their initial values.

## Server-side fields

| Label | Field | Type | set.cpp | cfg.json |
|---|---|---|---|---|
| Device Name | `DS` | text, maxlength 32 (`settings_ui.htm:231`) | `set.cpp:432` → `serverDescription`. Live. Shown as the device name in the main UI, `/json/info` `name`, XML API `<ds>`, sync node list, backup filenames, Alexa/MQTT discovery. Default "WLED". | `id.name` |
| Enable simplified UI | `SU` | checkbox (`:232`) | `set.cpp:433` → `simplifiedUI`. Live. Reported in `/json/info` as `simplifiedui`; the main UI hides segments, most controls, and uses a reduced effect list (`index.js:655`, `:789`, `:913`, `:1346`). | `id.sui` |

Every UI save also re-enumerates ledmaps and reloads custom palettes (`set.cpp:434-437`); side effect, not user visible. Response "UI settings saved." with redirect.

## Client-side preferences (`localStorage.wledUiCfg`)

The main UI defines defaults in `index.js:31-36` and merges stored values over them on load (`index.js:252-253`), then rewrites the merged object to localStorage in `applyCfg()` (`index.js:99-113`). On this page `GetLS()` reads the object and `genForm()` walks it recursively (`settings_ui.htm:69-136`): keys that already have a static input (by id = path joined with `_`) get their value and label filled; any other key gets a generated input in `#gen` (boolean → checkbox, number → number, string → text). Labels come from the `l` map (`:20-57`). `SetLS()` writes every `.agi` input back by id path (`:138-155`).

Generated-only inputs: the color selection checkboxes (`comp_colors_*`) have no static markup and are created in `#gen` under the heading "Color selection methods". Any unknown keys a future main UI adds also appear there automatically.

| Label | localStorage path (input id) | Type | Default | Effect in main UI |
|---|---|---|---|---|
| Color Wheel | `comp.colors.picker` (`comp_colors_picker`) | bool (generated) | true | Show iro color wheel |
| RGB sliders | `comp.colors.rgb` | bool (generated) | false | Show RGB sliders |
| Quick color selectors | `comp.colors.quick` | bool (generated) | true | Show quick color swatches |
| HEX color input | `comp.colors.hex` | bool (generated) | false | Show hex input |
| Show button labels | `comp.labels` (`:242`) | bool | true | Text labels under tab/top buttons |
| Sort presets by ID | `comp.idsort` (`:243`) | bool | false | Preset list order |
| Show bottom tab bar in PC mode | `comp.pcmbot` (`:244`) | bool | false | |
| Show preset IDs | `comp.pid` (`:245`) | bool | true | |
| Set segment length instead of stop LED | `comp.seglen` (`:246`) | bool | false | Segment editor input mode |
| Hide segment power & brightness | `comp.segpwr` (`:247`) | bool | false | |
| Always expand first segment | `comp.segexp` (`:248`) | bool | false | |
| Use effect default parameters | `comp.fxdef` (`:249`) | bool | true | Sends `fxdef` with effect changes so speed/intensity/etc. reset to effect metadata defaults (`index.js:2451`) |
| Power button preset override for On | `comp.on` (`:250`) | number 0-250 | 0 | If >0, power-on button applies this preset (`index.js:1830`) |
| Power button preset override for Off | `comp.off` (`:251`) | number 0-250 | 0 | If >0, power-off applies this preset (`index.js:1831`) |
| I hate dark mode | `#dm` (not `.agi`) → writes hidden `theme.base` (`theme_base`, `:273`) = "light"/"dark" (`UI()`, `:180-185`) | bool → string | "dark" | Light theme |
| Button opacity | `theme.alpha.tab` (`:254`) | number 0-1 step 0.01 | 0.8 | |
| Enable custom CSS | `comp.css` (`:255`) | bool | true | Main UI loads `/skin.css` (`index.js:300`) |
| Custom CSS upload | file input `data` + Upload button (`:256`) | `.css` file | — | `uploadFile()` → `POST /upload` as `/skin.css` (`common.js:171-191`) |
| Background opacity | `theme.alpha.bg` (`:259`) | number 0-1 | 0.6 | |
| BG HEX color | `theme.color.bg` (`:260`) | text, maxlength 9 | "" | Overrides `--c-1` |
| BG image | file input `theme_bg_img` (`:261`) | image file | — | Read as data: URL into `theme.bg.url` (`ownBg()`, `:201-211`). Stored in localStorage, not on the device. |
| Remove (BG image) | button | — | — | Clears URL (`removeBgImg()`, `:212-218`) |
| Random BG image | `theme.bg.rnd` (`:262`) | bool | false | Sets URL to `https://picsum.photos/1920/1080` and swaps `#Image`/`#NoImage` (`randomBg()`, `:188-199`) |
| BG image URL | `theme.bg.url` (`:265`) | text | "" | Hidden when random or when a data: URL is set |
| Grayscale | `theme.bg.rndGrayscale` (`:270`) | bool | false | Only visible with random BG |
| Blur | `theme.bg.rndBlur` (`:271`) | bool | false | Only visible with random BG |
| Enable custom Holidays list | `comp.hdays` (`:274`) | bool | false | Main UI fetches `/holidays.json` for seasonal background images (`index.js:261-270`) |
| Holidays upload | file input `data2` + Upload (`:275`) | `.json` | — | `POST /upload` as `/holidays.json` |

Other buttons:

- "Clear local storage" (`cLS()`, `:157-163`) removes `wledP` (preset cache), `wledPmt` (preset file mtime signature), `wledPalx` (palette preview cache). It does not clear `wledUiCfg`.

Other localStorage keys the main UI uses but this page does not edit: `pcm` (PC mode toggle, `index.js:259`, `:3175`), `locIp` (remote-host mode, `index.js:234-237`).

Note: the file inputs `data` and `data2` sit inside the settings form, so a form submit (when `DS`/`SU` changed) also posts them as fields; set.cpp ignores them.

## Replacement notes

PRD scope: device name is in §18 ("device name"). `DS` is the field; it belongs in the Network or Device section of the replacement. `SU` (simplified UI) only affects the stock UI and is out of scope.

The localStorage preferences are specific to the stock UI and have no meaning for the replacement. The PRD's optional `preferences` table (§24) is the place for equivalent replacement-UI preferences; do not try to read or write `wledUiCfg` (it is per-browser, per-origin and unreachable from the server anyway).

Gotchas:

- Posting the UI form with only `DS` turns `SU` off (checkbox semantics). Post both, or use `POST /json/cfg {"id":{"name":"..."}}`.
- `DS` max 32 chars; it is used in backup filenames and the node list, so the replacement should keep it in sync with its own device registry name (PRD §7) or clearly separate "name in this app" from "name on device".
- `/skin.css` and `/holidays.json` uploads go through `/upload`, which requires the settings PIN when one is set (`wled_server.cpp:207-210`).
