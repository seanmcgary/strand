# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sources of truth

- `docs/mvp-prd.md`: the MVP spec for a self-hosted replacement web UI for WLED controllers ("Strand for WLED"). Read it before starting any feature work.
- `docs/design/strand-wled-spec.html`: the interactive design spec (open it in a browser). It is the source of truth for the UI and for the app server API contract (its "MOCK APP SERVER" block).
- `docs/superpowers/specs/2026-10-23-app-server-design.md`: how the server implements that contract against the WLED JSON API, and where it differs from the design.
- `docs/superpowers/specs/2026-11-23-lights-presets-design.md`: the Lights and Presets tabs: the strand model, scenes and looks, and the startup preset.
- `docs/wled-ui-audit/`: the WLED device API and the stock UI it replaces.
- `CONVENTIONS.md`: the code conventions (state management, server, migrations, naming, tests, commits). Read it before writing code.

## Commands

```bash
pnpm install
pnpm exec tsc --noEmit   # type gate (Vite and vitest strip types without checking)
pnpm lint
pnpm test                # all tests; `pnpm test <path>` for one file
pnpm build               # client → dist/
pnpm build:server        # server → dist-server/server.js
pnpm start               # node dist-server/server.js
pnpm dev:build           # with `pnpm dev` in a second terminal: rebuild and restart on change
pnpm storybook
docker build -t strand .
docker compose up   # network_mode: host; data in ./data
```

## Stack

One TypeScript package copied from the frontend of `~/Code/app-template`: React 19 + Vite + Tailwind v4 + shadcn/ui, client-side rendered, served by the template's Fastify serving tier, which is also the whole backend (no Go service). SQLite (`node:sqlite`) for storage; Docker for deployment (`network_mode: host`, data volume at `/data`). The server keeps no state that must survive a restart. It may hold short in-memory timers (the 3-second LED flash and the 5-second startup-preset write) and, per device, the paint it last sent; see CONVENTIONS.md §5. It talks to devices only over HTTP (no WebSockets).

## Architecture constraints

- The browser talks only to the app server. Frontend code must never call a WLED device directly. All device traffic goes through the server's `/api/devices/...` endpoints (PRD §23). The browser never builds or sends WLED JSON. The Lights API speaks the strand model (strands, ranges, patterns, slots), and the server alone translates it to WLED segments.
- The server uses the WLED JSON API for control and settings writes (no settings form POSTs). The browser does not poll lighting state. Changes made outside Strand (e.g. Home Assistant) are not tracked.
- Live lighting state, effects, palettes, and segments live on the WLED device. Don't cache or duplicate them in the database. Saved scenes and looks, strand combinations, and strand names are in the database. Effect and palette lists are fetched from the device, never hard-coded.
- Presets are Strand scenes and looks, stored per controller in Strand's database. WLED presets are not a user feature. Strand writes one reserved WLED preset (ID 250, "Strand: startup") to keep the layout across reboots, and always sets it as the boot preset, with no question. Settings has no boot preset field: for defaults it writes only `def.on` and `def.bri`.
- The database is a `devices` table (`id`, `mac`, `name`, `host`, `port`, `last_ip`, `last_seen`, `pending_reboot`, `pending_since`, `created_at`, `updated_at`), a `preferences` table (`key`, `value`, `updated_at`), and the `scenes`, `looks` and `strand_groups` tables. See spec §7 and the lights and presets design §8. Strand names are preferences that the server writes.
- Device discovery uses mDNS plus previously known devices, with manual host/IP entry as a fallback.
- The app does no remote networking or auth. Remote access is the user's reverse proxy or Tailscale, so the app must work behind a proxy (no hard-coded origins or absolute URLs).
- `/api` accepts only requests whose `Host` is an IP address, `localhost`, a `.local` name, or a name in `ALLOWED_HOSTS` (comma-separated; `*` turns the check off). Writes also need the header `X-Strand-Request: 1` and a same-origin `Origin`. A user who serves Strand behind a reverse proxy with its own host name must add that name to `ALLOWED_HOSTS` (`server/requestGuard.ts`). The proxy must also forward the original `Host` header (nginx: `proxy_set_header Host $host;`), or every write fails the Origin check.
- Settings coverage is intentionally partial (LED hardware, network, sync, system). Anything else goes through an "Open WLED Advanced UI" link to the device's stock config page.

## Scope

PRD §3 and §29 list features that are explicitly out of scope for the MVP (accounts, automations, cross-device scenes, DDP rendering, palette/playlist designers, firmware updates, Home Assistant integration, etc.). Don't build them. The PRD's rule for deciding scope: if a feature doesn't help someone stop using the stock WLED UI day to day, it doesn't belong in v1.
