import { describe, expect, it } from "vitest";
import {
  MAX_FONT_MULTIPLIER,
  getCommandAvailability,
} from "../artifacts/netcast-remote/boot/sessionRestore";

describe("command availability", () => {
  it("never queues power while unreachable", () => {
    expect(getCommandAvailability(false).enabled).toBe(true);
    expect(getCommandAvailability(false).statusKey).toBe(
      "status.storedTvSearching",
    );
    expect(getCommandAvailability(true).statusKey).toBe(
      "status.connectionReady",
    );
    expect(MAX_FONT_MULTIPLIER).toBe(1.2);
  });
});
