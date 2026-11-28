# App server design

Date: 2026-10-23
Status: draft, waiting for approval

## 1. Intent

better-wled ("Strand for WLED") replaces the web UI that ships on WLED controllers (see `docs/mvp-prd.md`). The browser must never talk to a WLED device directly (PRD §4). One server sits between the browser and the devices. This document specifies that server.

The server is thin. It does four things:

1. It serves the built frontend.
2. It keeps the saved devices, scenes and looks in SQLite.
3. It finds WLED devices on the local network.
4. It sends each browser request to the correct device and returns the result.

The server keeps no state that must survive a restart. It may hold short timers in memory: the 3-second LED flash and the 5-second startup-preset write (Lights and Presets design §6.6, §6.7). A restart loses at most one pending startup write. It does not hold connections to devices. It does not queue requests. Apart from those timers, every API request is complete in itself.

## 2. Sources of truth

- `docs/design/strand-wled-spec.html` is the source of truth for the UI and for the API contract. Its "MOCK APP SERVER" block (the `api` object and its comment) lists every endpoint, the response shapes, and the error codes. Open the file in a browser to use the prototype.
- This document says how the real server implements that contract with the WLED JSON API. Where this document and the design differ, section 12 lists each difference and the reason.
- The Lights and Presets design (`docs/superpowers/specs/2026-11-23-lights-presets-design.md`) designs the Lights and Presets tabs. It changes some rules of this document: sections 3, 4, 7, 8.3 and 8.4 show the changes.
- `docs/wled-ui-audit/` describes the WLED device API.
- `docs/design/claude-design-prompt-settings.md` is the prompt that produced the design. It is history, not a source of truth.

## 3. Decisions the owner made

- The server is the Fastify serving tier of the template frontend in `~/Code/app-template/frontend`. There is no Go service and no separate backend process.
- Take only the frontend from the template. Remove the template parts that this app does not use (section 5).
- The browser renders all pages. There is no server-side rendering.
- The server keeps no state that must survive a restart. It may hold short in-memory timers (section 1). There is no per-device client object, no request queue, and no connection pool that the server manages.
- There is no WebSocket, between the server and a device or between the browser and the server. This replaces the WebSocket in PRD §22 on purpose. The browser does not poll lighting state. Changes that other clients (for example, Home Assistant) make are not tracked (Lights and Presets design, decision 12).
- The browser never builds or sends WLED JSON. The Lights API speaks the strand model, and the server alone translates it to WLED segments (Lights and Presets design §9).
- SQLite stores the device list.
- The server writes settings only through the WLED JSON API. It does not use the settings form POSTs (`/settings/<page>`). It reads `/settings/s.js?p=N` only where the JSON API has no equivalent (section 8.3).
- The server supports WLED 0.15 and later.
- The app does not remove saved Wi-Fi networks, because the JSON API cannot (section 12).

## 4. Goals, non-goals, anti-goals

### Goals

- Implement every endpoint in the design's API contract (section 8), with the behavior that the design's mock shows.
- Run as one Node process in one Docker image, with `network_mode: host` and a data volume at `/data` (PRD §5).
- Work behind a reverse proxy or Tailscale that serves the app at the root path of a host name (PRD §28 item 22).
- Also serve the control endpoints that the PRD needs and that the design leaves for a later round: effects and palettes (section 8.4).

### Non-goals

- Frontend screens. The frontend is a separate piece of work that builds the design. This work delivers the scaffold, the shared types, an API client, and a placeholder home screen.
- Everything in PRD §3 and §29.
- Palette preview colors (`/json/palx`).
- Hosting the app under a sub-path (for example, `https://host/wled/`). This is my call.
- WLED versions earlier than 0.15. `POST /api/devices` still accepts these devices, but the settings endpoints can return errors for them.

### Anti-goals

The work fails, even if it runs, if any of these is true:

- The server holds a connection, a queue, or state that must survive a restart, in memory. The flash and startup-write timers (section 1) are the only exceptions.
- The server stores live lighting state, effects, palettes, or segments in the database. Saved scenes and looks, and strand combinations, are in the database (section 7).
- The server adds keys to a state write that change what the device does. The one added key is `"v": true`, which only makes the device return its full state (section 8.4). The server never adds `time` or `transition` (`docs/wled-ui-audit/main-ui/data-flow.md`).
- A config write sends a partial subtree to the device and so resets fields that the user did not change (`docs/wled-ui-audit/settings/mechanism.md`).
- The server sends data to a third party (analytics, telemetry).

## 5. What to take from the template

Copy `~/Code/app-template/frontend` to the root of this repository as one package. There is no pnpm workspace with more than one member.

Keep:

- Vite, React 19, TypeScript, Tailwind v4, shadcn/ui, Storybook, vitest, and the ESLint config.
- Redux Toolkit with recompose, and the rule that only `src/lib/withRouter.tsx` uses React hooks.
- The no-`NODE_ENV` rule, camelCase file names, and `tsc --noEmit` as the type gate.
- Fastify 5 with `@fastify/static`, and `server/config.ts` that reads environment variables.

Remove:

- Server-side rendering: `src/entryServer.tsx`, the SSR build input, `ssrEntryPath`, and the render code in `server/server.ts`.
- The session cookie, `@fastify/cookie`, `server/cookies.ts`, `server/session.ts`, the auth tests, and the route guards in `src/components/guards/`.
- The `/v1` proxy (`server/proxy.ts`, `@fastify/http-proxy`) and `backendUrl`.
- `server/sitemap.ts`, `server/robots.ts`, `server/routeHead.ts`, and their tests.
- All analytics: `posthog-js`, `src/lib/analyticsConfig.ts`, and the analytics part of `server/config.ts`.
- The CDN asset base (`ASSET_BASE_URL`, `server/assetUrl.ts`).
- The mobile app, the email service, the Helm chart, and the Kubernetes CI.

Replace `packages/core`:

- Move the parts the frontend still uses (the Redux store setup, `createApiThunk`, `withActions`, `reactCompat`) into `src/`.
- Delete the generated gRPC-gateway client. A hand-written API client in `src/api/` replaces it. It has one function for each function of the design's mock `api` object, with the same names.
- Put the request and response types in `shared/apiTypes.ts`. The server and the browser both import this file. It is the one source for the API contract in code.

Take the design tokens (the shadcn CSS variables and the `success`, `warning`, `danger` and `glow` colors) from the design file into `src/index.css`, so that the frontend work starts from them.

The template's comments name lawndominator and the app-template. Rename the package to `strand` and remove those names.

## 6. Process and configuration

`server/config.ts` reads these environment variables. Each has a default, so the process starts with an empty environment.

| Variable | Default | Use |
|---|---|---|
| `PORT` | `3000` | The HTTP port. The server listens on `0.0.0.0`. |
| `DATA_DIR` | `./data` (the Docker image sets `/data`) | The directory for the SQLite file `strand.db`. |
| `WEB_DIST_DIR` | `dist` beside `dist-server` | The built frontend. |
| `DEVICE_TIMEOUT_MS` | `3000` | The timeout for one request to a device. |
| `DISCOVERY_WINDOW_MS` | `2500` | How long one discovery request listens for mDNS replies. |

The server serves:

- `/api/*`: the endpoints in section 8. Each response has `Cache-Control: no-store`.
- Static files from the built frontend.
- `index.html` for every other `GET` path that does not match a file, so that browser routes such as `/devices/abc/settings/network` load the app.

## 7. Data model

SQLite, through `node:sqlite` (built into Node 24). This is my call. It needs no native build step, so the pnpm `strictDepBuilds` setting needs no change.

Migrations are an ordered list of SQL strings in `server/db/migrations.ts`. On start, the server reads `PRAGMA user_version`, applies each newer migration in one transaction, and sets `user_version`.

```sql
CREATE TABLE devices (
  id              TEXT PRIMARY KEY,      -- UUID v4
  mac             TEXT NOT NULL UNIQUE,  -- 12 lowercase hex characters, from info.mac
  name            TEXT NOT NULL,         -- copy of info.name
  host            TEXT NOT NULL,         -- what the user typed, or the mDNS host name
  last_ip         TEXT NOT NULL,
  last_seen       TEXT,                  -- ISO 8601; NULL until the first successful contact
  pending_reboot  TEXT,                  -- JSON array, for example ["hostname"]; NULL when nothing waits
  pending_since   TEXT,                  -- ISO 8601 time of the write that set pending_reboot
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE preferences (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,         -- JSON
  updated_at  TEXT NOT NULL
);
```

- The MAC is the identity of a device. An IP address and a host name can change, but the MAC does not.
- `name`, `last_ip`, and `last_seen` change when the server gets a good `/json/info` reply from the device. Any endpoint that reads `/json/info` makes this update.
- `pending_reboot` and `pending_since` are described in section 8.3.
- The `preferences` table holds UI preferences, for example effect favorites. Effect favorites use effect names, not effect IDs, because IDs change between WLED builds (`docs/wled-ui-audit/README.md`).
- Strand names are preferences (`strandNames.<deviceId>`). The server writes them through `PUT /api/devices/:id/strand-names`, so it can use them in segment names.
- A later migration adds the tables `scenes`, `looks` and `strand_groups` (Lights and Presets design §8). Scenes and looks are Strand's presets.

## 8. API

All bodies are JSON. The types are in `shared/apiTypes.ts`. Their names and fields are the ones in the design's mock (`Device`, `DiscoveredDevice`, `WledInfo`, `WledConfig`, `Capabilities`, `PinInfo`, `WifiNetwork`).

### 8.1 Errors

Every error body is `{ "error": "<code>", "message": "<text for a person>" }`. The design shows `message` to the user, so it must be a complete sentence that names the device where possible. The codes:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | The body or a parameter is not valid. |
| 401 | `pin_required` | The device has a PIN and is locked. |
| 401 | `wrong_pin` | The unlock PIN is wrong. |
| 404 | `not_found` | No saved device has this `:id`, or the `/api` path does not exist. |
| 404 | `no_device` | Probe or add: nothing at the host gave a valid WLED reply. |
| 409 | `already_added` | Add: a saved device has the same MAC. |
| 422 | `unsupported_change` | Config write: the JSON API cannot make the change (section 8.3). |
| 502 | `device_error` | The device replied with an error (see section 9.2). |
| 503 | `device_busy` | The device refused the connection because it was busy. Has `Retry-After: 1`. |
| 504 | `device_offline` | The device did not reply. |

### 8.2 Devices and discovery

| Method and path | Device requests | Result |
|---|---|---|
| `GET /api/devices` | For each saved device, at the same time: `GET /json/info` and the lock check | `Device[]` |
| `POST /api/devices/probe` `{ host }` | `GET /json/info` to `host` | `DiscoveredDevice` |
| `POST /api/devices` `{ host }` | the same probe | `201 Device` |
| `DELETE /api/devices/:id` | none | `204` |
| `GET /api/discovery` | section 8.2.2 | `DiscoveredDevice[]` |

`Device` is `{ id, name, host, lastIp, mac, online, lastSeen, pinLocked }`.

- `online` is true when the `/json/info` request in this API request succeeded.
- `lastSeen` is the current time when `online` is true. Otherwise it is `last_seen` from the database.
- `pinLocked` comes from the lock check: a `GET` to a small PIN-gated settings script (`/settings/s.js?p=N`). A `401` means locked. When the device is offline, `pinLocked` is `false`.
- `GET /api/devices` waits at most `DEVICE_TIMEOUT_MS` for each device. A device that does not reply is `online: false`. The list still returns.

#### 8.2.1 Probe and add

- `host` can be a host name, an IPv4 address, or an IPv4 address with a port. The server removes a leading `http://` or `https://`, removes any path, and converts the value to lowercase, as the design's mock does. An empty value gets `400 invalid_request`.
- A bare name with no dot (for example, `wled-backyard`) also tries `<name>.local`.
- The reply must be a WLED `/json/info` object with `brand: "WLED"`, a `mac`, and a `ver`. If there is no such reply, return `404 no_device`.
- `alreadyAdded` in the probe result is true when a saved device has the same MAC.
- Add does the probe, returns `409 already_added` if the MAC is saved, and otherwise saves the device with `last_ip` from `info.ip`.

#### 8.2.2 Discovery

In one request, the server does these steps:

1. Browse mDNS for `_wled._tcp` for `DISCOVERY_WINDOW_MS`.
2. At the same time, send `GET /json/nodes` to every saved device. This finds devices that do not answer mDNS (`docs/wled-ui-audit/api/discovery.md`).
3. Send `GET /json/info` to every IP address that steps 1 and 2 found, at the same time.
4. Drop every address that does not give a valid WLED reply. Merge the results by MAC.
5. Set `alreadyAdded` from the `devices` table. Set `host` to the mDNS name (`<mdns>.local`) when the device has one, and to the IP address when it does not.
6. For each saved device that replied, update `last_ip`. A device that got a new DHCP address recovers in this way.

The server does not listen on the UDP port 65506. Devices send that broadcast on their own schedule, so a listener that runs only during one request misses most of them. This is my call.

mDNS needs the host network. The Docker setup in section 10 uses `network_mode: host`.

### 8.3 Settings

Each endpoint below loads the device by `:id`. If there is no such device, it returns `404 not_found`. Section 9 describes how the server reaches the device.

| Method and path | Device requests | Result |
|---|---|---|
| `GET /api/devices/:id/info` | `GET /json/info` | `WledInfo` |
| `GET /api/devices/:id/config` | `GET /json/cfg` | `WledConfig` |
| `PATCH /api/devices/:id/config` | `GET /json/cfg`, `POST /json/cfg`, `GET /json/cfg`, and maybe a reboot | `WledConfig` |
| `POST /api/devices/:id/unlock` `{ pin }` | `POST /json/state`, then the lock check | `204` |
| `GET /api/devices/:id/capabilities` | `GET /settings/s.js?p=2` | `Capabilities` |
| `GET /api/devices/:id/pins` | `GET /json/pins` | `{ pins: PinInfo[] }` |
| `POST /api/devices/:id/networks/scan` | `GET /json/net`, repeated | `{ networks: WifiNetwork[] }` |
| `POST /api/devices/:id/reboot` | `POST /json/state` `{"rb":true}` | `204` |
| `GET /api/devices/:id/pending-reboot` | `GET /json/info` when a change is pending | `string[]` |

**Info.** Return the fields of `WledInfo` from `/json/info`. Include `wifi.ssid` when the device reports it.

**Config read.** Return the subtrees that `WledConfig` names: `id`, `nw`, `ap`, `def` (only `on` and `bri`), `light`, `hw.led`, and `if.sync`. The device never returns a password. It returns `pskl`, the password length.

**Config write.** The body is a partial `WledConfig` that changes one section. A `def` object may hold only `on` and `bri`. Any other `def` key gets `400 invalid_request`. The boot preset (`def.ps`) belongs to Strand's startup preset (Lights and Presets design §6.7), so Settings has no boot preset field. The server does these steps:

1. Read the current `/json/cfg`.
2. Check the body against the limits of the JSON API. Return `422 unsupported_change` if either is true:
   - `nw.ins` has fewer entries than the device has now. The firmware does not shrink its network list (`wled00/cfg.cpp:89`), and it ignores an empty SSID (`:106`).
   - An `nw.ins` entry has `psk: ""` and the current entry has `pskl > 0`. The firmware ignores an empty client password (`:107`). An empty `ap.psk` is valid: it makes the access point open (`:144`).
3. Deep-merge the body into the current config. An array in the body replaces the array in the config. For example, `hw.led.ins` replaces the whole output list.
4. Send one `POST /json/cfg`. Its body contains, for each top-level key that the request body touches (`id`, `nw`, `ap`, `def`, `light`, `hw`, `if`), the complete merged top-level subtree. Example: a change to `hw.led.maxpwr` sends all of `hw`, including `hw.btn`, `hw.ir` and `hw.relay` with their current values. The firmware resets fields that a write leaves out (`docs/wled-ui-audit/settings/mechanism.md`). Sending current values again does not change them. The body also carries the device's current `hw.led.rgbwm`, `hw.led.fps` and `light.gc.bri`, `light.gc.col` and `light.gc.val`, even when the request touches neither `hw` nor `light`, because `deserializeConfig` resets them when they are missing (`wled00/cfg.cpp:183`, `:189`, `:531-532`); and it carries `hw.led.ins` only when the request sets it, because `ins` re-initialises the buses. One POST means a failure cannot leave the device with only part of the write.
5. If the device returns `401`, return `401 pin_required`.
6. Read `/json/cfg` again. This is the result.
7. Find the changes that need a restart, with the rules of the design's mock:
   - **Reconnect changes** (`wifiChanged` in the mock): the list of `nw.ins` SSIDs changed, any `nw.ins` entry has a `psk`, or `ap.ssid`, `ap.psk` or `ap.chan` changed.
   - **Reboot changes** (`getPendingReboot` in the mock): `id.mdns` changed (`"hostname"`), or the static IP, gateway or subnet of an `nw.ins` entry changed (`"static IP"`).
8. If there is a reconnect change, send `{"rb":true}` to `/json/state` after the write. A JSON config write does not make the device reconnect, so a reboot does it. The reboot also applies any reboot change, so clear `pending_reboot`. The design then shows its reconnect screen and polls `/info` until the device answers.
9. Else, if there is a reboot change, add its names to `pending_reboot` and set `pending_since` to now.
10. Return the config from step 6.

**Pending reboot.** If `pending_reboot` is empty, return `[]` with no device request. Otherwise, read `/json/info`. If `info.uptime` shows that the device started after `pending_since`, clear `pending_reboot` and return `[]`. Otherwise, return `pending_reboot`. If the device is offline, return `pending_reboot` with no change. A reboot through `POST /reboot` also clears `pending_reboot`.

**Unlock.** The server sends `{"pin":"<pin>"}` to `/json/state`, then does the lock check. A `401` from the lock check returns `401 wrong_pin`. If the device has no PIN, unlock succeeds. The device stays unlocked for 15 minutes for every client on the network (`docs/wled-ui-audit/settings/security-backup.md`). The server does not store the PIN. The server does not lock the device again after a write, because the design tells the user "unlocked for 15 minutes". WLED ignores a second PIN attempt within 3 seconds of a wrong one. The design's PIN dialog must not allow a retry in that time.

**Capabilities.** Parse the JavaScript text that `s.js?p=2` returns with regular expressions. Do not run the text. Extract `d.ledTypes`, the `bLimits(...)` arguments, `d.rsvd`, and `d.ro_gpio` (`docs/wled-ui-audit/settings/led-hardware.md`). Map them to the design's `Capabilities` type. If the device returns `401`, return `401 pin_required`. If a value is missing, return `502 device_error` with a message that says the firmware version is not supported. Do not return defaults.

**Network scan.** The first `/json/net` request starts a scan and returns an empty list. Request it again once a second, at most 10 times, until the list has entries (`docs/wled-ui-audit/settings/wifi-network.md`). If the list is still empty, return the empty list.

**Presets.** There is no WLED presets endpoint. WLED presets are not a user feature (Lights and Presets design §3).

**Reboot.** Return `204` when the device accepts the request. The device then goes offline for about 10 seconds. The design polls `/info` until the device answers.

### 8.4 Control

These endpoints serve the page header switch, the dashboard card, and the effect and palette lists. All other lighting changes use the Lights API and the scene and look endpoints (Lights and Presets design §9).

| Method and path | Device requests | Result |
|---|---|---|
| `GET /api/devices/:id/state` | `GET /json/state` | the WLED state object, unchanged |
| `PATCH /api/devices/:id/state` `{ on?, bri? }` | `POST /json/state` with the body plus `"v": true` | the WLED state object |
| `GET /api/devices/:id/effects` | `GET /json/effects` and `GET /json/fxdata` | `{ id, name, meta }[]` |
| `GET /api/devices/:id/palettes` | `GET /json/palettes` | `{ id, name }[]` |

- **State write.** The body is `{ on?, bri? }`: `on` is a boolean, and `bri` is an integer from 0 to 255. The body must have at least one of them. The server rejects any other key, and any other body, with `400 invalid_request`. It adds `"v": true`, so that the device returns its full state, which the design caches. It makes no other change. Segments, slots, paint, the LED flash, scenes and looks do not use this endpoint. They use the Lights API and the scene and look endpoints (Lights and Presets design §9).
- **Effects.** Join the two lists by index. Drop the entries named `RSVD`. `meta` is the `fxdata` string for that effect.

### 8.5 Preferences

| Method and path | Result |
|---|---|
| `GET /api/preferences` | an object of all keys and values |
| `PUT /api/preferences/:key` `{ value }` | `204` |

Keys match `^[a-zA-Z0-9._-]{1,64}$`. The value is any JSON value, at most 64 KB when serialized. The design's theme setting (light, dark, system) stays in browser storage, as the design has it. This is my call.

## 9. Requests to devices

Every device request uses `fetch` with an `AbortSignal` timeout of `DEVICE_TIMEOUT_MS`. The scan endpoint uses its own limit (section 8.3).

### 9.1 How the server finds the address

The Docker image has no mDNS name resolver, so the operating system cannot resolve a `.local` name. The server uses `last_ip` for each request:

1. Send the request to `last_ip`.
2. If the connection fails (refused, no route, or timeout), and `host` is a `.local` name, send one mDNS query for the A record of `host` (1 second limit).
3. If the query returns a different address, check it with `GET /json/info`. If the MAC matches, save the new `last_ip` and send the original request again, one time.
4. Otherwise, return `504 device_offline`.

This is how the app finds a device after a Wi-Fi change gives it a new address. The probe uses the same mDNS lookup when the user types a `.local` name.

### 9.2 Device results

| Device result | API result |
|---|---|
| Timeout or connection failure | `504 device_offline` |
| `503`, or the connection closes with no reply | `503 device_busy`, with `Retry-After: 1` |
| `401` | `401 pin_required` |
| `200` with `{"error":<n>}` in the body | `502 device_error`, and the message includes the code |
| Any other non-2xx | `502 device_error` |
| A body that is not JSON where the server expects JSON | `502 device_error` |

A device accepts about 6 requests at the same time. More requests get a `503` (`docs/wled-ui-audit/api/limits-and-gotchas.md`). The server does not prevent this. The browser treats `device_busy` as a temporary error, and the user can try again.

## 10. Docker

- A multi-stage `Dockerfile` with a `node:24` build stage and a `node:24-slim` runtime stage.
- The runtime stage runs as the `node` user, sets `DATA_DIR=/data`, and declares `/data` as a volume.
- A `docker-compose.yml` at the repository root, the same as PRD §5.

## 11. Tests

- Each endpoint has vitest tests that use `fastify.inject`.
- A fake WLED device is a small Fastify instance on a random port. Its fixtures come from the design's `SEEDS`. Tests can tell it to time out, to return `503`, to be locked with a PIN, or to restart.
- Discovery tests replace the mDNS browser with a test double.
- The config-write tests prove these behaviors:
  - The server sends complete top-level subtrees in one POST. Example: a body that changes only `hw.led.maxpwr` causes exactly one `POST /json/cfg` that contains the full `hw` object.
  - A reconnect change causes a reboot request.
  - A hostname change sets `pending_reboot`, and a later restart of the device clears it.
  - A shorter `nw.ins` list and an empty client `psk` return `422 unsupported_change`.
- The state-write test proves that the server adds only `"v": true`, and rejects every key other than `on` and `bri`.
- Fixtures and `s.js?p=2` samples cover WLED 0.15, 0.16 and 17.0.0-dev.
- Each SQLite test uses its own temporary database.

## 12. Differences from the design, and my calls

Differences from `docs/design/strand-wled-spec.html`:

1. **No removal of saved Wi-Fi networks.** The owner decided this. The JSON API cannot remove a network (section 8.3). The Network screen must not show a remove action for a saved network, and the server returns `422 unsupported_change` if a body tries.
2. **No clearing of a saved client password.** The same firmware limit. The server returns `422 unsupported_change`.
3. **Reconnect is a reboot.** The design's mock makes the device drop off Wi-Fi and rejoin. The real server reboots the device. The user sees the same thing: the device is offline for some seconds and then answers.
4. **`pending-reboot` uses the database.** The mock compares the config with the config at boot. The real device does not report its boot config, so the server records pending changes when it writes them. A change that another client makes does not show the banner.
5. **Effects, palettes, state and preferences** are extra endpoints that the design does not use yet.

My calls (decisions I made, not the owner):

1. `node:sqlite` instead of `better-sqlite3`.
2. `bonjour-service` for the mDNS browse and the A-record lookup. It is pure JavaScript.
3. No UDP 65506 listener.
4. No automatic lock after a config write.
5. The state write adds `"v": true` and accepts only `on` and `bri`.
6. Only root-path hosting behind a reverse proxy. All browser URLs use absolute paths (`/api/...`) and no origin.
7. The repository root holds one package, named `strand`. There is no workspace.
8. The `preferences` endpoints and their limits.

## 13. Left to the builder

- The exact text format of `s.js?p=2` in the target WLED versions, and the regular expressions. Pin the format from the WLED source (`wled00/xml.cpp:336-470`) and test with real samples.
- Which PIN-gated `s.js?p=N` page is the smallest, for the lock check. Pin it from `wled00/wled_server.cpp` and `xml.cpp`.
- The exact `bonjour-service` API for a browse with a time limit and for an A-record query.
- The folder layout inside `server/`.
- The placeholder home screen.
