import { beforeEach, describe, expect, it } from "vitest";
import { asyncStorageState } from "./helpers/async-storage-mock";
import { secureStoreState } from "./helpers/secure-store-mock";
import {
  CONNECTION_STORAGE_KEY,
  CONNECTION_STORAGE_VERSION,
  SECURE_CONNECTION_KEY,
  SECURE_TOKEN_KEY,
  StorageError,
  clearPersistedConnection,
  loadPersistedConnection,
  parseCanonicalConnection,
  parseStoredConnection,
  savePersistedConnection,
} from "../artifacts/netcast-remote/storage/connectionStorage";

beforeEach(() => {
  asyncStorageState.values.clear();
  secureStoreState.values.clear();
  asyncStorageState.failures.get = false;
  asyncStorageState.failures.set = false;
  asyncStorageState.failures.remove = false;
  secureStoreState.failures.get = false;
  secureStoreState.failures.set = false;
  secureStoreState.failures.delete = false;
});

describe("NetCast connection storage", () => {
  it("parses and normalizes persisted metadata", () => {
    expect(
      parseStoredConnection(
        JSON.stringify({
          host: " 192.168.1.20 ",
          name: "  Living Room  ",
          accessToken: " legacy-token ",
          session: "old-session",
        }),
      ),
    ).toEqual({
      hasLegacyFields: true,
      host: "192.168.1.20",
      legacyToken: "legacy-token",
      name: "Living Room",
    });
  });

  it("reports missing and invalid persisted data", async () => {
    await expect(loadPersistedConnection()).resolves.toEqual({
      status: "missing",
    });

    asyncStorageState.values.set(CONNECTION_STORAGE_KEY, "not-json");
    await expect(loadPersistedConnection()).resolves.toEqual({
      status: "invalid",
    });
  });

  it("migrates a legacy token into SecureStore and removes it from metadata", async () => {
    asyncStorageState.values.set(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({
        host: "192.168.1.20",
        name: "Living Room",
        accessToken: " legacy-token ",
        session: "old-session",
      }),
    );

    await expect(loadPersistedConnection()).resolves.toMatchObject({
      status: "ready",
      connection: {
        host: "192.168.1.20",
        accessToken: "legacy-token",
        name: "Living Room",
      },
    });
    expect(secureStoreState.values.get(SECURE_CONNECTION_KEY)).toBe(
      JSON.stringify({
        version: 3,
        host: "192.168.1.20",
        accessToken: "legacy-token",
        name: "Living Room",
      }),
    );
    expect(secureStoreState.values.has(SECURE_TOKEN_KEY)).toBe(false);
    expect(asyncStorageState.values.has(CONNECTION_STORAGE_KEY)).toBe(false);
  });

  it("returns a warning when secure storage is unavailable", async () => {
    asyncStorageState.values.set(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        host: "tv.example.local",
        accessToken: "legacy-token",
      }),
    );
    secureStoreState.failures.get = true;

    const result = await loadPersistedConnection();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a ready result");
    expect(result.warning).toBeInstanceOf(StorageError);
    expect(result.warning?.operation).toBe("secure-read");
  });

  it("saves credentials separately from metadata and reports failures", async () => {
    await expect(
      savePersistedConnection({ host: "bad host", accessToken: "token" }),
    ).resolves.toMatchObject({
      stored: false,
      warning: expect.any(StorageError),
    });

    await expect(
      savePersistedConnection({
        host: "192.168.1.20",
        accessToken: " token ",
        name: "TV",
      }),
    ).resolves.toEqual({ stored: true });
    expect(secureStoreState.values.get(SECURE_CONNECTION_KEY)).toBe(
      JSON.stringify({
        version: 3,
        host: "192.168.1.20",
        accessToken: "token",
        name: "TV",
      }),
    );
    expect(secureStoreState.values.has(SECURE_TOKEN_KEY)).toBe(false);
    expect(asyncStorageState.values.has(CONNECTION_STORAGE_KEY)).toBe(false);

    secureStoreState.failures.set = true;
    const result = await savePersistedConnection({
      host: "192.168.1.21",
      accessToken: "token-2",
    });
    expect(result.stored).toBe(false);
    expect(result.warning?.operation).toBe("secure-write");
  });

  it("clears both storage backends", async () => {
    asyncStorageState.values.set(CONNECTION_STORAGE_KEY, "metadata");
    secureStoreState.values.set(SECURE_CONNECTION_KEY, "canonical");
    secureStoreState.values.set(SECURE_TOKEN_KEY, "token");

    await expect(clearPersistedConnection()).resolves.toBeUndefined();
    expect(asyncStorageState.values.has(CONNECTION_STORAGE_KEY)).toBe(false);
    expect(secureStoreState.values.has(SECURE_CONNECTION_KEY)).toBe(false);
    expect(secureStoreState.values.has(SECURE_TOKEN_KEY)).toBe(false);
  });

  it("loads the canonical record and removes leftover plaintext", async () => {
    secureStoreState.values.set(
      SECURE_CONNECTION_KEY,
      JSON.stringify({
        version: CONNECTION_STORAGE_VERSION,
        host: "192.168.1.20",
        accessToken: "secure-token",
        name: "TV",
      }),
    );
    asyncStorageState.values.set(CONNECTION_STORAGE_KEY, "legacy-plaintext");
    secureStoreState.values.set(SECURE_TOKEN_KEY, "old-token");

    const result = await loadPersistedConnection();

    expect(result).toMatchObject({
      status: "ready",
      connection: {
        host: "192.168.1.20",
        accessToken: "secure-token",
        name: "TV",
      },
    });
    expect(asyncStorageState.values.has(CONNECTION_STORAGE_KEY)).toBe(false);
    expect(secureStoreState.values.has(SECURE_TOKEN_KEY)).toBe(false);
  });

  it("rejects an unsupported canonical version and removes it", async () => {
    secureStoreState.values.set(
      SECURE_CONNECTION_KEY,
      JSON.stringify({
        version: CONNECTION_STORAGE_VERSION - 1,
        host: "192.168.1.20",
        accessToken: "token",
        name: "TV",
      }),
    );

    await expect(loadPersistedConnection()).resolves.toEqual({
      status: "invalid",
    });
    expect(secureStoreState.values.has(SECURE_CONNECTION_KEY)).toBe(false);
  });

  it("cleans plaintext and requires re-pairing when migration cannot write SecureStore", async () => {
    asyncStorageState.values.set(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({
        host: "192.168.1.20",
        accessToken: "legacy-token",
        name: "TV",
      }),
    );
    secureStoreState.failures.set = true;

    const result = await loadPersistedConnection();

    expect(result.status).toBe("invalid");
    expect(asyncStorageState.values.has(CONNECTION_STORAGE_KEY)).toBe(false);
    expect(secureStoreState.values.has(SECURE_CONNECTION_KEY)).toBe(false);
  });

  it("does not activate a migration when plaintext cleanup fails", async () => {
    asyncStorageState.values.set(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({
        host: "192.168.1.20",
        accessToken: "legacy-token",
        name: "TV",
      }),
    );
    asyncStorageState.failures.remove = true;

    const result = await loadPersistedConnection();

    expect(result.status).toBe("invalid");
    expect(secureStoreState.values.has(SECURE_CONNECTION_KEY)).toBe(false);
  });

  it("validates the canonical parser at runtime", () => {
    expect(
      parseCanonicalConnection(
        JSON.stringify({
          version: CONNECTION_STORAGE_VERSION,
          host: "192.168.1.20",
          accessToken: "token",
          name: "TV",
        }),
      ),
    ).toEqual({
      version: CONNECTION_STORAGE_VERSION,
      host: "192.168.1.20",
      accessToken: "token",
      name: "TV",
    });
    expect(() =>
      parseCanonicalConnection(
        JSON.stringify({
          version: CONNECTION_STORAGE_VERSION,
          host: "http://192.168.1.20",
          accessToken: "token",
          name: "TV",
        }),
      ),
    ).toThrow(StorageError);
  });
});
