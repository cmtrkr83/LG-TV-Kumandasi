---
name: Expo host DevTools warning
description: Headless Expo workflow behavior when React Native DevTools cannot load a host shared library.
---

Expo Metro can still serve the mobile development build when the optional React Native DevTools process fails because the host lacks `libglib-2.0.so.0`.

**Why:** The DevTools process is separate from Metro and is not required for bundling or opening the Expo app.

**How to apply:** Treat this specific startup message as non-blocking when Metro reports its QR/dev URL and the app preview loads; do not change app dependencies solely to fix the host tool.