# Claude Design prompt: device setup and settings

Paste everything below the line into Claude Design.

---

Design an interactive prototype for a self-hosted web app that replaces the built-in web UI of WLED, the open-source firmware for ESP8266/ESP32 LED controllers. Build it with React, TypeScript and shadcn/ui (Tailwind). This first round covers adding devices and configuring them. Light control (colors, effects, segments, presets) comes in a later round; leave placeholders for it.

## Product context

- The app runs on a server on the user's home network (Docker) and talks to one or more WLED controllers on the LAN. The browser only ever talks to the app server, never to a controller directly.
- Users reach it at home or remotely through Tailscale or a reverse proxy. It must work well on a phone and on a desktop.
- The stock WLED UI is a dense single page with a separate settings area made of long HTML forms. Every field is visible at once, raw values leak through (GPIO numbers, bitmasks, quarter-dBm power levels), some changes silently need a reboot, and a save can disconnect the device with no feedback. This app should fix those problems.
- Users range from people who flashed one controller for their Christmas lights to people running a dozen controllers on a house. Assume they know what an LED strip and a GPIO pin are, but don't make them do arithmetic.
- Scope rule: if a setting doesn't help someone stop opening the stock WLED UI day to day, leave it out. Anything not covered gets an "Open WLED Advanced UI" escape hatch.

## Design direction

- Calm, modern, utilitarian. It's a home tool used often for a few seconds at a time.
- Mobile-first, single column on phones, roomier on desktop. Dark mode and light mode, both first-class (dark is the likely default for a lighting app).
- No giant navigation. The whole app has about six screen types. Use a device list as home, a device page with a small set of tabs, and settings as a list of sections.
- Use shadcn/ui components throughout: Card, Button, Input, Label, Switch, Select, Slider, Tabs, Dialog, AlertDialog, Sheet, Badge, Tooltip, Progress, Skeleton, Separator, Toggle/ToggleGroup, Form, Sonner toasts. Use lucide-react icons.
- Show units and human values: "5.0 A", "12 min ago", "-52 dBm (Good)", "GPIO 16 (in use by Button 1)". Never show bitmasks or encoded values.
- Make consequences visible before saving: a badge on fields that cause a reconnect or need a reboot, and confirmation for disruptive actions.

## Prototype mechanics

- All data comes from a mock API module (`src/mock/api.ts`) that mirrors the app server endpoints listed below, with in-memory state seeded from fixtures. Add 300-800 ms of simulated latency. Keep every screen talking to this module so it can be swapped for real `fetch` calls later.
- The mock must actually behave: saves change the stored config, rebooting takes the device offline for about 10 s, a Wi-Fi change takes it offline and brings it back (optionally at a new IP), the PIN-locked device rejects saves until unlocked, and the offline device fails every request.
- Add a small floating "Prototype controls" panel (collapsed by default) that lets a reviewer force scenarios: take a device offline or online, make the next Wi-Fi save fail to reconnect, make discovery find nothing, toggle a device's PIN lock.
- Use client-side routing: `/`, `/add`, `/devices/:id`, `/devices/:id/settings`, `/devices/:id/settings/:section`. Routes must be relative-safe (the app may be served behind a reverse proxy).

## App server API (what the mock implements)

The server proxies WLED's own JSON API, so most payloads are WLED-shaped. Field names below are WLED's.

```
GET    /api/devices                       -> Device[]
POST   /api/devices                       { host } -> Device         (probes the host first)
DELETE /api/devices/:id
GET    /api/discovery                     -> DiscoveredDevice[]      (mDNS + UDP broadcast results)
GET    /api/devices/:id/info              -> WledInfo
GET    /api/devices/:id/state             -> WledState              (only on, bri, udpn used this round)
PATCH  /api/devices/:id/state             partial WledState
GET    /api/devices/:id/config            -> WledConfig
PATCH  /api/devices/:id/config            partial WledConfig (one section at a time) -> WledConfig | 401 { error: "pin_required" }
POST   /api/devices/:id/unlock            { pin } -> 200 | 401
GET    /api/devices/:id/capabilities      -> Capabilities           (LED types, chip limits, pin lists)
GET    /api/devices/:id/pins              -> { pins: PinInfo[] }
POST   /api/devices/:id/networks/scan     -> { networks: WifiNetwork[] } (takes 2-4 s)
GET    /api/devices/:id/presets           -> { id: number, name: string }[]  (for the boot preset picker)
POST   /api/devices/:id/reboot
```

### Types

```ts
type Device = {
  id: string;            // app UUID
  name: string;          // mirrors info.name
  host: string;          // "wled-backyard.local" or an IP
  lastIp: string;
  mac: string;           // 12 lowercase hex chars, stable key
  online: boolean;
  lastSeen: string;      // ISO timestamp
  pinLocked: boolean;    // device has a settings PIN and the server hasn't unlocked it
};

type DiscoveredDevice = {
  mac: string; name: string; ip: string; host: string;
  ver: string; ledCount: number; arch: string;
  alreadyAdded: boolean;
};

type WledInfo = {
  ver: string;           // "0.16.0"
  vid: number;           // build number, e.g. 2510180
  name: string;
  mac: string;
  ip: string;
  arch: string;          // "esp32" | "esp8266" | "ESP32-S3" | "ESP32-C3" ...
  clock: number;         // MHz
  flash: number;         // MB
  uptime: number;        // seconds
  freeheap: number;      // bytes
  psram?: number;        // bytes, only on boards with PSRAM
  fs: { u: number; t: number };   // filesystem used/total, kB
  wifi: { rssi: number; signal: number; channel: number; band: string; ap: boolean };
  leds: {
    count: number; fps: number;
    pwr: number;         // estimated current, mA (0 when the limiter is off)
    maxpwr: number;      // limiter budget, mA (0 = off)
    maxseg: number;
  };
  live: boolean;         // receiving realtime data from another source
};

type WledConfig = {
  id: { name: string; mdns: string };           // device name (max 32), hostname (max 32, "" = no mDNS)
  nw: { ins: WifiEntry[] };                     // up to 3 saved networks
  ap: { ssid: string; pskl: number; chan: number; hide: boolean; behav: 0 | 1 | 2 | 3 | 4 };
  def: { on: boolean; bri: number; ps: number }; // power on at boot, boot brightness 1-255, boot preset (0 = none)
  light: { "scale-bri": number };               // global brightness factor %, 1-255
  hw: {
    led: {
      maxpwr: number;    // PSU budget mA, 0 = limiter off; 250-65000 when on
      ins: LedOutput[];
    };
  };
  if: { sync: SyncConfig };
};

type WifiEntry = {
  ssid: string;
  pskl: number;          // stored password length; the password itself is never returned
  ip: [number, number, number, number];   // 0.0.0.0 = DHCP
  gw: [number, number, number, number];
  sn: [number, number, number, number];
};

type LedOutput = {
  type: number;          // id from Capabilities.ledTypes
  pin: number[];         // GPIOs; how many depends on the type
  start: number;         // first LED index; auto = previous output's end
  len: number;           // LED count
  order: number;         // low nibble: 0 GRB, 1 RGB, 2 BRG, 3 RBG, 4 BGR, 5 GBR; high nibble: white swap
  rev: boolean;          // reversed
  skip: number;          // skip first N LEDs, 0-255
  ledma: number;         // mA per LED for the current estimate: 55, 35, 30, 255 (=12 mA, WS2815), 15, or custom
};

type SyncConfig = {
  recv: { bri: boolean; col: boolean; fx: boolean; pal: boolean; seg: boolean; sb: boolean; grp: number };
  send: { en: boolean; dir: boolean; btn: boolean; grp: number };
  // grp values are 8-bit masks of sync groups 1-8. recv.grp === 0 means "not receiving".
};

type Capabilities = {
  ledTypes: { i: number; n: string; t: string; c: number }[];
  // t = pin layout: "D" one data pin, "2P" data + clock, "A".."AAAAA" one PWM pin per A,
  //     "" on/off relay (1 pin), "N" network (not supported here), "H" HUB75 (not supported here)
  // c = capability bits: 0x01 RGB, 0x02 white channel, 0x04 CCT
  limits: { maxLedsPerOutput: number; maxLeds: number; maxDigitalOutputs: number; maxPwmPins: number; ledMemoryBytes: number };
  reservedPins: number[];   // flash/PSRAM pins, never selectable
  inputOnlyPins: number[];
};

type PinInfo = {
  p: number;             // GPIO
  c: number;             // 0x02 analog, 0x08 boot pin, 0x10 strapping pin, 0x20 input-only
  a: boolean;            // allocated
  n?: string;            // owner name when allocated, e.g. "Button", "IR", "Relay"
};

type WifiNetwork = { ssid: string; rssi: number; channel: number; enc: number };
```

### Fixtures

- **Backyard**: online, `arch: "esp32"`, ver 0.16.0, uptime 4 d 12 h, rssi -52, 2.4 GHz channel 6. Two outputs: WS281x RGB (type 22) on GPIO 16, 150 LEDs; WS281x RGB on GPIO 17, 150 LEDs, reversed. Limiter on, 5000 mA, 55 mA/LED. One Wi-Fi network "HomeNet" (DHCP). AP "WLED-AP", behavior 0. Sync: send on, send on direct change, send group 1, receive groups 1, receive brightness and color. GPIO 0 is allocated to "Button". Has 4 presets (Warm White, Halloween, Christmas, Game Day). No PIN.
- **Front Roof**: online, `arch: "esp8266"`, ver 0.15.1, rssi -71. One output: SK6812 RGBW (type 30) on GPIO 2, 300 LEDs. Limiter off. Has a settings PIN, `1234`, and starts locked.
- **Desk Lamp**: offline, last seen 3 hours ago, `arch: "ESP32-C3"`. One output: PWM RGBCCT (type 45) on GPIOs 4, 5, 6, 7, 10.
- **Discovery** returns Backyard and Front Roof (already added) plus "Garage" (192.168.1.57, 0.16.0, 60 LEDs) and "WLED" (192.168.1.88, 0.14.4, 30 LEDs, the factory default name).
- **LED types** (use this list): 22 WS281x RGB (D, 0x01), 30 SK6812/WS2814 RGBW (D, 0x03), 28 FW1906/WS2811 RGBCCT (D, 0x07), 19 WS2811 White (D, 0x02), 21 WS281x WWA (D, 0x06), 50 WS2801 RGB (2P, 0x01), 51 APA102 RGB (2P, 0x01), 40 On/Off (empty t, 0x00), 41 PWM White (A, 0x02), 42 PWM CCT (AA, 0x06), 43 PWM RGB (AAA, 0x01), 44 PWM RGBW (AAAA, 0x03), 45 PWM RGBCCT (AAAAA, 0x07), 80 DDP RGB network (N, 0x01).
- **Limits**: ESP32: 2048 LEDs per output, 16384 total, 16 digital outputs. ESP8266: 2048 per output, 1536 total, 3 digital outputs. ESP32-C3: 2048 per output, 4096 total, 2 digital outputs.
- **Pins**: ESP32 offers GPIO 0-5, 12-19, 21-23, 25-27, 32-39 (34-39 input-only; 0 boot pin; 2 and 12 strapping); reserved 6-11. ESP8266 offers 0-5, 12-16 (0 boot; 2 and 15 strapping).
- **Wi-Fi scan** returns: HomeNet (-48 dBm, ch 6), HomeNet-IoT (-55, ch 11), Neighbor5G (-80, ch 36), xfinitywifi (-77, ch 1), open network "Cafe" (-85, enc 0).

## Screens

### 1. Devices (home, `/`)

The entry point. Keep it simple; light controls get a fuller design next round.

- A card per device: name, host/IP, online status dot ("Online", "Offline · last seen 3 h ago"), and a "Settings locked" lock badge when `pinLocked`.
- On online cards: a power switch (`PATCH state { on }`) and a brightness slider (`bri`, 1-255, shown as %). Tapping the card opens the device page.
- Offline cards are muted, with a Retry action.
- Header: app name and an "Add device" button.
- Empty state (no devices): explain what the app does in one sentence and show a primary "Find devices" button.

### 2. Add device (`/add`)

- On open, run discovery (`GET /api/discovery`). Show a scanning state with skeleton rows, then results as cards: name, IP, version, LED count, chip. Already-added devices appear disabled with an "Added" badge. Devices still named "WLED" get a hint that they can be renamed after adding.
- "Add" on a result calls `POST /api/devices` and returns to the device list with a toast.
- "Scan again" button.
- A manual add section that is always visible below the results: one "Hostname or IP" field. On submit, show a probing state. On success, show the same card as a discovery result with a confirm button. On failure, show an inline error ("No WLED device answered at 192.168.1.90. Check the address and that the device is powered on.").
- No-results state: say discovery only finds devices on the same network as the server and point to manual add.

### 3. Device page (`/devices/:id`)

A header with the device name, online status, and a power switch. Below it, tabs: Control, Segments, Presets, Settings. Control, Segments and Presets are placeholders this round (a card saying "Designed in the next round"). Settings is the focus.

If the device is offline, the page shows an offline banner with Retry and the last-seen time. Settings sections are disabled while offline.

If `info.live` is true, show a banner: "Receiving live data from another source. Changes may not be visible until it stops."

### 4. Settings overview (`/devices/:id/settings`)

A list of sections, each a row with an icon, title and a one-line summary from current data:

| Section | Summary example |
|---|---|
| Device | "Backyard · turns on at boot to 50%" |
| LED Hardware | "2 outputs · 300 LEDs · 5.0 A limit" |
| Network | "HomeNet · 192.168.1.42 · wled-backyard.local" |
| Sync | "Sending to group 1 · receiving from group 1" |
| System | "WLED 0.16.0 · ESP32 · up 4 d 12 h" |
| Advanced | "Open the WLED settings for everything else" |

On desktop, show the section list as a left column with the selected section on the right. On mobile, each section is its own route.

### 5. Settings sections: shared behavior

- Each section is a form loaded from `GET config` (plus other endpoints as listed). Show skeletons while loading.
- Editing makes a sticky save bar appear: "Unsaved changes", Discard, Save. Navigating away with unsaved changes asks for confirmation.
- Save sends only that section's subtree via `PATCH config`. On success: toast and a fresh reload of the section.
- If the response is `401 pin_required`, open the PIN dialog: a 4-digit PIN input (shadcn InputOTP), with the note "Unlocking applies to the whole device for 15 minutes, for anyone on your network." After unlock, retry the save automatically. Wrong PIN shows an inline error; retries are allowed after 3 s.
- Validation is inline, on the field, before Save is enabled.

### 6. Device (`/settings/device`)

- **Device name** (`id.name`, required, max 32 characters). Explain it's also the name other WLED devices and integrations see.
- **When powered on** group:
  - "Turn lights on at boot" (`def.on`, switch).
  - "Boot brightness" (`def.bri`, slider shown as %, 1-255 underneath).
  - "Boot preset" (`def.ps`, select from `GET presets` plus "None" for 0). Disabled with a note when the device has no presets.
- **Remove from this app**: a destructive button at the bottom, confirmed with AlertDialog. The confirmation makes clear that nothing on the device changes.

### 7. LED Hardware (`/settings/led-hardware`)

The most complex screen. The goal is to configure outputs without knowing WLED's internals.

**Summary strip** at the top: total LEDs, number of outputs, estimated current draw (`info.leds.pwr`, shown as "1.8 A now" or "Not measured" when the limiter is off), and a memory usage bar.

Estimate memory per output as `len × channels × 2 + len × 8` bytes, where channels = 3 for RGB + 1 for white + 1 for CCT (from the type's `c` bits). Compare the total against `limits.ledMemoryBytes` (use 87040 for ESP32, 8192 for ESP8266, 102400 for ESP32-C3). The bar is neutral below 60%, amber at 60-90%, red above 90%. Block Save above 100%.

**Outputs list**: one card per `hw.led.ins` entry, collapsed by default, showing type name, pins, LED range ("LEDs 0-149"), and color order. Expand to edit, or edit in a Sheet on mobile. "Add output" and remove per output.

Fields per output:

- **LED type**: Select grouped by kind: "Digital (1 wire)" for `t: "D"`, "Digital (2 wire)" for `"2P"`, "PWM" for `A…`, "On/Off relay" for `""`. Network types are listed but disabled with "Set up in WLED Advanced UI". Disable digital types once `limits.maxDigitalOutputs` digital outputs exist.
- **Pins**: the number of pin pickers follows the type: 1 for D and On/Off, 2 labelled "Data" and "Clock" for 2P, one per channel for PWM labelled with the channel ("Red", "Green", "Blue", "Warm white", "Cold white"). Each picker is a Select over the device's pins (`GET pins`, minus `reservedPins`):
  - Pins in use by something else are disabled and labelled "in use by Button".
  - Pins chosen by another output in this form are disabled and labelled "used by Output 2".
  - Input-only pins are hidden for outputs.
  - Boot and strapping pins are selectable but show a warning icon with tooltip "May stop the board from booting if the strip pulls this pin."
- **LED count** (`len`): number input, 1 to `limits.maxLedsPerOutput`; hidden for PWM and On/Off (always 1). Show a running total against `limits.maxLeds`.
- **Start**: auto-computed as the previous output's end and shown read-only ("Starts at LED 150"). A "Custom start" toggle unlocks it for advanced users.
- **Color order** (`order` low nibble): Select with GRB, RGB, BRG, RBG, BGR, GBR. Show it only for digital types. Add a "Not sure? Set to RGB, light it red; if it shows green, pick GRB" helper.
- **Reversed** (`rev`): switch.
- **Skip first LEDs** (`skip`): number 0-255, under an "Advanced" disclosure in the card.
- **Power per LED** (`ledma`): digital outputs only, shown when the limiter is on. Select with "5 V WS281x (55 mA)", "5 V eco WS2812 (35 mA)", "12 V WS2811 (30 mA)", "WS2815 (12 mA)", "Fairy/seed lights (15 mA)", "Custom" (then a number input, 1-254 mA).

**Power limiter** card:

- "Limit current" switch (on when `hw.led.maxpwr > 0`).
- "Power supply" input in amps (store mA; 0.25-65 A). Show a warning above 7.2 A ("Make sure your wiring and power supply can handle this").
- Show a recommended supply, with "Use recommended". With `total = 100 + Σ(len × mA per LED)` (WS2815's 255 counts as 12 mA), full white needs `ceil(total / 500) / 2` A and typical effects need `ceil(total / 1500) / 2` A.

**Brightness factor** (`light["scale-bri"]`, 1-255 %) under an "Advanced" disclosure.

**Saving** opens a confirmation summarizing the changes ("Output 2: 150 → 200 LEDs, GPIO 17 → GPIO 18") with the warning "Saving re-creates the LED outputs. Segments may be adjusted to fit." No reboot is needed.

### 8. Network (`/settings/network`)

**Current connection** card (read-only, from `info`): IP address, network name, signal ("-52 dBm · Good", plus a bar from `wifi.signal`), band and channel, and "Access point active" if `wifi.ap`.

**Wi-Fi networks** (`nw.ins`, 1-3 entries; the device connects to the strongest one available):

- Each entry has: network name with a "Scan" button that opens a picker of scan results (name, signal bars, channel, lock icon for secured networks), or free text.
- **Password**: if `pskl > 0`, show "Password saved" with a "Change" button that reveals an empty password input; leaving it untouched keeps the existing password.
- **IP address**: segmented "Automatic (DHCP)" / "Static". Static reveals IP, gateway and subnet mask inputs with IPv4 validation; subnet defaults to 255.255.255.0.
- Add network (max 3) and remove. Removing the only network is blocked.

**Hostname** (`id.mdns`): input with a live preview "http://wled-backyard.local". Allow letters, digits and hyphens, max 32. Empty disables mDNS, with a warning that this app may find the device more slowly.

**Access point** card (the network the device creates when it can't connect):

- Name (`ap.ssid`, max 32).
- Password (`pskl` handling as above; empty means open; otherwise 8-63 characters).
- Channel (`ap.chan`, 1-13).
- "Open access point" (`ap.behav`): "When not connected after boot" (0, default), "When disconnected" (1), "Always" (2), "Temporary, closes after 5 min" (4). "Never" (3) is only available under an advanced disclosure, with a strong warning that the device can become unreachable.

**Which changes are disruptive**:

- Changing network name, password, AP name, AP password or AP channel makes the device reconnect immediately. Mark these fields with a "Reconnects" badge.
- Changing static IP settings or hostname only takes effect after a reboot. Mark them "After reboot". If only these changed, the save confirmation offers "Save" and "Save & reboot".

**Saving with a reconnect** goes through a dedicated flow:

1. AlertDialog: "Changing Wi-Fi settings may disconnect this device. If the new settings are wrong, the device opens its own access point (WLED-AP) so you can fix it." Confirm button: "Save & reconnect".
2. Full-section progress state: "Reconnecting to HomeNet-IoT…" with a spinner and elapsed time. The mock polls every 2 s.
3. Success: "Back online at 192.168.1.61", noting when the IP changed.
4. Timeout (45 s): "Backyard hasn't come back." Steps to recover: wait a minute, check the network name and password, or join the device's access point "WLED-AP" and open http://4.3.2.1. Keep the device listed as offline; don't remove it.

### 9. Sync (`/settings/sync`)

Explain at the top in one line: WLED devices on the same network can mirror each other's changes using sync groups.

- **Send** card:
  - "Send changes to other devices" (`send.en`). Make clear this is the default at boot; the quick sync toggle on the control screen only changes it until the next reboot.
  - "When changed from the app or API" (`send.dir`).
  - "When a button or IR remote is used" (`send.btn`).
  - Send groups: 8 toggle chips labelled 1-8 (`send.grp` bitmask). At least one group is required while sending is on.
- **Receive** card:
  - "Receive changes from other devices" switch. Off sets `recv.grp` to 0. Turning it back on restores the previous groups (default group 1).
  - Receive groups: 8 toggle chips (`recv.grp`).
  - "Apply" checkboxes: Brightness (`bri`), Colors (`col`), Effects (`fx`), Palette (`pal`).
  - Advanced: "Apply segment options" (`seg`), "Apply segment bounds" (`sb`).
- A small "Devices in sync" preview listing the other devices in this app that share a group with this one (computed from each device's config), so users can see who mirrors whom.
- Everything here applies immediately; no reboot.

### 10. System (`/settings/system`)

Read-only information from `GET info`, refreshed every 10 s while visible. Uptime counts up live between refreshes.

| Label | Source | Format |
|---|---|---|
| WLED version | `ver`, `vid` | "0.16.0 (build 2510180)" |
| Hardware | `arch`, `clock`, `flash` | "ESP32 · 240 MHz · 4 MB flash" |
| IP address | `ip` | with copy button |
| MAC address | `mac` | formatted "a4:cf:12:34:56:78" |
| Uptime | `uptime` | "4 days, 12 hours" |
| Wi-Fi signal | `wifi.rssi`, `wifi.signal` | "-52 dBm · Good" |
| Free memory | `freeheap`, `psram` | "142 kB" (+ "PSRAM 3.9 MB" if present) |
| Storage | `fs.u`, `fs.t` | Progress bar, "48 / 983 kB" |
| LEDs | `leds.count`, `leds.fps` | "300 LEDs · 42 FPS" |
| Current | `leds.pwr`, `leds.maxpwr` | "1.8 A of 5.0 A" or "Limiter off" |

Actions:

- **Reboot device**: AlertDialog ("Lights will turn off for about 10 seconds"), then an inline "Rebooting…" state that polls until the device answers, then a "Back online" toast.
- **Copy diagnostics**: copies the info table as text, for bug reports.

### 11. Advanced (`/settings/advanced`)

- Explain that some WLED settings aren't available here yet, and list the main ones (time and schedules, buttons and IR remotes, 2D matrices, usermods, MQTT, Home Assistant integrations, firmware updates, security).
- "Open WLED Advanced UI" opens `http://<device ip>/settings` in a new tab.
- Note under the button: "This opens the device directly, so it only works from your home network. Over Tailscale or a remote proxy, WLED may refuse to save changes."

## States to design for every screen

- Loading (skeletons, not spinners on blank pages).
- Offline device (banner, disabled forms, Retry).
- Saving (button spinner; inputs disabled).
- Save failed (toast with the reason; keep the user's edits).
- PIN required (dialog, then automatic retry).
- Phone width (375 px) and desktop (1280 px+).
- Dark and light mode.

## Out of scope for this round

Light control, effects, palettes, segments and presets UI; scheduled presets; buttons, IR, relay; 2D matrix setup; network LED outputs; firmware updates; backups; user accounts. Don't add navigation entries for them beyond the placeholder tabs.
