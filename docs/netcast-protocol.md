---
name: NetCast protocol coverage
description: Compatibility boundary for network control of older LG NetCast televisions.
---

The network-control implementation targets LG NetCast 3.0 and 4.0 using the ROAP HTTP/XML API on port 8080. LG models released before 2012 may use the separate HDCP protocol and should not be assumed compatible with ROAP. NetCast SSDP responses may identify themselves only with `udap:rootservice`, `/udap/api/`, or a model code rather than a literal LG brand string.

**Why:** LG published distinct control protocols across NetCast generations, and its discovery responses are less brand-explicit than modern TV protocols.

**How to apply:** Keep ROAP/NetCast 3ÔÇô4 as the default path; add model/year detection or a dedicated HDCP transport before claiming support for pre-2012 devices.

SSDP discovery uses a native Expo UDP module, so the scan is unavailable in standard Expo Go and must be exercised with a development build on a physical device. Android builds need multicast Wi-Fi permissions, while cleartext HTTP for ROAP is configured through Expo build properties.

**Why:** Raw multicast sockets are not included in Expo Go, and Android network policy otherwise blocks either SSDP discovery or the TVÔÇÖs local HTTP endpoint.

**How to apply:** Keep the manual IP path available as a fallback, and test discovery on physical hardware rather than an Android emulator or browser preview.

## Mouse / touchpad control

Pointer control reuses the same ROAP session as the keys (`POST /roap/api/command`). Payload shape mirrors ConnectSDK's `NetcastTVService` UDAP params mapped into the ROAP `<command>` envelope:

- Move: `<type>HandleTouchMove</type><x>dx</x><y>dy</y>` — relative deltas as integers; coalesce and flush at ~80ms intervals instead of sending every touch event.
- Click: `<type>HandleTouchClick</type>`
- Scroll: `<type>HandleTouchWheel</type><value>up|down</value>`

The TV summons the cursor on first movement, so no separate cursor-visibility call is needed. Verified against ConnectSDK `Connect-SDK-Android-Core` (`NetcastTVService.java`, `getUDAPMessageBody`). Key codes reference: `b-jesch/service.lgtv.remote` `KEYCODES.LG` (ROAP section) — e.g. Quick Menu `405`, Program/Channel List `50`, EPG `44`, Info `45`, Exit `412`.
