import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

type QueryString = {
  parse(value: string): Record<string, string>;
};

describe("patched dependency compatibility", () => {
  it("keeps query-string CommonJS decoding compatible with the security fix", () => {
    const netcastRequire = createRequire(
      path.resolve(process.cwd(), "artifacts/netcast-remote/package.json"),
    );
    const expoRouterRequire = createRequire(
      netcastRequire.resolve("expo-router/package.json"),
    );
    const queryString = expoRouterRequire("query-string") as QueryString;

    expect(queryString.parse("room=Living%20Room")).toEqual({
      room: "Living Room",
    });
  });
});
