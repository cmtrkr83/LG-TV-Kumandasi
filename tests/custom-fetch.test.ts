import { describe, expect, it, vi } from "vitest";
import {
  ApiAbortError,
  ApiError,
  NetworkError,
  createApiClient,
  type FetchImplementation,
} from "../lib/api-client-react/src/custom-fetch";
import type { ProblemDetails } from "../lib/api-client-react/src/generated/api.schemas";

function response(body: string | null, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe("custom fetch client", () => {
  it("resolves relative URLs and adds auth only for the configured base origin", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: FetchImplementation = async (input, init) => {
      calls.push({ input, init });
      return response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient({
      baseUrl: "https://api.example.test/v1/",
      authTokenGetter: () => "token-1",
      fetch: fetcher,
    });

    await expect(client("/health", { responseType: "json" })).resolves.toEqual({
      ok: true,
    });
    expect(calls[0]?.input).toBe("https://api.example.test/v1/health");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("accept")).toContain("application/json");
  });

  it("does not send credentials to an untrusted absolute origin", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const authTokenGetter = vi.fn(() => "secret");
    const fetcher: FetchImplementation = async (input, init) => {
      calls.push({ input, init });
      return response("ok", { headers: { "content-type": "text/plain" } });
    };
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      authTokenGetter,
      trustedOrigins: ["https://trusted.example"],
      fetch: fetcher,
    });

    await expect(
      client("https://untrusted.example/data", { responseType: "text" }),
    ).resolves.toBe("ok");
    expect(calls[0]?.input).toBe("https://untrusted.example/data");
    expect(new Headers(calls[0]?.init?.headers).has("authorization")).toBe(
      false,
    );
    expect(authTokenGetter).not.toHaveBeenCalled();
  });

  it("pins a canonical URL before awaiting the auth getter", async () => {
    let releaseAuth!: () => void;
    let markAuthStarted!: () => void;
    const authGate = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const authStarted = new Promise<void>((resolve) => {
      markAuthStarted = resolve;
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      trustedOrigins: ["https://trusted.example"],
      authTokenGetter: async () => {
        markAuthStarted();
        await authGate;
        return "secret";
      },
      fetch: async (input, init) => {
        calls.push({ input, init });
        return response("ok", { headers: { "content-type": "text/plain" } });
      },
    });
    const mutableUrl = new URL("https://trusted.example/resource");

    const pending = client(mutableUrl, { responseType: "text" });
    await authStarted;
    mutableUrl.hostname = "attacker.example";
    mutableUrl.pathname = "/steal";
    releaseAuth();

    await expect(pending).resolves.toBe("ok");
    expect(calls[0]?.input).toBe("https://trusted.example/resource");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
  });

  it("canonicalizes surrounding whitespace before trust and fetch", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      trustedOrigins: ["https://trusted.example"],
      authTokenGetter: () => "secret",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return response("ok");
      },
    });

    await client(" https://trusted.example/a/../resource ", {
      responseType: "text",
    });

    expect(calls[0]?.input).toBe("https://trusted.example/resource");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
  });

  it.each([
    "https://trusted.example/\t/resource",
    "https://trusted.example/\n/resource",
    "https://trusted.example/\r/resource",
    "https//trusted.example/resource",
    "1https://trusted.example/resource",
  ])("rejects control characters and malformed schemes", async (input) => {
    const authTokenGetter = vi.fn(() => "secret");
    const fetcher = vi.fn<FetchImplementation>(async () => response("ok"));
    const client = createApiClient({
      baseUrl: "https://trusted.example",
      authTokenGetter,
      fetch: fetcher,
    });

    await expect(
      client(input, { responseType: "text" }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(authTokenGetter).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forces redirect errors even when the caller requests follow", async () => {
    const fetcher = vi.fn<FetchImplementation>(async () => response("ok"));
    const client = createApiClient({ fetch: fetcher });

    await expect(
      client("https://trusted.example/resource", {
        redirect: "follow",
        responseType: "text",
      }),
    ).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(
      "https://trusted.example/resource",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each(["text/plain", "text/html"])(
    "parses JSON error bodies sent as %s",
    async (contentType) => {
      const problem: ProblemDetails = {
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "The request could not be understood.",
        requestId: "request-1",
      };
      const client = createApiClient({
        fetch: async () =>
          response(JSON.stringify(problem), {
            status: 400,
            headers: { "content-type": contentType },
          }),
      });

      let failure: unknown;
      try {
        await client("/invalid");
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError<ProblemDetails>).data).toEqual(problem);
    },
  );

  it("parses error responses into ApiError", async () => {
    const client = createApiClient({
      fetch: async () =>
        response(JSON.stringify({ title: "Invalid", detail: "Bad input" }), {
          status: 422,
          statusText: "Unprocessable Entity",
          headers: { "content-type": "application/problem+json" },
        }),
    });

    const failure = client("/invalid", { responseType: "json" });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 422,
      data: { title: "Invalid", detail: "Bad input" },
    });
  });

  it("supports blob and no-body responses", async () => {
    const client = createApiClient({
      fetch: async (input) =>
        String(input).endsWith("/empty")
          ? response(null, { status: 204 })
          : response("blob", { headers: { "content-type": "image/png" } }),
    });

    await expect(client("/empty")).resolves.toBeNull();
    await expect(
      client("/image", { responseType: "blob" }),
    ).resolves.toBeInstanceOf(Blob);
  });

  it("wraps network and abort failures", async () => {
    const networkClient = createApiClient({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await expect(networkClient("/health")).rejects.toBeInstanceOf(NetworkError);

    const abortClient = createApiClient({
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(abortClient("/health")).rejects.toBeInstanceOf(ApiAbortError);
  });

  it("validates and updates base URL and auth getter", async () => {
    const fetcher = vi.fn<FetchImplementation>(async () => response("ok"));
    const client = createApiClient({ fetch: fetcher });

    expect(() => client.setBaseUrl("relative")).toThrow(TypeError);
    expect(() => client.setAuthTokenGetter("invalid" as never)).toThrow(
      TypeError,
    );
    client.setBaseUrl("https://api.example.test/");
    client.setTrustedOrigins("https://api.example.test");
    await expect(client("/health", { responseType: "text" })).resolves.toBe(
      "ok",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/health",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
