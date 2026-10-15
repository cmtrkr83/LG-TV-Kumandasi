import { describe, expect, it } from "vitest";
import {
  BOOT_RETRY_DELAYS_MS,
  isRetryableRestoreError,
  shouldShowRemoteShell,
} from "../artifacts/netcast-remote/boot/sessionRestore";

describe("session restore", () => {
  it("shows remote shell when a stored host exists", () => {
    expect(shouldShowRemoteShell("ready", true)).toBe(true);
    expect(shouldShowRemoteShell("invalid", true)).toBe(true);
    expect(shouldShowRemoteShell("missing", false)).toBe(false);
  });

  it("retries transient but never auth", () => {
    expect(isRetryableRestoreError("transient")).toBe(true);
    expect(isRetryableRestoreError("auth")).toBe(false);
    expect(BOOT_RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
  });
});
