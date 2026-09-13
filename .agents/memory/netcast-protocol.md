---
name: NetCast protocol coverage
description: Compatibility boundary for network control of older LG NetCast televisions.
---

The network-control implementation targets LG NetCast 3.0 and 4.0 using the ROAP HTTP/XML API on port 8080. LG models released before 2012 may use the separate HDCP protocol and should not be assumed compatible with ROAP.

**Why:** LG published distinct control protocols across NetCast generations, so a successful pairing flow cannot be generalized to every older LG TV.

**How to apply:** Keep ROAP/NetCast 3–4 as the default path; add model/year detection or a dedicated HDCP transport before claiming support for pre-2012 devices.