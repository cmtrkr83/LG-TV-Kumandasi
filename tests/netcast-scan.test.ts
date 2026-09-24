import { describe, expect, it } from "vitest";
import { getSafeScanHosts } from "../artifacts/netcast-remote/protocol/scan";

describe("NetCast subnet scan planning", () => {
  it("limits private subnet candidates and excludes the local host", () => {
    const hosts = getSafeScanHosts("192.168.1.50", 5);

    expect(hosts).toEqual([
      "192.168.1.48",
      "192.168.1.49",
      "192.168.1.51",
      "192.168.1.52",
    ]);
    expect(hosts).not.toContain("192.168.1.50");
  });

  it("uses a bounded default and handles address boundaries", () => {
    const hosts = getSafeScanHosts("192.168.1.1");
    expect(hosts.length).toBeLessThanOrEqual(32);
    expect(hosts).not.toContain("192.168.1.1");
    expect(
      getSafeScanHosts("10.0.0.255").every((host) =>
        host.startsWith("10.0.0."),
      ),
    ).toBe(true);
  });

  it("rejects public, unspecified, and malformed local addresses", () => {
    expect(getSafeScanHosts("8.8.8.8")).toEqual([]);
    expect(getSafeScanHosts("0.0.0.0")).toEqual([]);
    expect(getSafeScanHosts("not-an-ip")).toEqual([]);
  });
});
