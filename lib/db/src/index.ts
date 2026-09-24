import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { validateDatabaseUrl } from "./config";

const { Pool } = pg;
const databaseUrl = validateDatabaseUrl(process.env["DATABASE_URL"]);

const DEFAULT_POOL_MAX = 10;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function getPoolInteger(names: readonly string[], fallback: number): number {
  const name = names.find((candidate) => process.env[candidate] !== undefined);
  if (!name) return fallback;

  const rawValue = process.env[name];
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

const max = getPoolInteger(
  ["DB_POOL_MAX", "DATABASE_POOL_MAX"],
  DEFAULT_POOL_MAX,
);
const idleTimeoutMillis = getPoolInteger(
  ["DB_POOL_IDLE_TIMEOUT_MS", "DATABASE_POOL_IDLE_TIMEOUT_MS"],
  DEFAULT_POOL_IDLE_TIMEOUT_MS,
);
const connectionTimeoutMillis = getPoolInteger(
  ["DB_CONNECTION_TIMEOUT_MS", "DATABASE_CONNECTION_TIMEOUT_MS"],
  DEFAULT_CONNECTION_TIMEOUT_MS,
);

export const pool = new Pool({
  connectionString: databaseUrl,
  max,
  idleTimeoutMillis,
  connectionTimeoutMillis,
});

pool.on("error", (error) => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error("Database pool error", errorName);
});

export const db = drizzle(pool, { schema });

let closePromise: Promise<void> | null = null;

export function closePool(): Promise<void> {
  if (!closePromise) {
    closePromise = pool.end().catch((error: unknown) => {
      closePromise = null;
      throw error;
    });
  }

  return closePromise;
}

export const close = closePool;
export const closeDatabase = closePool;

export { validateDatabaseUrl } from "./config";
export * from "./schema";
