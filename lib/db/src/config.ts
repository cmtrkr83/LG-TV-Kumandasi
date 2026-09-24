const SUPPORTED_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export function validateDatabaseUrl(value: string | undefined): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /\s/.test(value)
  ) {
    throw new Error(
      "DATABASE_URL must be a non-empty PostgreSQL URL without whitespace.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }

  return value;
}
