import { describe, expect, it } from "vitest";
import { LANGUAGE_TOGGLE_METRICS } from "../artifacts/netcast-remote/components/languageToggleMetrics";

describe("language toggle metrics", () => {
  it("stays compact so the header dot never touches it", () => {
    expect(LANGUAGE_TOGGLE_METRICS.containerMinHeight).toBeLessThanOrEqual(36);
    expect(LANGUAGE_TOGGLE_METRICS.optionMinWidth).toBeLessThanOrEqual(32);
    expect(LANGUAGE_TOGGLE_METRICS.optionMinHeight).toBeLessThanOrEqual(32);
  });
});
