const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/
const INVALID_PERCENT = /%(?![0-9A-Fa-f]{2})/
const ENCODED_RESERVED = /%(?:2F|5C|3F|23)/i

function invalidBasePath(value: string): never {
  throw new Error(`Invalid BASE_PATH: ${JSON.stringify(value)}`)
}

export function normalizeBasePath(value: string | undefined): string {
  if (value === undefined) {
    return "/"
  }

  if (
    !value.startsWith("/") ||
    value.includes("//") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    CONTROL_CHARACTER.test(value) ||
    INVALID_PERCENT.test(value) ||
    ENCODED_RESERVED.test(value)
  ) {
    invalidBasePath(value)
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value).normalize("NFC")
  } catch {
    invalidBasePath(value)
  }

  if (
    decoded.includes("//") ||
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    CONTROL_CHARACTER.test(decoded) ||
    decoded
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    invalidBasePath(value)
  }

  return decoded.length > 1 && decoded.endsWith("/")
    ? decoded.slice(0, -1)
    : decoded
}
