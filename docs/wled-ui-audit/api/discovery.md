# WLED device discovery

Two mechanisms exist in firmware: mDNS/DNS-SD and a WLED-specific UDP broadcast. A server can use both.

## mDNS / DNS-SD

Set up in `WLED::initInterfaces()` (`wled00/wled.cpp:932-942`), which runs after the station interface connects:

```cpp
MDNS.begin(cmDNS);
MDNS.addService("http", "tcp", 80);
MDNS.addService("wled", "tcp", 80);
MDNS.addServiceTxt("wled", "tcp", "mac", escapedMac.c_str());
```

| Item | Value |
|---|---|
| Hostname | `<cmDNS>.local`. Default `wled-XXXXXX` where XXXXXX = last 6 hex chars of the MAC (`wled.cpp:594-595`); user-settable via `id.mdns` in config or the WiFi settings page (`cfg.cpp:55`, `set.cpp:108`). Max 32 chars. |
| Services | `_http._tcp` port 80 and `_wled._tcp` port 80 |
| TXT on `_wled._tcp` | `mac=<12 lowercase hex chars>` (same as `info.mac`, `wled.cpp:499-501`). No version, name or LED count. |
| Instance name | Library default (the hostname) |

Conditions and caveats:

- Not advertised if the mDNS name is set to an empty string (`wled.cpp:932`).
- Started only in `initInterfaces()`, i.e. after a station (or Ethernet) connection. A device running only its own AP does not advertise.
- ESP8266 needs `MDNS.update()` in the loop (`wled.cpp:166-168`); responsiveness can lag on busy devices.
- `_wled._tcp` is the reliable filter; `_http._tcp` also matches other devices.
- The TXT `mac` is a stable device key, more stable than IP or hostname. `info.deviceId` is another stable ID (json-info-and-lists.md).
- After discovery, call `GET /json/info` to get `name`, `ver`, `vid`, `leds.count`, `arch` for the discovery card.

Docker note: mDNS is link-local multicast (224.0.0.251:5353). A container on a bridge network will not see it; the server needs host networking or an mDNS reflector.

## UDP node broadcast ("Nodes")

### Sender

`sendSysInfoUDP()` (`wled00/udp.cpp:697-738`) broadcasts a 44-byte packet to `255.255.255.255:<udpPort2>` (default **65506**, `wled.h:682`). Sent:

- every 30 s from the main loop when `nodeBroadcastEnabled` (default true) (`wled.cpp:176-187`, `wled.h:422`);
- whenever global brightness changes in `stateUpdated()` (`led.cpp:164`).

Requires the supplemental UDP socket to be open (`udp2Connected`), which happens in `initInterfaces()` when `udpPort2` differs from `udpPort` and `udpRgbPort` (`wled.cpp:946-952`).

Packet layout:

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `255` (token) |
| 1 | 1 | `1` (packet ID) |
| 2 | 4 | IPv4 address (4.3.2.1 if not connected) |
| 6 | 32 | Device name (`serverDescription`), zero padded, not necessarily NUL-terminated |
| 38 | 1 | Bits 0-6: board type ID (`NodeStruct.h:11-32`; 82 ESP8266, 32 ESP32, 33 S2, 34 S3, 35 C3, 37+ newer). Bit 7: on (bri > 0). |
| 39 | 1 | Unit ID = last octet of the IP |
| 40 | 4 | Build number (`vid`), little-endian uint32 |

A server can bind UDP 65506 (with `SO_REUSEADDR`/broadcast receive) and passively collect devices on the same broadcast domain: IP, name, chip, on/off, firmware build. This is lighter than querying every device. It does not cross subnets or VLANs and does not work from a Docker bridge network.

### Receiver and `/json/nodes`

On receipt (`udp.cpp:526-554`), when `nodeListEnabled` (default true):

- Key is the **unit ID (last IP octet)**, so two devices with the same last octet on different subnets overwrite each other.
- Packets from the device's own IP are ignored.
- Max entries: 24 (ESP8266) / 150 (ESP32) (`const.h:700-705`).
- `refreshNodeList()` runs every 30 s, increments `age` and removes entries that reach 10 (about 5 minutes without a broadcast) (`udp.cpp:675-692`).

`GET /json/nodes` on any one WLED device returns its current list (`json.cpp:1092-1108`); `info.ndc` gives the count. Querying one known device is a cheap way to bootstrap discovery when mDNS is blocked, though the device omits itself.

## Other network surfaces (not discovery, but visible)

| Port | Protocol | Purpose |
|---|---|---|
| 80/tcp | HTTP + WS | API |
| 21324/udp | WLED sync notifier (`udpPort`, `wled.h:681`) | State sync between WLED devices; broadcast only if "send notifications" is on |
| 65506/udp | Node broadcast (`udpPort2`) | Above |
| 5568/udp | E1.31 | Realtime |
| 4048/udp | DDP | Realtime |
| 1900/udp | SSDP | Answered by Espalexa only when Alexa emulation is enabled |

Incoming sync notifications on 21324 could be sniffed for state changes, but only when the device has UDP send enabled; the WebSocket is the reliable change feed.
