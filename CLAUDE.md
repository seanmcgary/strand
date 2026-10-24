# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

No code exists yet. Sources of truth:

- `docs/mvp-prd.md`: the MVP spec for a self-hosted replacement web UI for WLED controllers ("Strand for WLED"). Read it before starting any feature work.
- `docs/design/strand-wled-spec.html`: the interactive design spec (open it in a browser). It is the source of truth for the UI and for the app server API contract (its "MOCK APP SERVER" block).
- `docs/superpowers/specs/2026-10-23-app-server-design.md`: how the server implements that contract against the WLED JSON API, and where it differs from the design.
- `docs/wled-ui-audit/`: the WLED device API and the stock UI it replaces. There are no build, lint, or test commands yet; add them here once the project is scaffolded.

## Stack

One TypeScript package copied from the frontend of `~/Code/app-template`: React 19 + Vite + Tailwind v4 + shadcn/ui, client-side rendered, served by the template's Fastify serving tier, which is also the whole backend (no Go service). SQLite (`node:sqlite`) for storage; Docker for deployment (`network_mode: host`, data volume at `/data`). The server is stateless in memory and talks to devices only over HTTP (no WebSockets; the browser polls).

## Architecture constraints

- The browser talks only to the app server. Frontend code must never call a WLED device directly. All device traffic goes through the server's `/api/devices/...` endpoints (PRD §23).
- The server uses the WLED JSON API for control and settings writes (no settings form POSTs). The browser polls to see state changes made elsewhere (e.g. Home Assistant).
- Lighting state, effects, palettes, segments, and presets live on the WLED device. Don't cache or duplicate them in the database. Effect and palette lists are fetched from the device, never hard-coded.
- Presets use WLED's native preset functionality. No app-level scene system.
- The database is basically a `devices` table (id, name, host, last_ip, timestamps) plus an optional `preferences` table.
- Device discovery uses mDNS plus previously known devices, with manual host/IP entry as a fallback.
- The app does no remote networking or auth. Remote access is the user's reverse proxy or Tailscale, so the app must work behind a proxy (no hard-coded origins or absolute URLs).
- Settings coverage is intentionally partial (LED hardware, network, sync, system). Anything else goes through an "Open WLED Advanced UI" link to the device's stock config page.

## Scope

PRD §3 and §29 list features that are explicitly out of scope for the MVP (accounts, automations, cross-device scenes, DDP rendering, palette/playlist designers, firmware updates, Home Assistant integration, etc.). Don't build them. The PRD's rule for deciding scope: if a feature doesn't help someone stop using the stock WLED UI day to day, it doesn't belong in v1.
