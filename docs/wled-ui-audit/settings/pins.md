# PIN entry page and Pin Info page

Source: WLED 17.0.0-dev. Paths relative to `wled00/`.

Two unrelated pages share a similar name:

- `data/settings_pin.htm`: the settings **PIN code** prompt (lock screen). Served as `SUBPAGE_PINREQ` (252).
- `data/settings_pininfo.htm`: the **GPIO pin** usage table, menu entry "Pin Info". Served as `SUBPAGE_PINS` (11) at `/settings/pins`.

## `settings_pin.htm` (PIN prompt)

Served with HTTP 401 in place of any protected settings page when a settings PIN is set and not yet entered (`wled_server.cpp:773-777`, `866`).

Content (`settings_pin.htm:15-23`):

- Form `Sf`, `method="post"`, no `action` → posts back to the URL that was requested (e.g. `/settings/leds`).
- One field: `PIN`, `type=password`, exactly 4 digits (`minlength=4 maxlength=4 pattern="[0-9]*" inputmode="numeric"`).
- Back button → `/settings`. Submit button.
- Does not load `common.js` or `s.js`.

Flow on submit (`wled_server.cpp:773-823`, `set.cpp:15-19`, `util.cpp:502-508`):

1. Still locked → subpage becomes `SUBPAGE_PINREQ` → `checkSettingsPIN(PIN)`.
2. If the last attempt was < 3 s ago, the server returns 401 "Access Denied" without checking.
3. Correct → `correctPIN = true` (device-wide), and the originally requested settings page HTML is returned with 200.
4. Wrong → 401 message "PIN rejected", redirect to `/settings` after 3 s.

The PIN is set on the Security page (`settings_sec.htm`, field `PIN`; `set.cpp:657-668`). `0000` from the page is treated as a placeholder and ignored; empty string clears the PIN. See `mechanism.md` for timeout and lock rules.

## `settings_pininfo.htm` (Pin Info)

Read-only, live-updating table of every usable or allocated GPIO.

### Data sources

1. `fetchPinInfo()` (`data/common.js:281-301`): loads `/settings/s.js?p=11` (GPIO info only, `xml.cpp:756-759`, `95-200`) to get `d.rsvd`, `d.ro_gpio`, `d.max_gpio`, `d.touch`, `d.adc`, `d.um_p`. Retries 5× at 100 ms. Requires the settings PIN if one is set (s.js returns 401 otherwise; the page then proceeds without caps).
2. `GET /json/pins` (`json.cpp:1110-1236`), polled every 250 ms (`settings_pininfo.htm:17-20`). Not PIN-protected.

### `/json/pins` format

`{"pins":[ ... ]}`. Only GPIOs that are input-capable, output-capable, or currently allocated are listed (`json.cpp:1118-1123`).

| Key | Meaning |
|---|---|
| `p` | GPIO number |
| `c` | capability bits: `0x02` ADC, `0x08` boot (bootloader-select) pin, `0x10` strapping pin, `0x20` input-only (`pin_manager.h:14-18`). `0x04` PWM is defined but unused. Touch is not included here |
| `a` | allocated (bool) |
| `o` | owner id (`PinOwner`, `pin_manager.h:34-80`): `0x81` Ethernet, `0x82` BusDigital, `0x83` BusOnOff, `0x84` BusPwm, `0x85` Button, `0x86` IR, `0x87` Relay, `0x88` SPI RAM, `0x89` Debug out, `0x8A` DMX, `0x8B` HW I2C, `0x8C` HW SPI, `0x8D` DMX input, `0x8E` HUB75; values < 0x80 are usermod ids. Only when allocated |
| `n` | owner name string from firmware. Only when allocated |
| `m` | mode: 1 output (relay, On/Off bus, multi-relay usermod), 0 input (button) |
| `s` | live state: button pressed (1/0) or output level |
| `t` | button type (0-9, same enum as LED page `BE{n}`) |
| `r` | raw reading for touch buttons (S2/S3 shifted >> 4) and analog buttons (8-bit, inverted for "analog inverted") |

Strapping/boot pins per chip are hard-coded in `json.cpp:1135-1176` (e.g. ESP32: boot 0, strapping 2 and 12; ESP8266: boot 0, strapping 2 and 15; GPIO17 on ESP8266 is A0, input-only + ADC).

### Rendering (`settings_pininfo.htm:24-49`)

Table columns:

| Column | Content |
|---|---|
| Pin | `GPIO<p>` |
| Used by | For buttons with state: a dot (green pressed / grey released) and the raw value. Owner text from `getOwnerName(o,t,n)` (`common.js:254-265`): firmware name `n` if present, "System" if no owner, button type label for `0x85`, else `UM #<id>`. Unallocated pins listed in `d.um_p` show "Usermod"; otherwise blue "Available" |
| Pin Notes | `getCaps(p,c)` (`common.js:266-276`): "Touch" (from `d.touch`), "Input Only" (from `d.ro_gpio`), "Analog" (`c&0x02`), "Flash Boot" (`c&0x08`), "Bootstrap" (`c&0x10`); "-" if none |

Error → "Error loading pin info"; empty list → "No pins available." Back buttons → `/settings`.

The same `/json/pins` data is used by the LED and Sync pages to label pin dropdowns (`common.js:306-356`).

## Replacement notes

MVP scope: neither page is in PRD scope as a standalone screen.

- PIN prompt: the replacement server needs the PIN flow, not the page. Store the device PIN per device (or prompt), send it as `"pin"` in `/json/cfg` POSTs, and show a lock prompt on 401. See `mechanism.md`.
- Pin Info: useful as a helper inside the LED Hardware editor rather than as its own screen. `/json/pins` is clean JSON and unauthenticated; use it to populate GPIO pickers with "in use by X", input-only, boot/strapping warnings. Touch-capable and reserved (flash/PSRAM) pin lists still require `s.js?p=11` (or `p=2`); `/json/pins` omits unusable pins entirely, which is enough to hide them.
- Do not poll at 250 ms from the server for every client; poll only while the pin view is open, or slower.
- Strapping/boot pins are valid LED outputs but deserve a warning (boot may fail if the strip pulls them).
