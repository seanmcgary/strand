# App server design

Date: 2026-10-23
Status: draft, waiting for approval

## 1. Intent

better-wled replaces the web UI that ships on WLED controllers (see `docs/mvp-prd.md`). The browser must never talk to a WLED device directly (PRD §4). One server sits between the browser and the devices. This document specifies that server.

The server is thin. It does four things:

1. It serves the built frontend.
2. It keeps a list of saved devices in SQLite.
3. It finds WLED devices on the local network.
4. It sends each browser request to the correct device and returns the result.

The server keeps no device state in memory between requests. It does not hold connections to devices. It does not queue requests. Every API request is complete in itself.

## 2. Decisions the owner made

- The server is the Fastify serving tier of the template frontend in `~/Code/app-template/frontend`. There is no Go service and no separate backend process.
- Take only the frontend from the template. Remove the template parts that this app does not use (section 4).
- The browser renders all pages. There is no server-side rendering.
- The server is stateless. There is no per-device client object, no request queue, and no connection pool that the server manages.
- There is no WebSocket, between the server and a device or between the browser and the server. The browser polls the server with plain HTTP requests. This replaces the WebSocket in PRD §22 on purpose: polling shows changes that other clients (for example, Home Assistant) make.
- SQLite stores the device list.
- The server uses only the WLED JSON API (plus the read-only `s.js?p=2` for capabilities). It does not use the settings form POSTs. The UI follows what the JSON API can do, not what the stock settings forms do.
- The server supports WLED 0.15 and later.

## 3. Goals, non-goals, anti-goals

### Goals

- Serve every endpoint in section 7, so that the settings screens in `docs/design/claude-design-prompt-settings.md` and the control screens in the PRD can work.
- Run as one Node process in one Docker image, with `network_mode: host` and a data volume at `/data` (PRD §5).
- Work behind a reverse proxy or Tailscale that serves the app at the root path of a host name (PRD §28 item 22).

### Non-goals

- Frontend screens. The screens come from the Claude Design work. This work delivers the scaffold, the shared types, and a placeholder home screen.
- Everything in PRD §3 and §29.
- Palette preview colors (`/json/palx`). A later change can add them.
- Hosting the app under a sub-path (for example, `https://host/wled/`). This is my call; see section 12.
- Wi-Fi changes that `POST /json/cfg` cannot make (`wled00/cfg.cpp:85-122`):
  - Removing a saved Wi-Fi network. The firmware does not shrink its network list.
  - Clearing a password. The firmware ignores an empty `psk`, so the server cannot make an open AP or remove a network password.
  - Clearing an SSID.
  - Reconnecting at once. The device uses new network settings only after a reboot.

  `docs/design/claude-design-prompt-settings.md` lines 273, 280 and 286 ask for these behaviors. The Network screen must leave them out.
- WLED versions earlier than 0.15. `POST /api/devices` still accepts these devices, but the settings endpoints can return `capabilities_unparsed` or other errors for them.

### Anti-goals

The work fails, even if it runs, if any of these is true:

- The server holds device state, a connection, or a queue between requests.
- The server stores lighting state, effects, palettes, segments, or presets in the database.
- The server adds keys to a state write that the browser did not send (for example, `time` or `transition`; see `docs/wled-ui-audit/main-ui/data-flow.md`).
- A config write sends a partial subtree to the device and so resets fields that the user did not change (`docs/wled-ui-audit/settings/mechanism.md`).
- The server sends data to a third party (analytics, telemetry).

## 4. What to take from the template

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
- Delete the generated gRPC-gateway client. A hand-written API client in `src/api/` replaces it.
- Put the request and response types in `shared/apiTypes.ts`. The server and the browser both import this file. It is the one source for the API contract.

The template's comments name lawndominator and the app-template. Rename the package and remove those names.

## 5. Process and configuration

`server/config.ts` reads these environment variables. Each has a default, so the process starts with an empty environment.

| Variable | Default | Use |
|---|---|---|
| `PORT` | `3000` | The HTTP port. The server listens on `0.0.0.0`. |
| `DATA_DIR` | `./data` (the Docker image sets `/data`) | The directory for the SQLite file `better-wled.db`. |
| `WEB_DIST_DIR` | `dist` beside `dist-server` | The built frontend. |
| `DEVICE_TIMEOUT_MS` | `3000` | The timeout for one request to a device. |
| `DISCOVERY_WINDOW_MS` | `2500` | How long one discovery request listens for mDNS replies. |

The server serves:

- `/api/*`: the endpoints in section 7. Each response has `Cache-Control: no-store`.
- Static files from the built frontend.
- `index.html` for every other `GET` path that does not match a file, so that browser routes such as `/devices/abc/settings` load the app.

An unknown `/api/*` path returns `404 {"error":"not_found"}`. It does not return `index.html`.

## 6. Data model

SQLite, through `node:sqlite` (built into Node 24). This is my call. It needs no native build step, so the pnpm `strictDepBuilds` setting needs no change.

Migrations are an ordered list of SQL strings in `server/db/migrations.ts`. On start, the server reads `PRAGMA user_version`, applies each newer migration in one transaction, and sets `user_version`.

```sql
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,      -- UUID v4
  mac         TEXT NOT NULL UNIQUE,  -- 12 lowercase hex characters, from info.mac
  name        TEXT NOT NULL,         -- copy of info.name
  host        TEXT NOT NULL,         -- what the user typed, or the mDNS host name
  last_ip     TEXT NOT NULL,
  last_seen   TEXT,                  -- ISO 8601; NULL until the first successful contact
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE preferences (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,         -- JSON
  updated_at  TEXT NOT NULL
);
```

- The MAC is the identity of a device. An IP address and a host name can change, but the MAC does not.
- `name`, `last_ip`, and `last_seen` change when the server gets a good `/json/info` reply from the device. Any endpoint that reads `/json/info` makes this update. Other endpoints do not write to the database.
- The `preferences` table holds UI preferences, for example effect favorites. Effect favorites use effect names, not effect IDs, because IDs change between WLED builds (`docs/wled-ui-audit/README.md`).

## 7. API

All bodies are JSON. The types are in `shared/apiTypes.ts`. They use the names in `docs/design/claude-design-prompt-settings.md`, with the changes this section states.

### 7.1 Devices

| Method and path | Device request | Result |
|---|---|---|
| `GET /api/devices` | `GET /json/info` to every saved device, at the same time | `Device[]` |
| `POST /api/devices` `{ host }` | `GET /json/info` to `host` | `201 Device`, or `200 Device` if the MAC is already saved |
| `DELETE /api/devices/:id` | none | `204` |

`Device` is `{ id, name, host, lastIp, mac, online, lastSeen }`.

- `online` is true when the `/json/info` request in this API request succeeded.
- `GET /api/devices` waits at most `DEVICE_TIMEOUT_MS` for each device. A device that does not reply is `online: false`. The list still returns.
- `Device` does not contain `pinLocked`. The design prompt shows a lock badge on the device card. To know the lock state, the server must send a second request to each device. Instead, the settings endpoints report the lock state (section 7.3). This is my call.

`POST /api/devices` rules:

- Accept a host name, an IPv4 address, or an IPv4 address with a port. Reject any other value with `400 {"error":"invalid_host"}`.
- The reply must be a WLED `/json/info` object with `brand: "WLED"`, a `mac`, and a `ver`. If not, return `422 {"error":"not_wled"}`.
- If the device does not reply, return `504 {"error":"device_unreachable"}`.
- Save `last_ip` from `info.ip`.

### 7.2 Discovery

`GET /api/discovery` returns `DiscoveredDevice[]`, where `DiscoveredDevice` is `{ mac, name, ip, host, ver, ledCount, arch, alreadyAdded }`.

In one request, the server does these steps:

1. Browse mDNS for `_wled._tcp` for `DISCOVERY_WINDOW_MS`.
2. At the same time, send `GET /json/nodes` to every saved device. This finds devices that do not answer mDNS (`docs/wled-ui-audit/api/discovery.md`).
3. Send `GET /json/info` to every IP address that steps 1 and 2 found, at the same time.
4. Drop every address that does not give a valid WLED reply. Merge the results by MAC.
5. Set `alreadyAdded` from the `devices` table.
6. For each saved device that replied, update `last_ip`. A device that got a new DHCP address recovers in this way.

The server does not listen on the UDP port 65506. Devices send that broadcast on their own schedule, so a listener that runs only during one request misses most of them. This is my call.

mDNS needs the host network. The Docker setup in section 10 uses `network_mode: host`.

### 7.3 One device

Each endpoint below loads the device by `:id`. If there is no such device, it returns `404 {"error":"device_not_found"}`. Section 8 describes how the server reaches the device.

| Method and path | Device request | Result |
|---|---|---|
| `GET /api/devices/:id` | `GET /json/info` | `Device` |
| `GET /api/devices/:id/info` | `GET /json/info` | the WLED info object, unchanged |
| `GET /api/devices/:id/state` | `GET /json/state` | the WLED state object, unchanged |
| `PATCH /api/devices/:id/state` | `POST /json/state` with the request body, unchanged | the WLED reply, unchanged |
| `GET /api/devices/:id/effects` | `GET /json/effects` and `GET /json/fxdata` | `{ id, name, meta }[]` |
| `GET /api/devices/:id/palettes` | `GET /json/palettes` | `{ id, name }[]` |
| `GET /api/devices/:id/presets` | `GET /presets.json` | `{ id, name, quickLabel, isPlaylist }[]` |
| `GET /api/devices/:id/config` | `GET /json/cfg` | `WledConfig` |
| `PATCH /api/devices/:id/config` | `GET /json/cfg`, then `POST /json/cfg` | `{ config, rebootRequired }` |
| `POST /api/devices/:id/unlock` `{ pin }` | `POST /json/state`, then `GET /settings/s.js?p=2` | `204`, or `401 {"error":"pin_incorrect"}` |
| `GET /api/devices/:id/capabilities` | `GET /settings/s.js?p=2` | `Capabilities` |
| `GET /api/devices/:id/pins` | `GET /json/pins` | `{ pins: PinInfo[] }` |
| `POST /api/devices/:id/networks/scan` | `GET /json/net`, repeated | `{ networks: WifiNetwork[] }` |
| `POST /api/devices/:id/reboot` | `POST /json/state` `{"rb":true}` | `202` |

Rules for each endpoint:

- **State write.** The server checks that the body is a JSON object. It sends the body to the device with no change. Segment edits, preset run, save, rename and delete (`ps`, `psave`, `pdel`), and the LED flash for segment edges (`seg.i`) all go through this endpoint. The frontend is responsible for correct WLED payloads (`docs/wled-ui-audit/api/json-state.md`).
- **Effects.** Join the two lists by index. Drop the entries named `RSVD`. `meta` is the `fxdata` string for that effect.
- **Presets.** Drop preset 0 and entries that have no `n`. A preset is a playlist if it has a `playlist` key.
- **Config read.** Return the subtrees the settings screens use: `id`, `nw`, `ap`, `def`, `light`, `hw.led`, and `if.sync`.
- **Config write.** The body is a partial `WledConfig` that changes one section. The server does these steps:
  1. Read the current `/json/cfg`.
  2. Deep-merge the body into the current config. An array in the body replaces the array in the config. For example, `hw.led.ins` replaces the whole output list.
  3. Send one `POST /json/cfg`. Its body contains, for each top-level key that the request body touches (`id`, `nw`, `ap`, `def`, `light`, `hw`, `if`), the complete merged top-level subtree. Example: a change to `hw.led.maxpwr` sends all of `hw`, including `hw.btn`, `hw.ir` and `hw.relay` with their current values. The firmware resets fields that a write leaves out (`docs/wled-ui-audit/settings/mechanism.md`). Sending current values again does not change them. One POST means a failure cannot leave the device with only part of the write.
  4. Read `/json/cfg` again and return it.
  5. Set `rebootRequired: true` if the body touched `nw`, `ap`, or `id.mdns`. A JSON config write does not reconnect Wi-Fi, so the device uses the new network settings only after a reboot. The UI shows the warning and offers the reboot (PRD §18).

  A new Wi-Fi or AP password goes in the `psk` field of that `nw.ins` entry or of `ap`. The config read never returns `psk`, only `pskl`. So the merge in step 2 keeps a stored password when the body has no `psk`. Add `psk?: string` to `WifiEntry` and to the `ap` type in `shared/apiTypes.ts`.
  6. If the device returns `401`, return `401 {"error":"pin_required"}`.
- **Unlock.** The server sends `{"pin":"<pin>"}` to `/json/state`. Then it requests `/settings/s.js?p=2`. A `401` means the PIN is wrong. The device stays unlocked for 15 minutes for every client on the network (`docs/wled-ui-audit/settings/security-backup.md`). The server does not store the PIN. The server does not lock the device again after a write. If it did, the user would enter the PIN again for each save. This is my call.
- **Capabilities.** Parse the JavaScript text that `s.js?p=2` returns with regular expressions. Do not run the text. Extract `d.ledTypes`, the `bLimits(...)` arguments, `d.rsvd`, and `d.ro_gpio` (`docs/wled-ui-audit/settings/led-hardware.md`). If the device returns `401`, return `401 {"error":"pin_required"}`. If a value is missing, return `502 {"error":"capabilities_unparsed"}`. Do not return defaults.
- **Network scan.** The first `/json/net` request starts a scan and returns an empty list. Request it again once a second, at most 10 times, until the list has entries (`docs/wled-ui-audit/settings/wifi-network.md`). If the list is still empty, return the empty list.
- **Reboot.** Return `202` when the device accepts the request. The device then goes offline for some seconds. The browser finds out that the device is back by polling.

### 7.4 Preferences

| Method and path | Result |
|---|---|
| `GET /api/preferences` | an object of all keys and values |
| `PUT /api/preferences/:key` `{ value }` | `204` |

Keys match `^[a-zA-Z0-9._-]{1,64}$`. The value is any JSON value, at most 64 KB when serialized. This is my call. The PRD makes the table optional, but effect favorites need it.

## 8. Requests to devices

Every device request uses `fetch` with an `AbortSignal` timeout of `DEVICE_TIMEOUT_MS`. The scan endpoint uses its own limit (section 7.3).

### 8.1 How the server finds the address

The Docker image has no mDNS name resolver, so the operating system cannot resolve a `.local` name. The server uses `last_ip` for each request:

1. Send the request to `last_ip`.
2. If the connection fails (refused, no route, or timeout), and `host` is a `.local` name, send one mDNS query for the A record of `host` (1 second limit).
3. If the query returns a different address, check it with `GET /json/info`. If the MAC matches, save the new `last_ip` and send the original request again, one time.
4. Otherwise, return `504 {"error":"device_unreachable"}`.

`POST /api/devices` uses the same mDNS lookup when the user types a `.local` name.

### 8.2 Errors

| Device result | API result |
|---|---|
| Timeout or connection failure | `504 {"error":"device_unreachable"}` |
| `503`, or the connection closes with no reply | `503 {"error":"device_busy"}`, with `Retry-After: 1` |
| `401` | `401 {"error":"pin_required"}` |
| `200` with `{"error":<n>}` in the body | `502 {"error":"device_error","code":<n>}` |
| Any other non-2xx | `502 {"error":"device_error","status":<status>}` |
| A body that is not JSON where the server expects JSON | `502 {"error":"invalid_response"}` |

A device accepts about 6 requests at the same time. More requests get a `503` (`docs/wled-ui-audit/api/limits-and-gotchas.md`). The server does not prevent this. The browser treats `device_busy` as a temporary error and tries again at its next poll. If this becomes a real problem, a later change can add a limit.

## 9. Frontend contract for polling

The server does not set polling rates. The frontend uses these values. They are my call, and the frontend work can change them:

- While a device screen is open, poll `GET /api/devices/:id/state` every 3 seconds.
- While the dashboard is open, poll `GET /api/devices` every 10 seconds.
- Stop polling when the browser tab is hidden.
- Do not start a new poll while the previous poll for the same URL is still open.

## 10. Docker

- A multi-stage `Dockerfile` with a `node:24` build stage and a `node:24-slim` runtime stage.
- The runtime stage runs as the `node` user, sets `DATA_DIR=/data`, and declares `/data` as a volume.
- A `docker-compose.yml` at the repository root, the same as PRD §5.

## 11. Tests

- Each endpoint has vitest tests that use `fastify.inject`.
- A fake WLED device is a small Fastify instance on a random port. It returns fixtures based on the fixtures in the design prompt, and the tests can tell it to time out, to return `503`, or to return `401`.
- Discovery tests replace the mDNS browser with a test double.
- The config-write tests prove that the server sends complete top-level subtrees in one POST. Example: a body that changes only `hw.led.maxpwr` must cause exactly one `POST /json/cfg` that contains the full `hw` object, with all outputs, buttons, IR and relay.
- Fixtures and `s.js?p=2` samples cover WLED 0.15, 0.16 and 17.0.0-dev.
- The state-write test proves that the server sends the body with no added keys.
- Each SQLite test uses its own temporary database.

## 12. My calls

Each of these is a decision I made, not a decision the owner made:

1. `node:sqlite` instead of `better-sqlite3`.
2. `bonjour-service` for the mDNS browse and the A-record lookup. It is pure JavaScript.
3. No UDP 65506 listener.
4. No `pinLocked` on `Device`. The settings endpoints report the lock state.
5. No automatic lock after a config write.
6. A config write sends complete top-level subtrees in one POST.
7. Only root-path hosting behind a reverse proxy. All browser URLs use absolute paths (`/api/...`) and no origin.
8. The repository root holds one package. There is no workspace.
9. The polling rates in section 9.
10. The `preferences` endpoints and their limits.

## 13. Left to the builder

- The exact text format of `s.js?p=2` in the target WLED versions, and the regular expressions. Pin the format from the WLED source (`wled00/xml.cpp:336-470`) and test with a real sample.
- The exact `bonjour-service` API for a browse with a time limit and for an A-record query.
- The folder layout inside `server/`.
- The placeholder home screen.
