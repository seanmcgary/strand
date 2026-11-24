# Self-Hosted WLED UI — MVP PRD

## 1. Product Summary

Build a modern self-hosted web interface for WLED.

The application runs on the user's local network and communicates directly with one or more WLED controllers.

The goal is simple:

> Replace the existing WLED web interface with something that is pleasant to use.

The server can optionally be exposed remotely through infrastructure the user already controls, such as Tailscale or Cloudflare Tunnel.

WLED remains responsible for actually driving the lights.

---

# 2. MVP Goals

The MVP should allow a user to:

1. Run the application with Docker.
2. Find WLED devices on the local network.
3. Add and remember those devices.
4. Control the lights.
5. Manage segments visually.
6. Manage presets.
7. Change the most commonly used WLED settings.
8. Access the UI remotely through Tailscale, Cloudflare Tunnel, or another reverse proxy.

The MVP should be useful enough that the user rarely needs to open the stock WLED web UI.

---

# 3. Non-Goals

Do **not** build these in MVP:

- User accounts / RBAC
- Complex automation
- Cross-controller scene engine
- Server-rendered LED animation
- DDP rendering
- Configuration history
- Audit logs
- Firmware fleet management
- Home Assistant integration
- Mobile apps
- Cloud accounts
- Browser-only/static deployment
- Support for non-WLED devices
- Plugin systems
- Installer/business features

These can come later.

---

# 4. Architecture

```text
Browser
   │
   │ HTTP / HTTPS
   ▼
┌─────────────────────┐
│   WLED UI Server    │
│                     │
│ Web frontend        │
│ API                 │
│ Device registry     │
│ SQLite              │
│ WLED client         │
└──────────┬──────────┘
           │
           │ LAN
           ▼
      WLED devices
```

The browser talks only to the application server.

The application server talks to WLED devices.

This allows remote access without exposing individual WLED controllers.

---

# 5. Deployment

Primary deployment:

```yaml
services:
  app:
    image: <image>
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./data:/data
```

Use SQLite for persistent storage.

Users may expose the application using:

- Tailscale
- Cloudflare Tunnel
- Caddy
- nginx
- another reverse proxy

The application does not manage remote networking itself.

---

# 6. Device Discovery

On first launch:

```text
Find WLED Devices
```

The server searches the local network.

Prefer:

- mDNS discovery
- previously known devices

Also provide:

```text
Add device manually
Hostname or IP: __________
```

Discovered devices should show:

```text
Backyard Lights
192.168.1.42
WLED 0.16.x
150 LEDs

[ Add ]
```

---

# 7. Device Registry

The server stores basic information about added devices.

Example:

```json
{
  "id": "uuid",
  "name": "Backyard",
  "host": "wled-backyard.local",
  "lastIp": "192.168.1.42"
}
```

The server should remember devices between restarts.

---

# 8. Main Dashboard

The dashboard lists all controllers.

Example:

```text
My Lights

┌──────────────────────┐
│ Backyard             │
│ ● Online             │
│                      │
│ Brightness  72%      │
│ Effect      Chase    │
└──────────────────────┘

┌──────────────────────┐
│ Front Roof           │
│ ● Online             │
│                      │
│ Brightness  100%     │
│ Effect      Solid    │
└──────────────────────┘
```

Each device should support quick:

- power on/off
- brightness control
- navigation into device controls

---

# 9. Device Control

The main device screen should replace WLED's normal control screen.

Required controls:

- Power
- Brightness
- Color
- Effect
- Palette
- Segment selection

Example:

```text
Backyard

Power          ON

Brightness
━━━━━━━━━━━━●━━━━  72%

Color
[ color picker ]

Effect
Chase                >

Palette
Orange & White       >

Segments
All Lights           >
```

Changes should feel immediate.

The Lights tab replaces this screen and the Segments screen. Power and brightness are per device and per strand. Color, effect and palette are per slot of a range. See `docs/superpowers/specs/2026-11-23-lights-presets-design.md` §7.2.

---

# 10. Effects

Retrieve available effects from WLED.

UI:

```text
Effects

Search...

Favorites
★ Chase
★ Twinkle
★ Solid

All Effects
Breathe
Candle
Chase
Colorloop
...
```

Selecting an effect should expose whatever basic controls WLED makes available, such as:

- speed
- intensity
- custom parameters

Do not hard-code the effect list.

---

# 11. Palettes

Retrieve palettes from WLED.

Allow:

- browse
- search
- select

No custom palette editor required for MVP.

---

# 12. Segments

Segments are a major MVP feature.

Users should be able to:

- see existing segments
- create segments
- rename segments
- resize segments
- delete segments
- reverse segments
- select effects/palettes per segment

Avoid requiring users to manually type indexes whenever possible.

Strand shows segments as strands, ranges and patterns. A strand is one LED output. The user splits a strand into ranges, and gives each range a pattern (All, Every N, or Individual). Strand writes the WLED segments. The user never sees a segment index. See `docs/superpowers/specs/2026-11-23-lights-presets-design.md` §2 and §6.

---

# 13. Visual Segment Designer

Provide a simple representation of the LED strip.

Example:

```text
0                                                   149

● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ●

       ├──────── Patio ────────┤

                         ├──── Kitchen ────┤
```

Users should be able to drag segment boundaries.

Example:

```text
Patio

Start
      ▼
● ● ● ● ● ● ● ● ● ● ● ● ● ● ●
              ▲
             Stop
```

Moving the handles updates:

```text
start = 12
stop = 37
```

without requiring the user to manually calculate those numbers.

---

# 14. LED Identification

When creating or resizing a segment, provide:

```text
[ Flash Start ]
[ Flash End ]
```

The corresponding physical LED should illuminate temporarily.

This makes it easier to map physical installations.

A more sophisticated physical-layout designer can come later.

---

# 15. Presets

Presets are Strand scenes and looks. Strand stores them in its database, per controller.

- **Scene:** a saved configuration for one strand: its ranges, patterns, slots, paint, power and brightness.
- **Look:** a pattern with its slots (colors, effects, palettes). It has no LED positions, so it fits any strand.

Required:

- list scenes and looks
- apply a scene to its strand
- apply a look to one or more strands or ranges
- save a scene from a strand, or a look from a range
- rename a scene or a look
- delete a scene or a look

Example:

```text
Scenes                         [ + Save scene… ]
Roofline: Party
Holiday

Looks                          [ + Save look… ]
Candy cane
Warm white
```

WLED presets are not a user feature. Strand does not list them. They stay on the device, and the stock UI still runs them.

Strand keeps one reserved WLED preset on each controller: ID 250, "Strand: startup". It holds the layout, so the layout survives a reboot. Strand always sets it as the boot preset. It does not ask.

See `docs/superpowers/specs/2026-11-23-lights-presets-design.md` §2, §6.7 and §7.5.

---

# 16. Settings

MVP settings coverage should focus on the settings users commonly touch.

Do not attempt to rewrite every obscure WLED configuration screen yet.

Required sections:

```text
Device

LED Hardware
Network
Sync
System
```

---

# 17. LED Hardware Settings

Support the core configuration required to set up a strip.

Example:

```text
LED Output

Type
WS281x

GPIO
16

LED Count
150

Color Order
GRB

Reverse
No

Brightness Limit
255
```

Include current limiting if exposed cleanly by WLED.

Advanced LED settings may remain accessible through the stock WLED interface initially.

---

# 18. Network Settings

Support common settings:

- device name
- hostname
- Wi-Fi SSID
- Wi-Fi password
- AP settings where straightforward

Warn the user before changing networking settings:

```text
Changing Wi-Fi settings may disconnect this device.
```

---

# 19. Sync Settings

Support basic WLED sync configuration:

- send sync
- receive sync
- sync groups
- brightness
- colors
- effects

Advanced realtime protocols can wait.

---

# 20. System Settings

Provide:

- WLED version
- uptime
- IP address
- Wi-Fi signal
- platform
- free memory where available
- reboot

Example:

```text
System

WLED            0.16.x
Hardware        ESP32
IP              192.168.1.42
Uptime          4d 12h
Signal          -52 dBm

[ Reboot Device ]
```

---

# 21. Unsupported Settings

The MVP does not need 100% configuration coverage.

Provide:

```text
Advanced Settings

Some WLED settings are not yet available here.

[ Open WLED Advanced UI ]
```

That button opens the device's existing WLED configuration page.

This provides an escape hatch while keeping MVP scope reasonable.

---

# 22. Server ↔ WLED Communication

Use the WLED JSON API for runtime control.

There is no WebSocket and no polling of lighting state.

The browser reads the lights when a screen opens. After that, it shows the result of its own writes.

Changes made outside Strand (for example, by Home Assistant) are not tracked.

The browser never sends WLED JSON. It sends the strand model, and the server translates it to WLED segments.

---

# 23. Application API

Keep the server API small.

Example:

```text
GET    /api/devices
POST   /api/devices

GET    /api/devices/:id
GET    /api/devices/:id/state
PATCH  /api/devices/:id/state

GET    /api/devices/:id/config
PATCH  /api/devices/:id/config

GET    /api/devices/:id/effects
GET    /api/devices/:id/palettes
```

`PATCH /api/devices/:id/state` accepts only `{ on?, bri? }`. The Lights, scene and look endpoints are in `docs/superpowers/specs/2026-11-23-lights-presets-design.md` §9.

Frontend code should not talk directly to WLED.

---

# 24. Data Model

MVP database can be tiny.

```text
devices
```

```sql
id UUID PRIMARY KEY
name TEXT
host TEXT
last_ip TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

Optionally:

```text
preferences
```

for UI preferences.

For presets and strands:

```text
scenes
looks
strand_groups
```

Live lighting state remains on WLED itself.

---

# 25. Suggested Stack

Frontend:

```text
TypeScript
React
Vite
```

Backend:

```text
Go
```

or:

```text
TypeScript + Fastify
```

Database:

```text
SQLite
```

Docker for deployment.

No Kubernetes requirements.

---

# 26. Primary Screens

MVP needs approximately six screen types.

```text
Dashboard
Device Control
Segments
Presets
Settings
Add Device
```

Device Control and Segments are one tab, Lights. The device page has three tabs: Lights, Presets, Settings.

That's it.

Do not build a giant navigation system.

---

# 27. MVP User Flow

## Installation

```text
docker compose up
        ↓
open http://server:port
```

## Setup

```text
Find Devices
      ↓
Select WLED
      ↓
Add
```

## Normal usage

```text
Dashboard
   ↓
Backyard
   ↓
Lights / Presets
```

## Configuration

```text
Backyard
   ↓
Settings
   ↓
LED Hardware
```

---

# 28. MVP Acceptance Criteria

The MVP is ready when a user can:

1. Start the application through Docker.
2. Discover a WLED controller.
3. Manually add a controller if discovery fails.
4. See whether the controller is online.
5. Turn it on/off.
6. Change brightness.
7. Change color.
8. Select an effect.
9. Select a palette.
10. See existing segments.
11. Create/edit/delete segments.
12. Adjust segment ranges visually.
13. Flash segment boundaries for identification.
14. Apply a saved scene or look.
15. Save a strand as a scene, or a range as a look.
16. Edit basic LED hardware configuration.
17. Edit basic network configuration.
18. Edit basic sync configuration.
19. View device/system information.
20. Reboot the controller.
21. Open the stock WLED advanced UI for anything not yet supported.
22. Use the application normally through a reverse proxy or Tailscale.

---

# 29. Things We Explicitly Defer

Do not accidentally start building these while working on MVP:

```text
Physical house designer
Cross-device scenes
Custom palette designer
Playlist designer
Application automations
Configuration history
Configuration rollback
Firmware updates
Multi-user permissions
Home Assistant plugin
DDP renderer
Mobile app
Static/browser-only mode
```

They are future features.

Per-LED paint (the Individual pattern) is in v1. See `docs/superpowers/specs/2026-11-23-lights-presets-design.md` §2.

---

# 30. MVP Product Definition

The MVP is:

> **A self-hosted, modern replacement frontend for the parts of WLED people use most often.**

The guiding rule is:

> If it doesn't help someone stop using the stock WLED UI during normal day-to-day use, it probably doesn't belong in v1.

The first release should be a good bicycle, not an attempt to replace the entire lighting ecosystem.
