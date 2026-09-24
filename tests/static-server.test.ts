import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(
  repositoryRoot,
  "artifacts/netcast-remote/server/serve.js",
);
const canonicalOrigin = "https://example.test";
const startupAttempts = 3;
const startupTimeoutMs = 4_000;
const shutdownTimeoutMs = 2_000;
type TestProcess = ChildProcessByStdio<null, Readable, Readable>;

let child: TestProcess | undefined;
let staticRoot: string | undefined;

type RawResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

function isRunning(process: TestProcess) {
  return process.exitCode === null && process.signalCode === null;
}

function waitForReady(process: TestProcess) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Static server did not start: ${output}`));
    }, startupTimeoutMs);
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes("Serving static Expo build") && isRunning(process)) {
        cleanup();
        resolve();
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Static server exited before startup (${code ?? "null"}/${signal ?? "null"}): ${output}`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.stdout.off("data", onData);
      process.stderr.off("data", onData);
      process.off("error", onError);
      process.off("exit", onExit);
    };
    process.stdout.on("data", onData);
    process.stderr.on("data", onData);
    process.once("error", onError);
    process.once("exit", onExit);
  });
}

function waitForExit(process: TestProcess, timeoutMs = shutdownTimeoutMs) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Static server did not shut down gracefully"));
      }, timeoutMs);
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        resolve({ code, signal });
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        process.off("exit", onExit);
        process.off("error", onError);
      };
      process.once("exit", onExit);
      process.once("error", onError);
    },
  );
}

async function stopProcess(process: TestProcess) {
  if (!isRunning(process)) return;
  const gracefulExit = waitForExit(process).catch(() => undefined);
  process.kill("SIGTERM");
  await gracefulExit;
  if (!isRunning(process)) return;
  const forcedExit = waitForExit(process).catch(() => undefined);
  process.kill("SIGKILL");
  await forcedExit;
}

function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function isRetryableStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /EADDRINUSE|address already in use/i.test(message);
}

async function startStaticServer(root: string) {
  let lastError: unknown = new Error("Static server did not start");
  for (let attempt = 1; attempt <= startupAttempts; attempt += 1) {
    let port: number;
    try {
      port = await findFreePort();
    } catch (error) {
      lastError = error;
      if (attempt === startupAttempts) break;
      continue;
    }

    const serverProcess = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        BASE_PATH: "/",
        BIND_HOST: "127.0.0.1",
        PORT: String(port),
        PUBLIC_ORIGIN: canonicalOrigin,
        STATIC_ROOT: root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForReady(serverProcess);
      if (!isRunning(serverProcess)) {
        throw new Error("Static server exited after readiness");
      }
      return { port, process: serverProcess };
    } catch (error) {
      lastError = error;
      await stopProcess(serverProcess);
      if (attempt === startupAttempts || !isRetryableStartupError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function request(
  port: number,
  requestPath: string,
  headers: Record<string, string> = {},
) {
  return new Promise<RawResponse>((resolve, reject) => {
    const requestHandle = httpRequest(
      {
        agent: false,
        headers: {
          host: `127.0.0.1:${port}`,
          ...headers,
        },
        host: "127.0.0.1",
        method: "GET",
        path: requestPath,
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    requestHandle.once("error", reject);
    requestHandle.end();
  });
}

async function createStaticRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "lg-tv-static-"));
  for (const platform of ["ios", "android"]) {
    const assetDirectory = path.join(root, "_expo/static/js", platform);
    await mkdir(assetDirectory, { recursive: true });
    await mkdir(path.join(root, platform), { recursive: true });
    await writeFile(
      path.join(assetDirectory, "bundle.js"),
      `console.log(${JSON.stringify(platform)});\n`,
    );
    const manifest = {
      id: "test-app",
      createdAt: "2024-01-01T00:00:00.000Z",
      runtimeVersion: "1",
      launchAsset: {
        url: `${canonicalOrigin}/_expo/static/js/${platform}/bundle.js`,
        contentType: "application/javascript",
        key: "bundle",
      },
      assets: [],
      metadata: {},
    };
    await writeFile(
      path.join(root, platform, "manifest.json"),
      JSON.stringify(manifest),
    );
  }
  return root;
}

afterEach(async () => {
  if (child) {
    await stopProcess(child);
    child = undefined;
  }
  if (staticRoot) {
    await rm(staticRoot, { recursive: true, force: true });
    staticRoot = undefined;
  }
});

describe("static server child-process smoke test", () => {
  it("rejects unsafe requests, serves security headers, caches assets, and shuts down", async () => {
    staticRoot = await createStaticRoot();
    const started = await startStaticServer(staticRoot);
    const { port, process: serverProcess } = started;
    child = serverProcess;

    const landing = await request(port, "/");
    expect(landing.status).toBe(200);
    expect(landing.headers["content-type"]).toContain("text/html");
    expect(landing.headers["cache-control"]).toContain("no-store");
    expect(landing.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(landing.headers["x-content-type-options"]).toBe("nosniff");
    expect(landing.headers["x-frame-options"]).toBe("DENY");

    const manifest = await request(port, "/manifest", {
      "expo-platform": "android",
    });
    expect(manifest.status).toBe(200);
    expect(manifest.headers["cache-control"]).toContain("no-store");
    expect(manifest.headers["expo-protocol-version"]).toBe("1");

    const asset = await request(port, "/_expo/static/js/android/bundle.js");
    expect(asset.status).toBe(200);
    expect(asset.body).toContain("android");
    expect(asset.headers["content-type"]).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );

    const malformedHost = await request(port, "/", {
      host: "bad host",
    });
    expect(malformedHost.status).toBe(400);

    const traversal = await request(port, "/%2e%2e%2fsecret.txt");
    expect(traversal.status).toBe(400);

    const exitPromise = waitForExit(serverProcess);
    expect(serverProcess.kill("SIGTERM")).toBe(true);
    await expect(exitPromise).resolves.toEqual({ code: 0, signal: null });
  });
});
