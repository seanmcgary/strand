# Sync Interfaces (`settings_sync.htm`)

Source: `wled00/data/settings_sync.htm`. Loaded at `/settings/sync`, values from `GET /settings/s.js?p=4` (`wled00/xml.cpp:478-595`), saved via `POST /settings/sync` → `wled00/set.cpp:441-551`. After every Sync save, `alexaInit()` runs (`wled00/set.cpp:906-908`). Save response: "Sync settings saved." with 1-second redirect (`wled00/wled_server.cpp:800`, `:821`).

The page title is "Sync setup". The form's `onsubmit="GC()"` packs group checkboxes into hidden fields before posting (`settings_sync.htm:75`, `:27-40`). After s.js loads, `SetVal()` derives the DMX type select from the port and `FC()` unpacks group bitmasks into checkboxes (`:42-46`).

## WLED Broadcast (UDP sync ports)

| Label | Field | Type / range | set.cpp | Apply |
|---|---|---|---|---|
| UDP Port | `UP` | number 1-65535, required (`settings_sync.htm:83`) | `set.cpp:443-444` (ignored if ≤0). Default 21324. | UDP sockets open in `initInterfaces()`/`initAP()` (`wled.cpp:735-741`, `:945-951`) → reboot/reconnect. |
| 2nd Port | `U2` | number 1-65535, required (`:84`) | `set.cpp:445-446`. Default 65506. | Reboot. |

## ESP-NOW

| Label | Field | Type | Visibility | set.cpp |
|---|---|---|---|---|
| Use ESP-NOW sync (in AP mode or no WiFi) | `EN` | checkbox (`:92`) | Shown only if ESP-NOW is compiled in **and** enabled on the WiFi page (`RE`); otherwise "Disabled. Enable ESP-NOW in WiFi settings." (`xml.cpp:482-487`) | `set.cpp:448-450` → `useESPNowSync`. Live. Sends sync packets over ESP-NOW in addition to UDP (`udp.cpp:22-23`). |

## Sync groups

Two hidden numeric fields carry the bitmasks; 16 checkboxes are UI only.

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Send: groups 1-8 | `G1`..`G8` | checkboxes (posted but ignored by server) (`:113-120`) | — |
| Receive: groups 1-8 | `R1`..`R8` | checkboxes (posted, ignored) (`:124-131`) | — |
| (hidden) send groups bitmask | `GS` | number 0-255, `G1`=bit0 (`:97`) | `set.cpp:452` → `syncGroups`. Live. |
| (hidden) receive groups bitmask | `GR` | number 0-255 (`:98`) | `set.cpp:453` → `receiveGroups`. Live. |

Semantics (`wled00/udp.cpp:20-38`, `:207-218`): a packet carries the sender's `syncGroups` byte; a receiver applies it only if `receiveGroups & packetGroups` is non-zero. `syncGroups == 0` disables sending entirely; `receiveGroups == 0` disables receiving. Senders older than protocol v9 are treated as group 1. There is no separate "receive enabled" flag; the main UI's state JSON reports `udpn.recv = receiveGroups != 0` (`json.cpp:675`). Groups can also be set at runtime via `/json/state` `udpn.sgrp` / `udpn.rgrp` (`json.cpp:430-431`), which persist only if config is later saved.

## Receive

| Label | Field | Type | set.cpp | Meaning |
|---|---|---|---|---|
| Brightness | `RB` | checkbox (`:137`) | `set.cpp:455` | Apply sender's brightness. |
| Color | `RC` | checkbox | `set.cpp:456` | Apply main-segment colors. |
| Effects | `RX` | checkbox | `set.cpp:457` | Apply effect, speed, intensity. |
| Palette | `RP` | checkbox | `set.cpp:458` | Apply palette. |
| Segment options | `SO` | checkbox (`:138`) | `set.cpp:459` | Apply per-segment options (on/off, reverse, mirror, etc.) for all segments instead of only the main segment (`udp.cpp:252-345`). |
| bounds | `SG` | checkbox (`:138`) | `set.cpp:460` | Apply segment start/stop and create segments to match sender (`udp.cpp:256-273`, `:339`). |

If none of RB/RC/RX/RP is checked, colors are still applied (`someSel` logic, `udp.cpp:228-230`). Notifications received within 1 s of sending one are ignored (`udp.cpp:208`). All live.

## Send

| Label | Field | Type | set.cpp | Meaning |
|---|---|---|---|---|
| Enable Sync on start | `SS` | checkbox (`:142`) | `set.cpp:461` → `sendNotifications` | Boot default for the runtime send flag `sendNotificationsRT` (`cfg.cpp:586`). The main UI "Sync" button toggles the runtime flag only (`udpn.send`). |
| Send notifications on direct change | `SD` | checkbox (`:143`) | `set.cpp:462` → `notifyDirect` | Covers UI/API changes, nightlight, preset cycle (`udp.cpp:31-36`). |
| Send notifications on button press or IR | `SB` | checkbox (`:144`) | `set.cpp:463` → `notifyButton` | |
| Send Alexa notifications | `SA` | checkbox (`:145`) | `set.cpp:464` → `notifyAlexa` | Value only populated by xml when Alexa compiled in (`xml.cpp:532`). |
| Send Philips Hue change notifications | `SH` | checkbox (`:146`) | `set.cpp:465` → `notifyHue` | |
| UDP packet retransmissions | `UR` | number 0-30, required (`:147`) | `set.cpp:467-468` (accepts 0-29) → `udpNumRetries` | Resend count at 250 ms spacing (`udp.cpp:471`). |

The page says "Reboot required to apply changes" under this section (`:148`), but all of these flags are read live in `notify()`. Only the port fields need a reboot.

## Instance List

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Enable instance list | `NL` | checkbox (`:152`) | `set.cpp:471-472`. Unchecking clears the node map immediately. Default on. |
| Make this instance discoverable | `NB` | checkbox (`:153`) | `set.cpp:473`. Broadcasts a sysinfo UDP packet every 30 s (`wled.cpp:177-184`). Default on. |

The list itself is not on this page. It is shown in the main UI's "Instances" panel via `GET /json/nodes` → `[{name, type, ip, age, vid}]` (`json.cpp:1092-1108`; `index.js:1130-1155`). `/json/info` `ndc` reports node count or -1 when disabled (`json.cpp:845`). This is a cheap secondary discovery source for the replacement besides mDNS.

## Realtime

| Label | Field | Type / range | Visibility | set.cpp | Apply |
|---|---|---|---|---|---|
| Receive UDP realtime | `RD` | checkbox (`:157`) | always | `set.cpp:475` → `receiveDirect` (WARLS/DRGB/DNRGB/Hyperion UDP on port 21324 and DDP) | live |
| Use main segment only | `MO` | checkbox (`:158`) | always | `set.cpp:476` | live |
| Respect LED Maps | `RLM` | checkbox (`:159`) | always | `set.cpp:477` | live |
| Network DMX input → Type | `DI` | select: 5568 E1.31 (sACN), 6454 Art-Net, 0 Custom port (`:162-166`) | always | not read by server; JS helper. `SP()` hides the port field and copies the value into `EP` when not "Custom"; `adj()` nudges universe/address defaults (`:17-18`, `:41`). | — |
| Port | `EP` | number 1-65535, required (`:167`) | inside `#xp`, visible only when Type = Custom | `set.cpp:480-481` → `e131Port`. Art-Net vs E1.31 is chosen by port. | reboot (`e131.begin` only in `initInterfaces`, `wled.cpp:953`) |
| Multicast | `EM` | checkbox (`:168`) | always | `set.cpp:479` | reboot |
| Start universe | `EU` | number 0-63999, required (`:169`) | always | `set.cpp:482-483` | reboot (page says "Reboot required.") |
| Skip out-of-sequence packets | `ES` | checkbox (`:171`) | always | `set.cpp:478` | live |
| DMX start address | `DA` | number 1-510 in HTML, required (`:172`) | always | `set.cpp:484-485` (server accepts 0-510) | live |
| DMX segment spacing | `XX` | number 0-150, required (`:173`) | always | `set.cpp:486-487` | live |
| E1.31 port priority | `PY` | number 0-200, required (`:174`) | always | `set.cpp:488-489` | live |
| DMX mode | `DM` | select: 0 Disabled, 1 Single RGB, 2 Single DRGB, 3 Effect, 7 Effect + White, 8 Effect Segment, 9 Effect Segment + White, 4 Multi RGB, 5 Dimmer + Multi RGB, 6 Multi RGBW, 10 Preset (`:176-188`; constants `const.h:316-326`) | always | `set.cpp:490-491` | live |
| Timeout | `ET` | number 1-65000 ms in HTML, required (`:190`) | always | `set.cpp:492-493` (server accepts 100-65000) → `realtimeTimeoutMs`; how long realtime mode holds after last packet. Stored in cfg as `/100`. | live |
| Force max brightness | `FB` | checkbox (`:191`) | always | `set.cpp:494` | live |
| Disable realtime gamma correction | `RG` | checkbox (`:192`) | always | `set.cpp:495` | live |
| Realtime LED offset | `WO` | number -255..255, required (`:193`) | always | `set.cpp:496-497` | live |

### Wired DMX Input (`#dmxInput`)

Only with `WLED_ENABLE_DMX_INPUT`; otherwise hidden and "does not include DMX Input support" shown (`xml.cpp:512-521`). A separate "does not include DMX output support" note (`#dmxOnOffOutput`) is hidden only when `WLED_ENABLE_DMX` is set (`xml.cpp:509-511`).

| Label | Field | Type | set.cpp |
|---|---|---|---|
| DMX RX Pin (RO) | `IDMR` | number -1..99, converted to a pin `<select>` by `pinDropdowns()` (`settings_sync.htm:51-68`, `:197`) | `set.cpp:501` |
| DMX TX Pin (DI) | `IDMT` | same (`:198`) | `set.cpp:500` |
| DMX Enable Pin (RE+DE) | `IDME` | same (`:199`) | `set.cpp:502` |
| DMX Port | `IDMP` | number 1-2 (`:200`) | `set.cpp:503-504`, invalid → 2 |

"Reboot required to apply changes." In cfg.json the RX/TX keys are cross-wired (`inputRxPin` stores the TX variable and vice versa, `cfg.cpp:622-623`, `:1153-1154`); it round-trips consistently, but a replacement editing `/json/cfg` directly must preserve that mapping.

## Alexa Voice Assistant (`#Alexa`)

Hidden with "does not include Alexa support" when `WLED_DISABLE_ALEXA` (`xml.cpp:528-535`).

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Emulate Alexa device | `AL` | checkbox (`:216`) | `set.cpp:508`; `alexaInit()` after save (`:907`) — live |
| Alexa invocation name | `AI` | text, maxlength 32 (`:217`) | `set.cpp:509` |
| Also emulate devices to call the first N presets | `AP` | number 0-9 (`:218`) | `set.cpp:510-511` |

Alexa on/off presets are on the Time page (`A0`/`A1`).

## MQTT (`#MQTT`)

Hidden when `WLED_DISABLE_MQTT` (`xml.cpp:537-556`). Section shows a warning that MQTT and Hue connect to external hosts.

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Enable MQTT | `MQ` | checkbox (`:234`) | `set.cpp:515` |
| Broker | `MS` | text, maxlength set by xml to `MQTT_MAX_SERVER_LEN` (32) (`:235`, `xml.cpp:553-554`) | `set.cpp:516`. IP or hostname, no TLS. |
| Port | `MQPORT` | number 1-65535 (`:236`) | `set.cpp:517-518` |
| Username | `MQUSER` | text, maxlength 40 (`:239`) | `set.cpp:519` |
| Password | `MQPASS` | password, maxlength 64 (`:240`) | `set.cpp:520`; asterisk placeholder = unchanged (`xml.cpp:543-547`) |
| Client ID | `MQCID` | text, maxlength 40 (`:241`) | `set.cpp:521` |
| Device Topic | `MD` | text, maxlength 32 (`MQTT_MAX_TOPIC_LEN`) (`:242`) | `set.cpp:522`. Default `wled/<mac>`. |
| Group Topic | `MG` | text, maxlength 32 (`:243`) | `set.cpp:523`. Default `wled/all`. |
| Publish on button press | `BM` | checkbox (`:244`) | `set.cpp:524` → `buttonPublishMqtt` (stored in cfg as `hw.btn.mqtt`) |
| Retain brightness & color messages | `RT` | checkbox (`:245`) | `set.cpp:525` |

"Reboot required to apply changes." `initMqtt()` runs every 30 s and returns early if already connected (`wled.cpp:177-180`, `mqtt.cpp:197-209`), so enabling MQTT takes effect within 30 s, but changing broker/credentials while connected needs a reboot.

## Philips Hue (`#Hue`)

Hidden when `WLED_DISABLE_HUESYNC` (`xml.cpp:558-583`).

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Poll Hue light | `HL` | number 1-99 (`:256`) | `set.cpp:534-535` |
| every N ms | `HI` | number 100-65000 (`:256`) | `set.cpp:537-538` (accepts >50) |
| (enable polling) | `HP` | checkbox (`:256`) | `set.cpp:543` |
| Then, receive On/Off | `HO` | checkbox (`:257`) | `set.cpp:540` |
| Brightness | `HB` | checkbox | `set.cpp:541` |
| Color | `HC` | checkbox | `set.cpp:542` |
| Hue Bridge IP | `H0`..`H3` | 4 × number 0-255 (`:259-262`) | `set.cpp:529-532` |
| Hue status | read-only `.sip` | Inactive / Active / Unauthorized / Invalid light ID / Link button not pressed / JSON parsing error / Timeout / Bridge Error N (`xml.cpp:570-580`) | — |

Save calls `reconnectHue()` immediately (`set.cpp:544-545`). First-time pairing: press the bridge pushlink button, then save; the API key goes into wsec.json.

## Serial (`#Serial`)

Hidden unless `WLED_ENABLE_ADALIGHT` (default on, `wled.h:39`) (`xml.cpp:585-588`).

| Label | Field | Values | set.cpp |
|---|---|---|---|
| Baud rate | `BD` | select, value = baud/100: 1152, 2304, 4608, 5000, 5760, 9216, 10000, 15000 (`:275-284`) | `set.cpp:548-550`; range 96-15000; `updateBaudRate()` applied live. "Keep at 115200 to use Improv." |

## cfg.json mapping

`if.sync {port0, port1, espnow, recv {bri, col, fx, pal, grp, seg, sb}, send {en, dir, btn, va, hue, grp, ret}}`, `if.nodes {list, bcast}`, `if.live {en, mso, rlm, port, mc, timeout(/100), maxbri, no-gc, offset, dmx {uni, seqskip, e131prio, addr, dss, mode, inputRxPin, inputTxPin, inputEnablePin, dmxInputPort}}`, `if.va {alexa, macros[on,off], p}`, `id.inv`, `if.mqtt {en, broker, port, user, pskl, cid, rtn, topics {device, group}}`, `hw.btn.mqtt`, `if.hue {en, id, iv(/100), recv {on, bri, col}, ip[4]}`, `hw.baud` (`wled00/cfg.cpp:1106-1205`, `:1066`).

## Replacement notes

MVP scope (PRD §19): send sync, receive sync, sync groups, and the brightness/color/effects receive toggles. That maps to `SS` (and runtime `udpn.send`), `SD`, `SB`, `GS`, `GR`, `RB`, `RC`, `RX`, `RP`, plus optionally `SO`/`SG` (palette `RP` belongs with the others). Present groups as 8 send + 8 receive toggles and pack them into bitmasks.

Out of MVP: ports, ESP-NOW sync, retransmissions, Hue/Alexa send flags, realtime/E1.31/Art-Net/DDP, wired DMX input, Alexa, MQTT, Hue polling, serial baud. Escape hatch (§21) to `/settings/sync`.

Gotchas:

- The form POST resets every field on the page. Fields you omit become 0/false (checkboxes via `hasArg`, numbers via `toInt()` guarded only by range checks). If the replacement edits only MVP fields, either post every field back with its current value (read from `/json/cfg`) or use `POST /json/cfg` with just the `if.sync` subtree.
- Distinguish the persisted "Enable Sync on start" (`SS` / `if.sync.send.en`) from the runtime toggle (`udpn.send` in `/json/state`). The stock main UI's sync button only changes the runtime flag.
- "Receive sync" is `receiveGroups != 0`. A receive on/off switch in the replacement must remember the previous group mask to restore it.
- UDP sync sends on the device's own changes. If the replacement server changes several devices in the same group, each will also broadcast to the others; use `udpn.nn: true` on state requests to suppress a notification for that request (`json.cpp:432`).
- MQTT password and Hue key are never readable; show "set"/"not set" from `pskl`.
