---
name: NetCast protocol coverage
description: Compatibility boundary for network control of older LG NetCast televisions.
---

The network-control implementation targets LG NetCast 3.0 and 4.0 using the ROAP HTTP/XML API on port 8080. LG models released before 2012 may use the separate HDCP protocol and should not be assumed compatible with ROAP.

**Why:** LG published distinct control protocols across NetCast generations, so a successful pairing flow cannot be generalized to every older LG TV.

**How to apply:** Keep ROAP/NetCast 3–4 as the default path; add model/year detection or a dedicated HDCP transport before claiming support for pre-2012 devices.

SSDP discovery uses a native Expo UDP module, so the scan is unavailable in standard Expo Go and must be exercised with a development build on a physical device. Android builds need multicast Wi-Fi permissions, while cleartext HTTP for ROAP is configured through Expo build properties.

**Why:** Raw multicast sockets are not included in Expo Go, and Android network policy otherwise blocks either SSDP discovery or the TV’s local HTTP endpoint.

**How to apply:** Keep the manual IP path available as a fallback, and test discovery on physical hardware rather than an Android emulator or browser preview.