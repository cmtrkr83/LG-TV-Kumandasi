import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../artifacts/api-server/src/app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("API app", () => {
  it("serves liveness and readiness responses", async () => {
    const live = await fetch(`${baseUrl}/api/healthz`);
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ status: "ok" });

    const ready = await fetch(`${baseUrl}/api/readyz`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "not_checked" },
    });
  });

  it("returns problem details for unknown routes and malformed JSON", async () => {
    const missing = await fetch(`${baseUrl}/api/missing`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(missing.json()).resolves.toMatchObject({
      status: 404,
      title: "Not Found",
    });

    const malformed = await fetch(`${baseUrl}/api/healthz`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      status: 400,
      title: "Bad Request",
    });
  });

  it("allows the configured local origin and omits disallowed origins", async () => {
    const allowed = await fetch(`${baseUrl}/api/healthz`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );

    const disallowed = await fetch(`${baseUrl}/api/healthz`, {
      headers: { origin: "https://untrusted.example" },
    });
    expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects wildcard CORS configuration at startup", async () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "*");
    vi.resetModules();

    try {
      await expect(import("../artifacts/api-server/src/app")).rejects.toThrow(
        /CORS wildcard origins are not supported/,
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
