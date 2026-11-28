# WiFi & Network Settings (`settings_wifi.htm`)

Source: `wled00/data/settings_wifi.htm`. Loaded at `/settings/wifi`, values injected by `GET /settings/s.js?p=1` (`wled00/xml.cpp:221-334`), saved by `POST /settings/wifi` → `handleSettingsSet(SUBPAGE_WIFI)` (`wled00/set.cpp:25-173`). General load/save mechanics are covered in the LED/mechanism audit; this file lists fields only.

Page title: "WiFi & Network Settings". Submit button reads "Save & Connect" (`wled00/data/settings_wifi.htm:212`).

## Access rules specific to this page

- If both `wifiLock` ("Deny access to WiFi settings if locked", Security page) and `otaLock` are set, GET and POST of this page return 401 "Access denied" (`wled00/wled_server.cpp:780-783`, `:791`).
- PIN: when a settings PIN is set and WiFi is already configured, this page requires the PIN like every other page. When WiFi is *not* configured, the WiFi page is exempt from the PIN so first-time setup works (`wled00/wled_server.cpp:773`).
- POST is rejected with 401 unless the client is in the local subnet (`wled00/wled_server.cpp:786-789`).
- After save the device serves a message page "WiFi settings saved. Please connect to the new IP (if changed)" with a 9-second redirect (`wled00/wled_server.cpp:797`, `:820-821`).

## Section: Wireless network (multiple networks)

WLED stores up to `WLED_MAX_WIFI_COUNT` = 3 client networks (`wled00/const.h:53-54`). On connect it scans and picks the strongest configured SSID (`findWiFi()`, called from `wled00/wled.cpp:979`). xml.cpp emits `resetWiFi(3)` and one `addWiFi(...)` call per stored network (`wled00/xml.cpp:224-251`). The rows are built entirely by JS (`addWiFi()`, `wled00/data/settings_wifi.htm:117-145`); none of these inputs exist in static HTML.

`+` / `-` buttons (`wifi_add`, `wifi_rem`, `wled00/data/settings_wifi.htm:221-222`) add/remove the last row. `+` hides at 3 rows, `-` hides at 1 row (`btnWiFi()`, `:113-116`).

Per-network fields, `i` = 0..2:

| Label | Field name | Type / range | Visibility | set.cpp handling |
|---|---|---|---|---|
| Network name (SSID) ("empty to not connect" on row 0) | `CS{i}` | text, maxlength 32; `required` on rows 1-2 | always | `set.cpp:46-49`. Copied to `multiWiFi[n].clientSSID`. Changing SSID (or old SSID empty) sets `forceReconnect`. A row is only stored if `CS{i}` is present in the POST (`:40`). |
| WiFi encryption type | `ET{i}` | select: 0 None/WPA/WPA2, 1 WPA/WPA2-Enterprise | only rendered when firmware built with `WLED_ENABLE_WPA_ENTERPRISE` (xml passes the type arg only then, `xml.cpp:233-243`; JS renders it only if `type` is 0/1, `settings_wifi.htm:121`) | `set.cpp:67-92`. Change sets `forceReconnect`. |
| Anonymous identity | `EA{i}` | text, maxlength 64 | enterprise build and `ET{i}`=1 (`E(i)`, `settings_wifi.htm:197-204`) | `set.cpp:73`. Cleared when PSK. |
| Identity | `EI{i}` | text, maxlength 64 | same as above | `set.cpp:74`. Cleared when PSK. |
| Network password | `PW{i}` | password, maxlength 64 | always | `set.cpp:50-53`. Server pre-fills with `*` repeated to the stored password length (`xml.cpp:227-230`). An all-asterisk value is treated as "unchanged" (`isAsterisksOnly`). Any other value replaces the password and sets `forceReconnect`. |
| BSSID (optional) | `BS{i}` | text, 12 hex chars, no colons | always | `set.cpp:54-57` via `fillStr2MAC`. Change sets `forceReconnect`. Pins connection to a specific AP. |
| Static IP ("leave at 0.0.0.0 for DHCP"; row 0 says "Also used by Ethernet") | `IP{i}0`..`IP{i}3` | 4 number inputs 0-255, required | always | `set.cpp:58-65`. Does **not** set `forceReconnect`. Static config is only applied if both IP and gateway are non-zero (`wled.cpp:792-793`). |
| Static gateway | `GW{i}0`..`GW{i}3` | 4 × 0-255 | always | `set.cpp:58-65`. No reconnect. |
| Static subnet mask | `SN{i}0`..`SN{i}3` | 4 × 0-255, default 255.255.255.0 | always | `set.cpp:58-65`. No reconnect. |

The JS packs/unpacks IPs as little-endian uint32 (`settings_wifi.htm:117`, `:138-142`).

Rows not present in the POST are deleted: after the loop, `multiWiFi` is truncated to the number of `CS{i}` received (`set.cpp:97-102`). If row 0's SSID is empty the device treats WiFi as unconfigured and goes to AP mode.

### Scan button

`Scan` (`settings_wifi.htm:217`) calls `N()` (`:20-95`), which polls `GET /json/net` up to 10 times at 1 s intervals until results arrive. Server side, the first call starts an async scan and returns an empty list; a later call returns `[{ssid, rssi, bssid, channel, enc}]` and clears the scan (`wled00/json.cpp:1060-1090`). The JS sorts by RSSI, de-dupes by SSID, and replaces each `CS{i}` text input that is empty, still "Your_Network", or whose SSID appears in results with a `<select>` of the form `SSID (rssi dBm, Ch n)` plus "Other network..." (value `!Cs`). Choosing "Other network..." swaps it back to a text input (`T()`, `:97-106`). Scanning does not disconnect the device but adds load; on 5 GHz-capable chips it re-applies the band mode before scanning (`json.cpp:1067-1069`).

## Section: Ethernet Type

Container `#ethd` (`settings_wifi.htm:225-245`). Hidden by xml.cpp unless the build is ESP32 with `WLED_USE_ETHERNET` (`xml.cpp:298-303`).

| Label | Field | Values | set.cpp |
|---|---|---|---|
| Ethernet Type | `ETH` | select: 0 None, 1 WT32-ETH01, 2 ESP32-POE, 3 WESP32, 4 QuinLED Uno/Quad, 5 TwilightLord-ESP32, 6 IoTorero/ESP32Deux/RGB2Go, 7 KIT-VE, 8 QuinLED Octa & T-ETH-POE, 9 ABC! WLED V43, 10 Serg74-ETH32, 11 ESP32-POE-WROVER, 12 LILYGO T-POE Pro, 13 Gledopto, 14 QuinLED v4 Uno/Quad, 15 QuinLED v4 Octa (`settings_wifi.htm:227-244`) | `set.cpp:169-172`: sets `ethernetType`, calls `initEthernet()`. `initEthernet()` only succeeds once per boot (`wled00/network.cpp:198-203`), so changing type after a successful init needs a reboot. Selecting a board reserves its pins (shown as reserved on the LED page, `xml.cpp:134-152`). |

Ethernet uses row 0's static IP settings.

## Section: DNS & mDNS

| Label | Field | Type | set.cpp |
|---|---|---|---|
| DNS server address | `D0`..`D3` | 4 × 0-255, required (`settings_wifi.htm:249`) | `set.cpp:104-106`. Only used when a static IP is configured (`wled.cpp:793`). No reconnect. |
| mDNS address (`http://____.local`, empty = no mDNS) | `CM` | text, maxlength 32 (`:252`) | `set.cpp:108`. No reconnect. Also used as the DHCP hostname (`getWLEDhostname`, `wled.cpp:774`). `MDNS.begin()` only runs in `initInterfaces()` (`wled.cpp:931-941`), so a change takes effect on the next reconnect or reboot. Default is `wled-XXXXXX` derived from MAC. |
| Client IP | read-only span `.sip[0]` | filled with current IP, " (Ethernet)" suffix if wired, or "Not connected" (`xml.cpp:305-318`) | — |

## Section: Configure Access Point

| Label | Field | Type / range | set.cpp |
|---|---|---|---|
| AP SSID (empty = no AP) | `AS` | text, maxlength 32 (`settings_wifi.htm:257`) | `set.cpp:111-113`. If changed while AP is active, `forceReconnect`. |
| Hide AP name | `AH` | checkbox (`:258`) | `set.cpp:114`. Applies next time AP starts. |
| AP password (empty = open) | `AP` | password, maxlength 63, pattern empty or 8-63 chars (`:259`) | `set.cpp:115-119`. Pre-filled with asterisks. Empty clears it (open AP); 8+ non-asterisk chars replace it; 1-7 chars ignored. Any accepted change sets `forceReconnect`. |
| Access Point WiFi channel | `AC` | number 1-13, required (`:260`) | `set.cpp:120-122`. Different value sets `forceReconnect`. ESP-NOW in AP mode uses this channel (`wled.cpp:893`). |
| AP opens | `AB` | select: 0 No connection after boot (default), 1 Disconnected, 2 Always, 3 Never (not recommended), 4 Temporary (no connection after boot; closes after 5 min with no clients) (`:262-268`; constants `wled00/const.h:265-271`) | `set.cpp:110`. Read live by `handleConnection()` (`wled.cpp:1034-1040`, `:1094`), fully applied on next `initConnection()`. "Never" means the AP only opens via a 6-second button hold. |
| AP IP | read-only span `.sip[1]` | "4.3.2.1" style address or "Not active" (`xml.cpp:320-329`) | — |

AP IP is fixed at 4.3.2.1 (`wled.cpp:725`); it is not configurable.

## Section: WiFi Power

| Label | Field | Type / range | Visibility | set.cpp |
|---|---|---|---|---|
| Force 802.11g mode (ESP8266 only) | `FG` | checkbox (`settings_wifi.htm:273`) | always shown, only has effect on ESP8266 (`wled.cpp:769-771`) | `set.cpp:133`. Applied on next `initConnection()`. |
| Disable WiFi sleep | `WS` | checkbox (`:274`) | always | `set.cpp:134` → `noWifiSleep`. Applied on next `initConnection()` (`wled.cpp:870-875`). Stored inverted in cfg.json as `wifi.sleep`. |
| WiFi band | `BM` | select: 1 2.4 GHz only, 2 5 GHz only, 3 Auto (`:277-281`) | `#bm` hidden unless chip has `SOC_WIFI_SUPPORT_5G` (ESP32-C5 class) (`xml.cpp:268-272`) | `set.cpp:135-146`. Change sets `forceReconnect` and clears scan results. Note: `BM` is also a field name on the Sync page (MQTT "Publish on button press"); they are different forms. |
| Max. TX power | `TX` | select: 84=21 dBm, 82=20.5, 80=20, 78=19.5, 76=19, 74=18.5, 68=17, 60=15, 52=13, 44=11, 34=8.5, 28=7, 20=5, 8=2 dBm (values are quarter-dBm) (`:282-297`) | `#tx` hidden on ESP8266 (`xml.cpp:258-262`) | `set.cpp:124-131`. Clamped to 2 dBm..21 dBm (IDF5) or 19.5 dBm (IDF4). No reconnect; applied on next `initConnection()`/`initAP()`. UI warns "Modifying TX power may render device unreachable." |

## Section: ESP-NOW Wireless

`#ESPNOW` block; replaced by "This firmware build does not include ESP-NOW support" when built with `WLED_DISABLE_ESPNOW` (`xml.cpp:288-296`).

| Label | Field | Type | set.cpp |
|---|---|---|---|
| Enable ESP-NOW | `RE` | checkbox, `onchange=tE()` toggles `#rlc` (`settings_wifi.htm:307`, `:162-165`) | `set.cpp:149-151`. Toggling sets `forceReconnect`. Required for wireless remotes (WiZmote etc.) and for ESP-NOW sync on the Sync page. |
| Last device seen | read-only `#ld` (`.rlid`) | MAC of last ESP-NOW sender, filled by xml (`xml.cpp:331-335`) | — |
| `+` button | — | adds `#ld` text as a new linked MAC (`settings_wifi.htm:312`); hidden at 10 entries | — |
| Linked MACs (10 max) | `RM0`..`RM9` | dynamic text inputs, exactly 12 hex chars, each with a `-` remove button (`aR()`, `:171-196`; xml emits `rstR()` then `aR("RMn", mac)` per stored remote, `xml.cpp:280-284`) | `set.cpp:152-166`. List is cleared and rebuilt from `RM0`..`RM9`; lowercased; empty ignored. |

Bug to be aware of: `aR()` names new rows `'RM'+rC` where `rC` only ever increments (`settings_wifi.htm:194`). After deleting and re-adding with 10 loaded entries, a new row can be named `RM10`+, which set.cpp ignores (`set.cpp:153`).

## Reboot / apply summary

| Change | Effect |
|---|---|
| SSID, password, BSSID, enterprise fields, AP SSID (while AP active), AP password, AP channel, band, ESP-NOW toggle | `forceReconnect` → device drops WiFi and reconnects within one loop (`wled.cpp:977-983`). Interfaces (mDNS, UDP, E1.31) re-init after reconnect. |
| Static IP/GW/SN, DNS, mDNS name, TX power, WiFi sleep, 802.11g, AP hide, AP behavior | Stored, but not applied until the next reconnect or reboot, unless another field in the same save triggers `forceReconnect`. |
| Ethernet type | Reboot needed if Ethernet was already initialized. |

cfg.json keys (for `/json/cfg`): `nw.ins[] {ssid, pskl, bssid, ip[4], gw[4], sn[4], enc_type, e_anon_ident, e_ident}`, `nw.dns[4]`, `nw.espnow`, `nw.linked_remote[]`, `id.mdns`, `ap {ssid, pskl, chan, hide, behav, ip}`, `wifi {sleep (inverted), phy, band, txpwr}`, `eth.type` (`wled00/cfg.cpp:858-930`). Passwords live in `/wsec.json`, never returned (`cfg.cpp:1282-1380`); `pskl` is the stored length only.

## Replacement notes

MVP scope (PRD §18): device name (that lives on the UI page as `DS`, see `ui.md`), hostname (`CM`), SSID/password, AP settings "where straightforward". Reasonable MVP set: network rows 0-2 (`CS`, `PW`, optional static IP/GW/SN), `CM`, `AS`, `AP`, `AB`, `AC`. Out of scope for MVP: Ethernet type, TX power, band, 802.11g, enterprise auth, ESP-NOW remotes, BSSID pinning. Link those to the stock page via the §21 escape hatch.

Gotchas:

- Disconnect risk is real and immediate. Any SSID/password/AP/channel/band/ESP-NOW change forces a reconnect in the same request cycle; the HTTP response may or may not arrive. Show the PRD warning and expect the device to come back on a different IP (or not at all if credentials are wrong; it then opens the AP per `AB`). After saving, re-resolve the device by mDNS name / MAC rather than the old IP.
- Setting `AB` = 3 (Never) plus a bad password can strand the device until a 6-second button press. Warn or hide that option.
- Static IP changes alone do not reconnect. Either send them together with a reconnect trigger, or follow up with a reboot (`POST /json/state {"rb":true}`).
- Posting the form deletes any network row you omit. Always post all rows you intend to keep.
- To leave a password unchanged, post the asterisk placeholder (same as the stock UI does) or omit the field from `/json/cfg`. Posting an empty `PW{i}` via the form sets an empty password.
- Prefer the form POST over `POST /json/cfg` for WiFi: `deserializeConfig()` never sets `forceReconnect` (`cfg.cpp:84-122`), never removes rows, and resets static IP to 0.0.0.0 for any `nw.ins[]` entry that omits `ip`/`gw`/`sn` (`cfg.cpp:98-108`).
- The PIN exemption only applies before WiFi is configured. With a PIN set, the server must unlock first (see `security-backup.md`).
