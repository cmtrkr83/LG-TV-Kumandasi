import { describe, expect, it } from "vitest";
import { resolveSameTv } from "../artifacts/netcast-remote/protocol/tvIdentity";

describe("resolveSameTv", () => {
  it("prefers USN match over host and falls back to name", () => {
    const stored = { host: "192.168.1.10", name: "Salon" };
    expect(
      resolveSameTv([{ id: "uuid:abc", host: "192.168.1.42", name: "Salon" }], stored)?.host,
    ).toBe("192.168.1.42");
    expect(resolveSameTv([], stored)).toBeNull();
  });
});
