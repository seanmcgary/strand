# WLED Stock UI Audit

An audit of the web UI embedded in WLED firmware (`wled00/data/`) and the device API behind it. It records what the replacement described in [`../mvp-prd.md`](../mvp-prd.md) is replacing, and what the server has to deal with when it talks to devices.

Source audited: WLED repo at commit `3cdb5108`, version `17.0.0-dev`. Citations look like `wled00/data/index.js:123` or `wled00/json.cpp:456` and are relative to the WLED repo root. Line numbers will drift as WLED changes. The PRD mentions 0.16.x; the API surface used here also exists in 0.15/0.16 but has not been checked line by line against those releases.

## Index

### Device API (what the server talks to)
| File | Covers |
|---|---|
| [api/json-state.md](api/json-state.md) | `GET`/`POST /json/state`: every top-level and segment key, value syntax (`"t"`, `~`, `r`, `i` arrays), preset/playlist commands, errors |
| [api/json-info-and-lists.md](api/json-info-and-lists.md) | `/json/info`, `/json/si`, effects, fxdata, palettes, palx paging, nodes, net, pins, live |
| [api/websocket.md](api/websocket.md) | `/ws`: client limits, broadcast timing, message types, liveview binary format |
| [api/other-endpoints.md](api/other-endpoints.md) | `presets.json`, `/json/cfg` GET/POST, upload/edit, reset, `/win`, `s.js`, settings POSTs, OTA |
| [api/discovery.md](api/discovery.md) | mDNS service and TXT records, UDP node broadcast, `/json/nodes` |
| [api/limits-and-gotchas.md](api/limits-and-gotchas.md) | Request limits, JSON buffer lock, per-chip limits, surprising behaviors, build-flag differences |

### Main control page (`index.htm` / `index.js`)
| File | Covers |
|---|---|
| [main-ui/overview.md](main-ui/overview.md) | Layout, tabs, PC/simplified modes, themes, localStorage prefs |
| [main-ui/data-flow.md](main-ui/data-flow.md) | Load sequence, WebSocket handling, outgoing payload shapes, error codes |
| [main-ui/power-brightness-color.md](main-ui/power-brightness-color.md) | Power, brightness, nightlight, sync toggles, transition, color picker and color slots |
| [main-ui/effects-palettes.md](main-ui/effects-palettes.md) | Effect list, fxdata metadata grammar, effect parameters, palettes, palette previews |
| [main-ui/segments.md](main-ui/segments.md) | Every segment field, selection semantics, create/delete/reset, validation |
| [main-ui/presets-playlists.md](main-ui/presets-playlists.md) | Preset list/run/save/rename/delete, quick load, playlist editor |
| [main-ui/info-nodes-liveview.md](main-ui/info-nodes-liveview.md) | Info panel, reboot/update, Nodes panel, Peek/liveview |

### Settings pages (`settings_*.htm`)
| File | Covers |
|---|---|
| [settings/mechanism.md](settings/mechanism.md) | How pages load (`s.js?p=N`) and save (form POST → `set.cpp`), subpage map, PIN, reboot rules, `/json/cfg` comparison |
| [settings/led-hardware.md](settings/led-hardware.md) | LED outputs/buses, current limiting, buttons, IR, relay, defaults, transitions, white management |
| [settings/2d.md](settings/2d.md) | Matrix panels and the layout generator |
| [settings/wifi-network.md](settings/wifi-network.md) | Wi-Fi networks, static IP, mDNS, AP, Ethernet, ESP-NOW |
| [settings/sync-interfaces.md](settings/sync-interfaces.md) | UDP sync, realtime protocols, MQTT, Hue, Alexa, serial |
| [settings/time-macros.md](settings/time-macros.md) | NTP, timezone, scheduled presets, button macros |
| [settings/ui.md](settings/ui.md) | Server-side name and client-side UI prefs |
| [settings/security-backup.md](settings/security-backup.md) | PIN, OTA lock, backup/restore, factory reset |
| [settings/usermods.md](settings/usermods.md) | Dynamic usermod settings rendering |
| [settings/dmx.md](settings/dmx.md) | DMX output and map |
| [settings/firmware-update.md](settings/firmware-update.md) | OTA upload and version checks |
| [settings/pins.md](settings/pins.md) | PIN entry page and GPIO pin info |

### Other pages and tooling
| File | Covers |
|---|---|
| [tools/file-editor.md](tools/file-editor.md) | `/edit` file manager, `/upload` |
| [tools/palette-editor.md](tools/palette-editor.md) | Custom palette editor (`cpal.htm`), palette file format |
| [tools/pixel-art-tools.md](tools/pixel-art-tools.md) | PixelForge, pixart, pxmagic |
| [tools/liveview.md](tools/liveview.md) | Liveview pages and frame format |
| [misc-pages.md](misc-pages.md) | Welcome, 404, message page, usermod page, icons, shared styles |
| [build-and-serving.md](build-and-serving.md) | `cdata.js` embedding pipeline and the firmware route table |

## MVP coverage map

The PRD's acceptance criteria (§28), mapped to the WLED mechanism behind each one and the doc that describes it.

| # | Criterion | WLED mechanism | Docs |
|---|---|---|---|
| 2 | Discover a controller | mDNS `_wled._tcp`; UDP node broadcast on port 65506; `/json/nodes` from a known device | api/discovery.md |
| 3 | Manual add | `GET /json/info` on the host to confirm and identify it | api/json-info-and-lists.md |
| 4 | Online status | WebSocket connection with app-level ping (the device sends no keepalive) | api/websocket.md |
| 5–6 | Power, brightness | `on`, `bri` (`"t"` toggle, `~` relative) | api/json-state.md, main-ui/power-brightness-color.md |
| 7 | Color | `seg[].col` (3 slots), `seg[].cct`; controls depend on `seg.lc` capability bits | main-ui/power-brightness-color.md |
| 8 | Effect | `seg[].fx` + `sx/ix/c1–c3/o1–o3`, labels from `/json/fxdata` | main-ui/effects-palettes.md |
| 9 | Palette | `seg[].pal`, previews from `/json/palx` | main-ui/effects-palettes.md |
| 10–12 | Segments: view, CRUD, visual ranges | `seg[]` with `id`, `start`/`stop`, `n`; delete with `stop:0` | main-ui/segments.md, api/json-state.md |
| 13 | Flash segment boundaries | No stock feature. Can be built with the `seg.i` per-LED command, but that freezes the segment, so the previous state must be restored | main-ui/segments.md, api/json-state.md |
| 14 | Run preset | `ps` | main-ui/presets-playlists.md |
| 15 | Save preset | `psave` with `ib`/`sb`/`n`/`ql` | main-ui/presets-playlists.md |
| — | Rename/delete preset (PRD §15) | No rename command: re-save with the new name (which applies the preset). Delete with `pdel` | main-ui/presets-playlists.md |
| 16 | LED hardware config | `GET`/`POST /json/cfg` `hw.led`; type list and chip limits only exist in `/settings/s.js?p=2` | settings/led-hardware.md, settings/mechanism.md |
| 17 | Network config | `/json/cfg` `nw`/`id`/`ap`, but JSON saves don't trigger a reconnect; form POST to `/settings/wifi` does | settings/wifi-network.md |
| 18 | Sync config | `/json/cfg` `if.sync` | settings/sync-interfaces.md |
| 19 | System info | `/json/info` (`ver`, `arch`, `uptime`, `ip`, `wifi.rssi`, `freeheap`) | main-ui/info-nodes-liveview.md, api/json-info-and-lists.md |
| 20 | Reboot | `{"rb":true}` on `/json/state`, or `GET /reset` | api/json-state.md |
| 21 | Advanced UI escape hatch | Link to `http://<device>/settings` | settings/mechanism.md |
| 22 | Works behind a reverse proxy | Server-side only, but see the source-IP restriction below | api/limits-and-gotchas.md |

Stock features the PRD defers, documented for completeness: playlists, nightlight, liveview/peek, Nodes panel, 2D matrix setup, time/schedules, usermods, DMX, security/backup, firmware update, file editor, custom palette editor, pixel-art tools.

The PRD asks for things the stock UI doesn't have: effect favorites (stored in our app, keyed by effect name and not ID, because IDs shift between builds), Flash Start/End, a visual segment designer, and the System screen's IP field (the stock Info panel never shows `info.ip`).

## Findings that affect the server design

Each one is explained, with citations, in the linked file.

1. **Per-device concurrency is low.** About 6 queued HTTP requests per device; beyond that the device returns 503 or drops the connection. HTTP, WebSocket and preset/config work all share one JSON buffer, and a busy buffer turns a WebSocket broadcast into `{"error":3}`. Send requests to each device one or two at a time. (api/limits-and-gotchas.md)
2. **WebSocket client slots are limited and get evicted.** 3 clients on ESP8266, 8 on ESP32, with the oldest dropped. Stock UI tabs can push the server off. Broadcasts are coalesced to about one per second, and the server must ping. Only one client can receive liveview. (api/websocket.md)
3. **Settings form POSTs and OTA check the source IP** against private ranges or the device subnet. Tailscale (100.64/10) and non-NATed Docker bridge addresses are rejected. This also affects the PRD §21 escape hatch for remote users. (settings/mechanism.md, settings/security-backup.md)
4. **Both settings write paths are lossy.** A form POST overwrites the whole page, so missing fields become 0 or false. A partial `/json/cfg` write resets some omitted fields (FPS, auto-white, gamma, button macros, static IP). Always write complete subtrees. Units differ between the two paths. (settings/mechanism.md, settings/led-hardware.md)
5. **The PIN unlock is global.** A `"pin"` key in any JSON POST, or a `PIN` form field, unlocks the device for every client for up to 15 minutes. Lock it again with `/settings/lock` after writing. Reads of `/json/cfg`, `/cfg.json` and `/presets.json` are never PIN-gated. (settings/security-backup.md, api/other-endpoints.md)
6. **Segment writes have traps.** A `seg` object without an `id` applies to selected segments only. Changing bounds without `n` erases the segment name. Segment IDs can have gaps. Effects like Image and Scrolling Text read their content from the segment name. (main-ui/segments.md, api/json-state.md)
7. **Preset writes run the preset.** `psave` with state content applies it while saving. Saving a playlist starts it. Writes are asynchronous, so reading `presets.json` right after a save can return stale data. (main-ui/presets-playlists.md)
8. **The request helper adds keys to every request.** It attaches `time` and `transition` to every request. `time` overrides NTP when it differs by 60 s or more. The replacement should not copy this. (main-ui/data-flow.md)
9. **Discovery requires host networking.** mDNS and the UDP node broadcast don't reach a Docker bridge network. The PRD's `network_mode: host` is required, not optional. (api/discovery.md)

## Open questions for planning

- **Wi-Fi write path.** `/json/cfg` (safer partial writes, no reconnect until reboot) or a form POST to `/settings/wifi` (reconnects immediately, but you must send every field and every network row).
- **LED type list.** Fetching the type list and chip limits means parsing `/settings/s.js?p=2`, which is JavaScript. The options are to parse it, run it in a sandbox, or keep a per-version table.
- **WebSocket priority.** How the server should behave when stock UI tabs evict its WebSocket.
