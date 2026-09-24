import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NetcastRequestError,
  createSession,
  escapeXml,
  extractNetCastName,
  getXml,
  isAuthError,
  isTransientError,
  isUnsupportedError,
  isValidTvHost,
  normalizeHost,
  requestPairingKey,
  tvUrl,
  xmlValue,
} from "../artifacts/netcast-remote/protocol/netcast";

function mockFetch(result: Response | Error) {
  const fetchMock = vi.fn(
    async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      if (result instanceof Error) throw result;
      return result.clone();
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NetCast protocol", () => {
  it("validates and normalizes TV hosts and builds ROAP URLs", () => {
    expect(isValidTvHost("192.168.1.20")).toBe(true);
    expect(isValidTvHost("living-room.lan")).toBe(true);
    expect(isValidTvHost("http://192.168.1.20")).toBe(false);
    expect(isValidTvHost("bad_host")).toBe(false);
    expect(isValidTvHost("fd00::1")).toBe(true);
    expect(isValidTvHost("0.0.0.0")).toBe(false);
    expect(isValidTvHost("192.168.1.20:8080")).toBe(false);
    expect(normalizeHost("  tv.example.local  ")).toBe("tv.example.local");
    expect(normalizeHost("bad host")).toBe("");
    expect(tvUrl("fd00::1", "auth")).toBe(
      "http://[fd00::1]:8080/roap/api/auth",
    );
  });

  it("parses XML values and escapes untrusted text", () => {
    expect(escapeXml(`<&"'>`)).toBe("&lt;&amp;&quot;&apos;&gt;");
    expect(
      xmlValue("<root><session> session-42 </session></root>", "session"),
    ).toBe("session-42");
    expect(extractNetCastName("<friendlyName>Living Room</friendlyName>")).toBe(
      "Living Room",
    );
    expect(extractNetCastName("<root>UDAP</root>")).toBe("LG NetCast TV");
  });

  it("creates a session from a valid pairing response", async () => {
    const fetchMock = mockFetch(
      new Response("<response><session>session-42</session></response>", {
        status: 200,
      }),
    );

    await expect(createSession("192.168.1.20", "pair-key")).resolves.toBe(
      "session-42",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://192.168.1.20:8080/roap/api/auth");
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain("<value>pair-key</value>");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/atom+xml",
    );
  });

  it("maps authentication and network failures to typed errors", async () => {
    mockFetch(new Response("denied", { status: 401 }));
    const authFailure = createSession("192.168.1.20", "bad-key");
    await expect(authFailure).rejects.toMatchObject({
      name: "NetcastRequestError",
      kind: "auth",
      status: 401,
    });
    await expect(authFailure).rejects.toSatisfy(isAuthError);

    mockFetch(new Error("offline"));
    const networkFailure = getXml("http://192.168.1.20:8080/roap/api/data");
    await expect(networkFailure).rejects.toMatchObject({
      name: "NetcastRequestError",
      kind: "network",
    });
    await expect(networkFailure).rejects.toSatisfy(isTransientError);
  });

  it("separates unsupported responses from transient server failures", async () => {
    mockFetch(new Response("unsupported", { status: 404 }));
    const unsupported = getXml("http://192.168.1.20:8080/roap/api/command");
    await expect(unsupported).rejects.toSatisfy(isUnsupportedError);

    mockFetch(new Response("busy", { status: 503 }));
    const transientFailure = getXml(
      "http://192.168.1.20:8080/roap/api/command",
    );
    await expect(transientFailure).rejects.toSatisfy(isTransientError);
  });

  it("aborts a request that exceeds the ROAP timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = getXml("http://192.168.1.20:8080/roap/api/data");
    const expectation = expect(pending).rejects.toMatchObject({
      name: "NetcastRequestError",
      kind: "timeout",
    });
    await vi.advanceTimersByTimeAsync(8000);

    await expectation;
  });

  it("sends the pairing request with the expected content type", async () => {
    const fetchMock = mockFetch(new Response("ok", { status: 200 }));
    await expect(requestPairingKey("tv.example.local")).resolves.toBe("ok");
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toContain("<type>AuthKeyReq</type>");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/atom+xml",
    );
  });

  it("rejects a missing session response as an authentication error", async () => {
    mockFetch(new Response("<response />", { status: 200 }));
    await expect(createSession("192.168.1.20", "pair-key")).rejects.toEqual(
      expect.objectContaining<Partial<NetcastRequestError>>({
        kind: "auth",
      }),
    );
  });
});
