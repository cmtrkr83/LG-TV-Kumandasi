export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> =
  ApiError<T> | ResponseParseError | NetworkError | AbortError;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TrustedOrigins = readonly string[] | string | null;

export interface CustomFetchClientOptions {
  baseUrl?: string | null;
  baseURL?: string | null;
  authTokenGetter?: AuthTokenGetter | null;
  trustedOrigins?: TrustedOrigins;
  fetch?: FetchImplementation;
}

export interface ApiClient {
  <T = unknown>(
    input: RequestInfo | URL,
    options?: CustomFetchOptions,
  ): Promise<T>;
  fetch<T = unknown>(
    input: RequestInfo | URL,
    options?: CustomFetchOptions,
  ): Promise<T>;
  setBaseUrl(url: string | null): void;
  setAuthTokenGetter(getter: AuthTokenGetter | null): void;
  setTrustedOrigins(origins: TrustedOrigins): void;
}

export type CustomFetchClient = ApiClient;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const RELATIVE_URL_BASE = "http://relative.invalid";

type FetchInput = RequestInfo | URL;

function isRequest(input: unknown): input is Request {
  if (typeof input !== "object" || input === null) return false;

  const candidate = input as {
    url?: unknown;
    method?: unknown;
    headers?: unknown;
  };

  return (
    typeof candidate.url === "string" &&
    (typeof candidate.method === "string" || candidate.headers !== undefined)
  );
}

function isUrl(input: unknown): input is URL {
  if (typeof input !== "object" || input === null) return false;

  const candidate = input as {
    href?: unknown;
    protocol?: unknown;
    host?: unknown;
    toString?: unknown;
  };

  return (
    typeof candidate.toString === "function" &&
    (candidate.href !== undefined ||
      candidate.protocol !== undefined ||
      candidate.host !== undefined)
  );
}

function getRequestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (isRequest(input)) return input.url;
  if (isUrl(input)) return input.toString();
  return String(input);
}

function resolveMethod(input: FetchInput, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input) && typeof input.method === "string") {
    return input.method.toUpperCase();
  }
  return "GET";
}

function assertValidUrlSyntax(value: string, label: string): void {
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new TypeError(`${label} contains control characters.`);
  }

  const candidate = value.trimStart();
  const scheme = /^([^/?#]*):/.exec(candidate);
  if (scheme && !/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme[1] ?? "")) {
    throw new TypeError(`${label} contains a malformed URL scheme.`);
  }

  if (
    /^[A-Za-z][A-Za-z0-9+.-]*\/\//.test(candidate) ||
    candidate.startsWith(":")
  ) {
    throw new TypeError(`${label} contains a malformed URL scheme.`);
  }
}

function hasUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isNetworkPath(value: string): boolean {
  return (
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    value.startsWith("\\")
  );
}

function isPrefixedPath(value: string): boolean {
  return value.startsWith("/") && !isNetworkPath(value);
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (value == null) return null;

  assertValidUrlSyntax(value, "baseUrl");
  const trimmed = value.trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("baseUrl must use the HTTP or HTTPS protocol.");
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("baseUrl must not contain a query string or fragment.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

function getLocationOrigin(): string | null {
  const location = (globalThis as { location?: { origin?: unknown } }).location;
  return typeof location?.origin === "string"
    ? normalizeOrigin(location.origin)
    : null;
}

function normalizeTrustedOrigins(value: TrustedOrigins): Set<string> {
  const origins = new Set<string>();
  const values = typeof value === "string" ? value.split(",") : (value ?? []);

  for (const candidate of values) {
    if (typeof candidate !== "string") continue;
    const origin = normalizeOrigin(candidate.trim());
    if (origin) origins.add(origin);
  }

  return origins;
}

type CanonicalRequestUrl = {
  url: string;
  canTrustOrigin: boolean;
};

function ensureDirectoryBase(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function canonicalizeRequestUrl(
  value: string,
  baseUrl: string | null,
): CanonicalRequestUrl {
  assertValidUrlSyntax(value, "Request URL");
  const candidate = value.trim();
  const locationOrigin = getLocationOrigin();

  try {
    if (baseUrl && isPrefixedPath(candidate)) {
      const resolved = new URL(
        candidate.slice(1),
        ensureDirectoryBase(baseUrl),
      );
      return { url: resolved.toString(), canTrustOrigin: true };
    }

    if (hasUrlScheme(candidate) || isNetworkPath(candidate)) {
      const resolved = new URL(
        candidate,
        baseUrl ?? locationOrigin ?? RELATIVE_URL_BASE,
      );
      return { url: resolved.toString(), canTrustOrigin: true };
    }

    if (baseUrl) {
      const resolved = new URL(candidate, ensureDirectoryBase(baseUrl));
      return { url: resolved.toString(), canTrustOrigin: true };
    }

    if (locationOrigin) {
      const resolved = new URL(candidate, locationOrigin);
      return { url: resolved.toString(), canTrustOrigin: true };
    }

    const relative = new URL(candidate, RELATIVE_URL_BASE);
    return {
      url: `${relative.pathname}${relative.search}${relative.hash}`,
      canTrustOrigin: false,
    };
  } catch {
    throw new TypeError("Request URL is invalid.");
  }
}

function isTrustedRequest(
  url: string,
  baseUrl: string | null,
  trustedOrigins: ReadonlySet<string>,
  canTrustOrigin: boolean,
): boolean {
  if (!canTrustOrigin) return false;

  const origin = new URL(url).origin;
  if (origin === "null") return false;
  if (trustedOrigins.has(origin)) return true;

  const baseOrigin = baseUrl ? normalizeOrigin(baseUrl) : null;
  if (baseOrigin && origin === baseOrigin) return true;

  return origin === getLocationOrigin();
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;

    try {
      new Headers(source).forEach((value, key) => {
        headers.set(key, value);
      });
      continue;
    } catch {
      if (Array.isArray(source)) {
        for (const entry of source) {
          if (entry.length >= 2) headers.set(entry[0], entry[1]);
        }
        continue;
      }

      if (typeof source === "object") {
        for (const [key, value] of Object.entries(source)) {
          if (typeof value === "string") headers.set(key, value);
        }
      }
    }
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return (
    mediaType === "application/json" ||
    mediaType === "text/json" ||
    Boolean(mediaType?.endsWith("+json"))
  );
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
    (mediaType.startsWith("text/") ||
      mediaType === "application/xml" ||
      mediaType === "text/xml" ||
      mediaType.endsWith("+xml") ||
      mediaType === "application/x-www-form-urlencoded"),
  );
}

function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  return NO_BODY_STATUS.has(response.status);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

type RequestDetails = { method: string; url: string };

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(response: Response, data: T | null, requestInfo: RequestDetails) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: RequestDetails,
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

export class NetworkError extends Error {
  readonly name: string = "NetworkError";
  readonly method: string;
  readonly url: string;
  readonly cause: unknown;

  constructor(requestInfo: RequestDetails, cause: unknown) {
    super(
      `Network request failed for ${requestInfo.method} ${requestInfo.url}`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.method = requestInfo.method;
    this.url = requestInfo.url;
    this.cause = cause;
  }
}

export class AbortError extends NetworkError {
  readonly name = "AbortError";

  constructor(requestInfo: RequestDetails, cause: unknown) {
    super(requestInfo, cause);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { AbortError as ApiAbortError, NetworkError as ApiNetworkError };

async function parseJsonBody(
  response: Response,
  requestInfo: RequestDetails,
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(
  response: Response,
  method: string,
): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    if (typeof response.blob === "function") {
      try {
        return await response.blob();
      } catch {
        return response.text();
      }
    }
    return response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (
    isJsonMediaType(mediaType) ||
    mediaType == null ||
    isTextMediaType(mediaType) ||
    looksLikeJson(normalized)
  ) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

async function parseAutomaticSuccessBody(
  response: Response,
  requestInfo: RequestDetails,
): Promise<unknown> {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) {
    return parseJsonBody(response, requestInfo);
  }

  if (mediaType && !isTextMediaType(mediaType)) {
    if (typeof response.blob === "function") return response.blob();
    throw new TypeError(
      "Blob responses are not supported in this runtime. " +
        "Use responseType \"json\" or \"text\" instead.",
    );
  }

  const text = await response.text();
  const normalized = stripBom(text);

  if (normalized.trim() === "") return "";

  if (mediaType == null) {
    try {
      return JSON.parse(normalized);
    } catch {
      return text;
    }
  }

  return text;
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: RequestDetails,
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  if (responseType === "auto") {
    return parseAutomaticSuccessBody(response, requestInfo);
  }

  switch (responseType) {
    case "json":
      return parseJsonBody(response, requestInfo);
    case "text":
      return response.text();
    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

function isResponseType(
  value: unknown,
): value is "json" | "text" | "blob" | "auto" {
  return (
    value === "json" || value === "text" || value === "blob" || value === "auto"
  );
}

function isAbortError(
  error: unknown,
  signal: AbortSignal | null | undefined,
): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

function getDefaultFetch(): FetchImplementation | null {
  if (typeof globalThis.fetch !== "function") return null;
  return globalThis.fetch.bind(globalThis);
}

function validateAuthTokenGetter(getter: AuthTokenGetter | null): void {
  if (getter !== null && typeof getter !== "function") {
    throw new TypeError("authTokenGetter must be a function or null.");
  }
}

type RuntimeRequestInit = RequestInit & { duplex?: "half" };

function getRequestDefaults(input: FetchInput): RuntimeRequestInit {
  if (!isRequest(input)) return {};

  const body = input.body;
  const requestInit: RuntimeRequestInit = {
    method: input.method,
    headers: input.headers,
    body,
    signal: input.signal,
    credentials: input.credentials,
    cache: input.cache,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    integrity: input.integrity,
    keepalive: input.keepalive,
    mode: input.mode,
  };

  if (body && typeof body === "object" && "getReader" in body) {
    requestInit.duplex = "half";
  }

  return requestInit;
}

export function createApiClient(
  options: CustomFetchClientOptions = {},
): ApiClient {
  let baseUrl = normalizeBaseUrl(options.baseUrl ?? options.baseURL ?? null);
  let authTokenGetter = options.authTokenGetter ?? null;
  const configuredFetch = options.fetch;
  const trustedOrigins = normalizeTrustedOrigins(options.trustedOrigins ?? []);

  validateAuthTokenGetter(authTokenGetter);

  const performFetch = async <T = unknown>(
    input: FetchInput,
    requestOptions: CustomFetchOptions = {},
  ): Promise<T> => {
    const {
      responseType = "auto",
      headers: headersInit,
      ...init
    } = requestOptions;

    if (!isResponseType(responseType)) {
      throw new TypeError("responseType must be json, text, blob, or auto.");
    }

    const canonicalRequest = canonicalizeRequestUrl(
      getRequestUrl(input),
      baseUrl,
    );
    const method = resolveMethod(input, init.method);
    const requestBody =
      init.body !== undefined
        ? init.body
        : isRequest(input)
          ? input.body
          : null;

    if (requestBody != null && (method === "GET" || method === "HEAD")) {
      throw new TypeError(
        `customFetch: ${method} requests cannot have a body.`,
      );
    }

    const headers = mergeHeaders(
      isRequest(input) ? input.headers : undefined,
      headersInit,
    );

    if (
      typeof init.body === "string" &&
      !headers.has("content-type") &&
      looksLikeJson(init.body)
    ) {
      headers.set("content-type", "application/json");
    }

    if (responseType === "json" && !headers.has("accept")) {
      headers.set("accept", DEFAULT_JSON_ACCEPT);
    }

    const requestInfo: RequestDetails = {
      method,
      url: canonicalRequest.url,
    };
    const requestInit: RuntimeRequestInit = {
      ...getRequestDefaults(input),
      ...init,
      method,
      headers,
      redirect: "error",
    };

    if (
      authTokenGetter &&
      !headers.has("authorization") &&
      isTrustedRequest(
        canonicalRequest.url,
        baseUrl,
        trustedOrigins,
        canonicalRequest.canTrustOrigin,
      )
    ) {
      const token = await authTokenGetter();
      if (token) headers.set("authorization", `Bearer ${token}`);
    }

    const fetcher = configuredFetch ?? getDefaultFetch();
    let response: Response;

    try {
      if (!fetcher) {
        throw new TypeError("Fetch is not available in this runtime.");
      }
      response = await fetcher(canonicalRequest.url, requestInit);
    } catch (cause) {
      if (isAbortError(cause, requestInit.signal)) {
        throw new AbortError(requestInfo, cause);
      }
      throw new NetworkError(requestInfo, cause);
    }

    if (!response.ok) {
      const errorData = await parseErrorBody(response, method);
      throw new ApiError(response, errorData, requestInfo);
    }

    return (await parseSuccessBody(response, responseType, requestInfo)) as T;
  };

  const client = (<T = unknown>(
    requestInput: FetchInput,
    requestOptions?: CustomFetchOptions,
  ): Promise<T> => performFetch<T>(requestInput, requestOptions)) as ApiClient;

  client.fetch = performFetch;
  client.setBaseUrl = (url: string | null): void => {
    baseUrl = normalizeBaseUrl(url);
  };
  client.setAuthTokenGetter = (getter: AuthTokenGetter | null): void => {
    validateAuthTokenGetter(getter);
    authTokenGetter = getter;
  };
  client.setTrustedOrigins = (origins: TrustedOrigins): void => {
    trustedOrigins.clear();
    for (const origin of normalizeTrustedOrigins(origins)) {
      trustedOrigins.add(origin);
    }
  };

  return client;
}

export const createCustomFetchClient = createApiClient;

export function createCustomFetch(
  options: CustomFetchClientOptions = {},
): ApiClient {
  return createApiClient(options);
}

export const defaultApiClient = createApiClient();

export function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  return defaultApiClient.fetch<T>(input, options);
}

export function setBaseUrl(url: string | null): void {
  defaultApiClient.setBaseUrl(url);
}

export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  defaultApiClient.setAuthTokenGetter(getter);
}

export function setTrustedOrigins(origins: TrustedOrigins): void {
  defaultApiClient.setTrustedOrigins(origins);
}
