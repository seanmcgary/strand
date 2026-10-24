# Main UI: power, brightness, timer, sync, transition, Colors tab

Every payload below is sent through `requestJson()` (`wled00/data/index.js:1756`), which adds `"v": true`, `"time": <unix seconds>`, and `"transition"` when the Transition field changed. See data-flow.md for transport details.

## Top-bar controls

### Power

- Look: power icon with "Power" label, first top-bar button. Gray `active` background when on.
- Handler: `togglePower()` (`index.js:1821-1833`).
- Behavior:
  1. Flip local `isOn`, build `{"on": isOn}`.
  2. If turning on while the device is receiving realtime data and is configured to put live data only on the main segment (`info.live && info.liveseg >= 0`), add `"live": false` and `"seg": [{"id": info.liveseg, "frz": false}]` to exit realtime mode and unfreeze that segment.
  3. If `cfg.comp.on > 0` and turning on, replace the whole payload with `{"ps": cfg.comp.on}`. Same for `cfg.comp.off` when turning off. (Preset override, UI settings.)
  4. Button state is re-rendered from the returned `state.on`, not from the local flip.
- Firmware semantics (`json.cpp` `deserializeState`): `on` accepts `true`, `false`, or `"t"` (toggle). Turning on unfreezes all segments, except the main segment stays frozen while realtime data is active with "use main segment only". If `bri` is also in the payload and nonzero, the light turns on.

### Brightness

- Look: "Brightness" heading (hidden below 640 px and when labels are off), sun icon, full-width slider with filled-track gradient, value bubble on hover/touch (`index.htm:32-42`).
- Input: `#sliderBri`, `min=1 max=255`. `oninput` only updates the trail and bubble; `onchange` (release) calls `setBri()` (`index.js:2472-2476`).
- Payload: `{"bri": 1-255}`.
- Display: set from `state.bri` in `readState()` (`index.js:1472`). Firmware reports `briLast`, the last nonzero brightness, so the slider keeps its value while the light is off.
- The sun icon is not a brightness control; it toggles light/dark theme.
- Firmware: `bri` 0-255; 0 turns the light off. The UI never sends 0.

### Timer (nightlight)

- Look: timer icon, "Timer" label. Active background when `state.nl.on`.
- Handler: `toggleNl()` (`index.js:1835-1846`). Flips local `nlA`, shows a toast, sends `{"nl": {"on": bool}}`.
- Toasts:
  - On: "Timer active. Your light will turn {on|off} after {nlDur} minutes." `on` if `state.nl.tbri > 0`, else `off`. The code has an "over"/"after" switch on `nlMode`, but `nlMode` is never set from state, so it always says "after".
  - Off: "Timer deactivated."
- Duration, mode and target brightness cannot be changed from the main page. They come from LED Preferences (Settings → LED: "Default duration" `TL` 1-255 min, "Default target brightness" `TB` 0-255, mode select `TW`, `settings_leds.htm:1140-1143`).
- Firmware keys (`json.cpp`): `nl.on` (bool), `nl.dur` (minutes, 1-255), `nl.mode` (0 = set target brightness after duration, 1 = fade, 2 = color fade (fade to target and secondary color), 3 = sunrise/sunset effect, max 60 min; `const.h:538-541`), `nl.tbri` (0-255), read-only `nl.rem` (seconds remaining, -1 when inactive). The stock UI reads `on`, `dur`, `tbri` only and never shows the countdown.

### Sync

- Look: sync icon, "Sync" label. Active background when `state.udpn.send`.
- Handler: `toggleSync()` (`index.js:1848-1856`). Sends `{"udpn": {"send": bool}}`.
- Toasts: "Other lights in the network will now sync to this one." / "This light and other lights in the network will no longer sync."
- Only the *send* side is toggled. Receive (`udpn.recv`, derived from `rgrp != 0`) is not touched; the code that would have toggled it is commented out (`index.js:1854`).
- Firmware keys: `udpn.send` (runtime send flag), `udpn.sgrp` / `udpn.rgrp` (sync group bitmasks), `udpn.nn` (if true, don't send a sync notification for this request). Read-only `udpn.recv`.

### Transition time and blending style

These live in the Segments tab but affect every request.

- Transition field `#tt` (`index.htm:287`): number, 0-65.5 s, step 0.1, default display 0.7. Display = `state.transition / 10`.
- It is not sent on its own. `requestJson()` adds `"transition": round(tt*10)` to the next command whenever the field value differs from the last known `state.transition` (`index.js:1767-1771`). So changing it has no effect until some other control is used.
- Setting it to 0 hides the blending style select.
- Blending style `#bs` (`index.htm:288-309`) sends `{"bs": n}` immediately on change. Options: 0 Fade, 1 Fairy Dust, 2 Swipe right, 3 Swipe left, 16 Push right, 17 Push left, 4 Outside-in, 5 Inside-out; 2D only (shown only with a matrix): 6 Swipe up, 7 Swipe down, 8 Open H, 9 Open V, 18 Push up, 19 Push down, 10 Swipe TL, 11 Swipe TR, 12 Swipe BR, 13 Swipe BL, 14 Circular Out, 15 Circular In. The 2D filter rebuilds the `<option>` list (`index.js:665-668`) because hiding options does not work on iOS.
- Firmware: `transition` is in 100 ms units and sets the runtime default transition (`transitionDelay = tr*100`). `tt` (same units) applies once to the current request only; the stock UI does not use it. `bs` is masked to 0-31.

## Colors tab

Order in `index.htm:48-171`: color wheel, hue slider, saturation slider, value slider, Kelvin slider, RGB sliders, white slider, white balance slider, quick colors, color slot buttons, slot legend, hex input, Files/PixelForge/Palettes buttons, palette section (covered by the Effects/Palettes audit).

### Light capability flags

Computed in `readState()` (`index.js:1490-1517`) by OR-ing `seg.lc` over all **selected** segments (or the main segment if none is selected):

| Flag | Source bit | Meaning (firmware `FX_fcn.cpp:1153-1185` `refreshLightCapabilities`) |
|---|---|---|
| `hasRGB` | `lc & 0x01` | Segment covers an RGB bus, or a CCT bus with "calculate CCT from RGB", or a white bus whose auto-white mode derives W from RGB (Accurate/Brighter). |
| `hasWhite` | `lc & 0x02` | Segment covers a bus with a white channel whose auto-white mode is None or Dual, so the white channel is user-controlled. |
| `hasCCT` | `lc & 0x04` | Segment covers a CCT-capable bus (and CCT is not derived from RGB), or white balance correction is enabled. |
| `has2D` | geometry | Selected segment is wider and taller than 1. |

`info.leds.lc` is the OR across all active segments; the stock UI does not use it for the Colors tab (only the telemetry report). `info.leds.wv`, `info.leds.cct`, `info.leds.rgbw`, `info.leds.seglc` are deprecated equivalents.

### Visibility rules

`updateUI()` (`index.js:1313-1323`), with `ccfg = cfg.comp.colors`:

| Control | Element | Shown when |
|---|---|---|
| Color wheel | `#picker` | `hasRGB && ccfg.picker` |
| Hue slider | `#hwrap` | `hasRGB && !ccfg.picker` |
| Saturation slider | `#swrap` | `hasRGB && !ccfg.picker` |
| Value slider | `#vwrap` | `hasRGB` |
| Kelvin slider | `#kwrap` | `hasRGB && !hasCCT` |
| R, G, B sliders | `#rgbwrap` | `hasRGB && ccfg.rgb` |
| White slider | `#wwrap` | `hasWhite` |
| White balance slider | `#wbal` | `hasCCT` |
| Quick colors | `#qcs-w` | `hasRGB && ccfg.quick` |
| Hex input | `#hexw` | `ccfg.hex` (independent of capabilities) |
| Color slot buttons | `#csl` | Always; individual buttons hidden per effect metadata |
| Palette section | `#palw` | `hasRGB` and the effect uses a palette (`setEffectParameters`, `index.js:1725`) |

For an on/off-only segment (`lc == 0`) only the slot buttons and hex input (if enabled) remain.

### Color wheel (iro.js)

- Created at `index.js:53-59`: `width: 260` (230 in PC mode at 1024-1249 px), `wheelLightness: false` (the wheel always shows full-value colors; darkness is on the Value slider), `wheelAngle: 270`, `wheelDirection: "clockwise"`, single Wheel component.
- `color:change` (any change, including programmatic) → `updatePSliders()` (`index.js:2663-2695`): syncs R/G/B, H/S/V and Kelvin sliders, hex field, and the gradient backgrounds of the S and V sliders.
- `input:end` (user released the wheel) → `setColor(1)`. The wheel sends nothing while dragging.
- Class `noslide` and `Iro*` classes stop tab swipe from triggering on the wheel.

### Hue / Saturation / Value sliders

- `#sliderH` 0-359 (step any), rainbow gradient track. `oninput` → `cpick.color.setChannel('hsv','h',v)`; `onchange` → `setColor(0)`.
- `#sliderS` 0-100, gray→current hue gradient. Same pattern with `s`.
- `#sliderV` 0-100 ("Value/Brightness"), black→current color gradient. Same pattern with `v`. This is the HSV value of the color sent, separate from master brightness.

### Kelvin slider

- `#sliderK` 1900-10091, gradient orange→white→blue (`index.css:715-716`). `oninput` → `cpick.color.set({kelvin})`; `onchange` → `setColor(0)`.
- It sets the **RGB** color to iro.js's approximation of that color temperature. It does not send `cct`. Shown only for RGB segments without CCT capability.
- Its position is updated from the current RGB (`cpick.color.kelvin`) whenever the color changes.

### RGB sliders

- `#sliderR`, `#sliderG`, `#sliderB`, 0-255 each. Hidden by default (`comp.colors.rgb` false).
- `oninput` → `fromRgb()` (`index.js:2748-2759`): update wheel, write the values into the active slot's `data-r/g/b`, repaint slot. `onchange` → `setColor(0)`.

### White channel slider

- `#sliderW` 0-255 ("White channel"). `oninput` → `fromW()` (`index.js:2761-2768`): writes `data-w` of the active slot, repaints. `onchange` → `setColor(0)`.
- Shows the active slot's W value (`selectSlot`, `index.js:2642`).

### White balance (CCT) slider

- `#sliderA` 0-255 ("White balance"), same orange→white→blue gradient. `onchange` → `setBalance(v)` (`index.js:2789-2793`) → `{"seg": {"cct": 0-255}}`.
- Display from the driving segment's `cct` (`index.js:1528`).
- Firmware (`FX_fcn.cpp:675-688` `setCCT`): values 0-255 are relative (0 = warmest, 255 = coldest); values > 255 are treated as Kelvin, clamped to 1900-10091 and mapped to 0-255 by `(K-1900)>>5`. CCT applies to the whole segment, not per color slot.

### `setColor(sr)` — the color send path

`index.js:2771-2787`. `sr`: 0 = from sliders/quick color, 1 = from wheel, 2 = from hex.

1. Read active slot (`csel`) dataset r, g, b, w.
2. If from the wheel and the slot was black (r=g=b=0), force HSV value to 100 first, so picking a hue on a black slot gives a full-brightness color.
3. Unless from hex, take `w` from the white slider when `hasWhite`.
4. If `hasRGB`, r, g, b = wheel color; otherwise r = g = b = w (white-only and on/off segments).
5. Store into the slot, repaint it.
6. Send `{"seg": {"col": [[...],[...],[...]]}}` where only index `csel` is filled with `[r, g, b, w]` and the others are `[]`.

Firmware handling of `col` (`json.cpp` `deserializeSegment`): `col` is an array of up to 3 entries; each entry may be:
- `[r,g,b]` or `[r,g,b,w]` integers 0-255; an empty array leaves that slot unchanged.
- a hex string `"RRGGBB"` or `"RRGGBBWW"` (`colors.cpp:564-581`; the comment in `json.cpp` says `[WW]RRGGBB`, but the parser reads the 8-digit form as R, G, B, W),
- `"r"` for a random color,
- an integer: Kelvin color temperature converted to RGB, or 0 for black,
- an object `{"r":..,"g":..,"b":..,"w":..}` with any subset of channels.

Colors only apply to segments with RGB or white capability; for on/off segments, slot 0 is forced to white and slot 1 to black. `seg` without `id` applies to all selected segments. On the Solid effect the change renders immediately. Firmware reports colors as `[r,g,b,w]` when any bus has a white channel, else `[r,g,b]`.

### Color slots (primary/secondary/tertiary)

- Look: three 44 px square buttons labeled 1/2/3 (`index.htm:119-123`), background = the slot's color, with a vertical gradient into the slot's white level when `hasWhite` and W > 0 (`setCSL`, `index.js:85-97`). Text color flips black/white by luminance. The active slot is 50 px with a 5 px border (`index.css:1108-1121`).
- Click → `selectSlot(i)` (`index.js:2633-2645`): local only, no request. Sets the wheel to the slot's RGB, white slider to its W, refreshes palette previews (palettes like "* Colors 1&2" are drawn from slot colors).
- Populated from the driving segment's `col[0..2]` on every state update (`index.js:1519-1527`). W is stored only if `hasWhite`, or if the segment has neither RGB nor white.
- Labels and visibility depend on the selected effect's metadata (`setEffectParameters`, `index.js:1680-1717`):
  - Effect without metadata: all three shown as 1, 2, 3.
  - Effect metadata color field `!` → default names `Fx`, `Bg`, `Cs`.
  - Custom names → first two characters on the button; full names listed below in `#cslLabel` as "Ab=Abcdef, ...".
  - Slots not used by the effect are hidden.
  - Selecting palettes 2-5 ("* Color 1", "* Colors 1&2", "* Color Gradient", "* Colors Only") force-shows slot 1, slots 1-2, or all three (`index.js:1350-1358`).
  - If the active slot gets hidden, the first visible slot becomes active.

### Quick colors

`index.htm:106-118`, shown when `hasRGB && comp.colors.quick`. Round 28 px swatches in two rows. Click → `pC(col)` (`index.js:2649-2661`): set the wheel to the color, then `setColor(0)` on the active slot. W comes from the white slider.

| Row | Colors |
|---|---|
| 1 | `#ff0000` red, `#ffa000` orange, `#ffc800` yellow-orange, `#ffe0a0` warm white, `#ffffff` white (bordered), `#000000` black (bordered) |
| 2 | `#ff00ff` magenta, `#0000ff` blue, `#00ffc8` aqua, `#08ff00` green, `R` (rainbow gradient, random) |

Random: hue random 0-359 but at least 50° away from the previous random hue, saturation 50-100%, value 100% (`index.js:2651-2658`). Picking black sets HSV value 0 (`setPicker`, `index.js:2719-2726`).

### Hex input

- `#hexw` (`index.htm:125-129`): an icon button (toggles wheel ↔ RGB sliders, `tglRgb`), a text field `#hexc` (max 8 chars), and a confirm button.
- Display: current wheel RGB as 6 hex digits, plus the slot's W in hex if W > 0 (`index.js:2671-2674`). W is not zero-padded, so W < 16 renders as one digit.
- Apply: Enter key (`hexEnter`) or confirm button → `fromHex()` (`index.js:2706-2717`): first 6 chars → wheel (invalid input falls back to `#ffaa00`), chars 7-8 parsed as W (else 0), then `setColor(2)`. Format is `RRGGBB[WW]`. The UI converts to an array before sending, so the firmware's hex parsing is not involved.
- Shown when `comp.colors.hex`; toggled by the palette icon beside the "Color palette" heading.

### "Set to segment" behavior

There is no explicit "apply to segment" button. All color, CCT, effect and palette changes are sent as `seg` without `id`, so the firmware applies them to every segment with `sel: true`. Which segments are selected is controlled by the checkboxes in the Segments tab (or by other clients). The controls display values from the first selected segment (see data-flow.md). With several selected segments of different colors, the UI shows the first one's colors and overwrites only the active slot of all of them on change.

## Replacement notes

**In MVP scope (PRD §8, §9, acceptance 5-7):** power, brightness, a color picker, segment selection. The dashboard needs quick power and brightness per device.

**Reasonable to include:** the three color slots (effects use slots 2 and 3 as background/accent colors; without them many effects are not fully controllable), white channel and CCT sliders driven by `seg.lc` (RGBW and CCT strips are common), quick color swatches.

**Out of scope or optional:** Timer (nightlight) and Sync quick toggles are not in the PRD's device screen; sync *settings* are in scope (PRD §19), so `udpn.send` could live there. Transition time and blending style are not required. Hex input, RGB sliders and HSV sliders are alternative pickers, not required.

**Gotchas:**
- Send brightness and color on release (or throttle to a few per second). The device rate-limits WS broadcasts to 1/s and each state echo includes everything.
- Power: send `{"on": false}` / `{"on": true}`, not `bri: 0`; reading `state.bri` gives the last nonzero brightness. If the device is in realtime mode with live data on the main segment, turning on should also send `live: false` and unfreeze that segment, or the light appears not to respond.
- Users may have set "power button preset override" in the stock UI (`comp.on`/`comp.off`). This lives only in that browser's localStorage, so the replacement cannot read it.
- Decide per segment which controls to show from `seg.lc`: RGB (bit 0) → wheel; white (bit 1) → white slider sending the 4th `col` element; CCT (bit 2) → `seg.cct` slider (0-255, or send Kelvin 1900-10091 directly). With no RGB, send `[w,w,w,w]` the way the stock UI does.
- The stock Kelvin slider is fake color temperature (RGB approximation). For CCT-capable strips, use `seg.cct`.
- Target segments explicitly (`seg: [{id, col: ...}]`) when the replacement has its own notion of the "current" segment; otherwise changes go to whatever segments some other client left selected.
- Effect metadata (`/json/fxdata`) decides which color slots an effect uses and their names. Read it rather than always showing three slots.
- `col` slot entries `[]` are skipped by the firmware, which is how to change one slot without touching the others.
- The firmware drops the white value in reported `col` arrays when no bus has a white channel (3-element arrays); handle both lengths.
