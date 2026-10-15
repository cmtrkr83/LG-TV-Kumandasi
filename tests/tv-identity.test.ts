import { describe, expect, it } from "vitest";
import { resolveSameTv } from "../artifacts/netcast-remote/protocol/tvIdentity";

describe("resolveSameTv", () => {
  it("returns the same host only when the name also matches", () => {
    const stored = { host: "192.168.1.10", name: "Salon" };
    expect(
      resolveSameTv(
        [{ id: "uuid:abc", host: "192.168.1.10", name: "Salon" }],
        stored,
      )?.host,
    ).toBe("192.168.1.10");
    expect(
      resolveSameTv(
        [{ id: "uuid:abc", host: "192.168.1.10", name: "Yatak Odasi" }],
        stored,
      ),
    ).toBeNull();
  });

  it("falls back to a unique name match after DHCP change", () => {
    const stored = { host: "192.168.1.10", name: "Salon" };
    expect(
      resolveSameTv(
        [{ id: "uuid:abc", host: "192.168.1.42", name: "Salon" }],
        stored,
      )?.host,
    ).toBe("192.168.1.42");
  });

  it("never adopts a different or ambiguous TV", () => {
    const stored = { host: "192.168.1.10", name: "Salon" };
    expect(
      resolveSameTv(
        [{ id: "uuid:x", host: "192.168.1.42", name: "Mutfak" }],
        stored,
      ),
    ).toBeNull();
    expect(
      resolveSameTv(
        [
          { id: "uuid:1", host: "192.168.1.42", name: "Salon" },
          { id: "uuid:2", host: "192.168.1.43", name: "Salon" },
        ],
        stored,
      ),
    ).toBeNull();
    expect(resolveSameTv([], stored)).toBeNull();
  });
});
