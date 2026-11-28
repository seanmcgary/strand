# Usermod Settings (`settings_um.htm`)

Source: `wled00/data/settings_um.htm`. Loaded at `/settings/um`; saved via `POST /settings/um` → `wled00/set.cpp:726-861`. Unlike the other pages, the field list is not static: it is generated from the `um` object in `GET /json/cfg`.

## Load sequence

1. `fetch('/json/cfg')` and take `json.um` (`settings_um.htm:25-33`). `um` is built by each compiled-in usermod's `addToConfig()` (`wled00/cfg.cpp:1277-1278`, `wled00/um_manager.cpp:49`).
2. For each top-level key `k` (usermod name), render `<div class="sec"><h3>k</h3>` and walk its value with `addField()` (`:34-43`).
3. Then load `GET /settings/s.js?p=8` (`xml.cpp:705-722`). Before it runs, the page initializes `d.max_gpio`, `d.um_p`, `d.rsvd`, `d.ro_gpio`, `d.extra`, `d.a_pins` (`:44-50`). The script sets `numM` (usermod count), fills the global I²C/SPI fields, calls `addInfo()` for default HW pins, and then emits each usermod's `appendConfigData()` JS (`xml.cpp:707-721`, `um_manager.cpp:25`, `:94-97`). Usermods use this to add unit suffixes, help buttons, dropdowns, and option lists.
4. After the script, `fetchPinInfo(pinDD)` loads `/json/pins` and converts every pin field into a `<select>` (`:51-55`, `pinDD()` `:135-161`).

If `um` is empty: "Usermods configuration not found. Press Save to initialize defaults." If there are no usermods: "No Usermods installed." (`:42`, `:61`).

## Static fields: Global I²C & SPI

| Label | Field | Type | set.cpp |
|---|---|---|---|
| SDA | `SDA` | number -1..48 → pin select (`settings_um.htm:373`) | `set.cpp:734-753`: if SDA or SCL changed, deallocate old pins, allocate new ones as `PinOwner::HW_I2C`; on failure both set to -1. Bus is not re-initialized. |
| SCL | `SCL` | same (`:374`) | same |
| MOSI | `MOSI` | number → pin select (`:377`) | `set.cpp:754-786`, `PinOwner::HW_SPI`. On ESP8266 forced to fixed HW pins (`:757-762`). "only changeable on ESP32". |
| MISO | `MISO` | same (`:378`) | same |
| SCLK | `SCLK` | same (`:379`) | same |
| Reboot after save? | `RBT` | checkbox (`:381`) | `set.cpp:905` → `doReboot`. Response then redirects after 9 s (`wled_server.cpp:820`). |

Default hardware pins are shown next to each input via `addInfo('SDA','<pin>')` etc. (`xml.cpp:713-719`). Text: "change requires reboot!"

## Dynamic field generation (`addField`, `settings_um.htm:96-134`)

For usermod key `k`, field `f`, value `o`:

| JSON value | Rendered input | Hidden type marker |
|---|---|---|
| object | `<hr>` + optional underlined group title (`initCap(f)`), then recurse with name prefix `k:f` (one nesting level only; deeper objects flatten into the same prefix) | — |
| array | one input per element, field name suffixed `[]` | none for arrays |
| boolean | `<input type="checkbox" name="k:f" value="true">` | preceded by `<input type="hidden" name="k:f" value="false">` |
| number, key ends in `pin` | `<input type="number" min=-1 max=max_gpio-1>`, later replaced by a pin `<select>` | hidden `name="k:f" value="int"` |
| number, other | `<input type="number" step="any">` | hidden `value="number"` |
| string / other | `<input type="text">` | hidden `value="text"` |

Labels are `initCap(f)`: non-word chars and `_` become spaces and each word is capitalized. Form names are `UsermodName:field`, `UsermodName:group:field`, with `[]` for arrays.

Pin selects (`pinDD`, `:135-161`): options -1 "unused" and 0..max_gpio-1, skipping `d.rsvd` (reserved/flash/Ethernet/DMX pins), annotating owners from `/json/pins` and "(input only)" for `d.ro_gpio`, disabling pins owned by something else. Usermods can append virtual pins via `d.extra.push({'ModName':{pin:[['label',value],...]}})` (e.g. MultiRelay, rotary encoder use values 100-107 for I/O-expander pins, `usermods/multi_relay/multi_relay.cpp:769`). `UI()` (`:162-190`) keeps pin availability consistent across selects when one changes.

Helper functions usermods call from `appendConfigData()` (kept as globals for compatibility):

| Function | Alias | Purpose |
|---|---|---|
| `addInfo(name, idx|placeholder, after, before)` | `addI` | Insert text after/before the idx-th element with that name, or set placeholder (`:247-256`) |
| `addDropdown(um, field)` | `addDD` | Replace an input with an empty `<select>` (`:192-232`) |
| `addOption(sel, text, value)` | `addO` | Add option (`:233-245`) |
| `addHB(um)` | — | Help button linking `https://kno.wled.ge/usermods/<um>` (`:258-260`) |
| `aOpt`, `rOpt`, `xOpt`, `dOpt`, `dRO` | — | Filter to analog pins, rename/append option text, delete option range, disable read-only pins (`:267-355`) |

Example: `addInfo('Internal Temperature:Loop Interval', 1, 'ms')` (`usermods/Internal_Temperature_v2/Internal_Temperature_v2.cpp:151`). Index 1 targets the visible input, skipping the hidden type marker.

## Save handling (`set.cpp:788-858`)

Submit is intercepted by `svS()` which runs HTML validation then `form.submit()` (`settings_um.htm:261-264`). Server side:

- Iterates all POST args; skips names without `:` (so `SDA`, `RBT` etc. are skipped here).
- `name.substring(0, firstColon)` = usermod object; remainder may contain one more `:` for a sub-object.
- Names ending `[]` build a JSON array; values with `.` become floats, else ints (`,` replaced by `.` first).
- Otherwise uses the hidden-field-first convention: the first occurrence of a name stores its type marker (`"false"` → bool false, else the marker string); the second occurrence converts the real value: bool → true, `"number"` → float or int, `"int"` → int, `"text"` → string. An unchecked checkbox sends only the hidden `false`.
- Calls `UsermodManager::readFromConfig(um)` so usermods apply new values live (`set.cpp:858`). Whether a given setting takes effect without reboot depends on the usermod.
- Config is then saved to cfg.json (`set.cpp:904`).

Equivalent via JSON: `POST /json/cfg {"um": {"ModName": {...}}}` hits the same `readFromConfig` path (`cfg.cpp:771-772`) with proper JSON types and no hidden-field encoding.

## Replacement notes

PRD scope: usermods are not in MVP (§16 lists Device/LED Hardware/Network/Sync/System). §21 escape hatch to `/settings/um` covers them.

Facts for later work:

- There is no schema. Field types are inferred from current JSON value types; labels are derived from key names; units and option lists exist only as JS snippets emitted by `appendConfigData()`, which a non-browser client cannot use without executing them. A generic renderer can reproduce the stock page's basic form from `/json/cfg.um` but will lack units, dropdown options, and help links.
- Any key containing `pin` is treated as a GPIO; conflicts are resolved against `/json/pins`.
- Global I²C/SPI pins (`SDA`, `SCL`, `MOSI`, `MISO`, `SCLK`) are only settable through this form; they are stored in cfg.json under `hw.if.i2c-pin` / `hw.if.spi-pin`. Changing them needs a reboot.
- Each usermod's `readFromConfig` receives only what was posted. Most usermods keep their current value for a missing key, then `serializeConfig` writes the full set back via `addToConfig`, so omitting fields does not delete them. This is per-usermod behavior, not guaranteed.
- `POST /json/cfg` accepts `"rb": true` to reboot after applying (`cfg.cpp:778`), which covers the `RBT` checkbox case.
