/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');

const DEFAULT_PORT = 3000;
const DEFAULT_BIND_HOST = '127.0.0.1';
const URL_BASE = 'http://127.0.0.1';
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const LOCAL_URL_PATTERN = /(?:https?|wss?|file):\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i;
const STATIC_ROOT = path.resolve(
  process.env.STATIC_ROOT || path.resolve(__dirname, '..', 'static-build'),
);
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function normalizeBasePath(value) {
  const raw = value === undefined ? '/' : String(value).trim();
  if (!raw || raw === '/') {
    return '';
  }
  if (
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    raw.includes('?') ||
    raw.includes('#') ||
    hasControlCharacters(raw)
  ) {
    throw new Error('BASE_PATH must be a safe absolute path');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error('BASE_PATH contains invalid percent encoding');
  }
  if (
    decoded.includes('\\') ||
    hasControlCharacters(decoded) ||
    decoded.startsWith('//')
  ) {
    throw new Error('BASE_PATH must be a safe absolute path');
  }
  const withoutTrailingSlash = decoded.replace(/\/+$/, '');
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (
    normalized !== withoutTrailingSlash ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('BASE_PATH must not contain traversal segments');
  }
  return normalized;
}

function parsePort(value) {
  const raw = value === undefined ? String(DEFAULT_PORT) : String(value);
  if (!/^[1-9]\d{0,4}$/.test(raw)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseBindHost(value) {
  const host = value || DEFAULT_BIND_HOST;
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(host) &&
    process.env.ALLOW_REMOTE_BIND !== 'true'
  ) {
    throw new Error('Remote binds are disabled; use a loopback bind host');
  }
  if (hasControlCharacters(host) || /[\s/]/.test(host)) {
    throw new Error('BIND_HOST is invalid');
  }
  return host;
}

function parseCanonicalOrigin(value) {
  const raw = value.trim();
  if (!raw || hasControlCharacters(raw) || raw.includes('\\')) {
    throw new Error('PUBLIC_ORIGIN is invalid');
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid canonical origin: ${value}`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname ||
    parsed.hostname.includes('%')
  ) {
    throw new Error(`Invalid canonical origin: ${value}`);
  }
  return parsed.origin;
}

function getConfiguration() {
  const port = parsePort(process.env.PORT);
  const bindHost = parseBindHost(process.env.BIND_HOST || process.env.HOST);
  const configuredOrigin =
    process.env.PUBLIC_ORIGIN ||
    process.env.EXPO_PUBLIC_DOMAIN ||
    process.env.DEPLOYMENT_DOMAIN;
  const origin = configuredOrigin
    ? parseCanonicalOrigin(configuredOrigin)
    : `http://127.0.0.1:${port}`;
  return {
    port,
    bindHost,
    origin,
    basePath: normalizeBasePath(process.env.BASE_PATH),
  };
}

function getSingleHeader(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    throw new HttpError(400, 'Repeated header is not allowed');
  }
  if (value === undefined) {
    return undefined;
  }
  const stringValue = String(value);
  if (
    hasControlCharacters(stringValue) ||
    stringValue.includes(',') ||
    stringValue.trim() !== stringValue
  ) {
    throw new HttpError(400, 'Invalid request header');
  }
  return stringValue;
}

function parseHost(value) {
  if (
    !value ||
    hasControlCharacters(value) ||
    value.includes('\\') ||
    value.includes('/') ||
    value.includes('@') ||
    value.includes(',') ||
    value.trim() !== value
  ) {
    throw new HttpError(400, 'Invalid Host header');
  }
  let parsed;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new HttpError(400, 'Invalid Host header');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new HttpError(400, 'Invalid Host header');
  }
  return {
    hostname: parsed.hostname,
    port: parsed.port,
    host: parsed.host,
  };
}

function getAllowedHosts(origin, port) {
  const entries = [];
  const add = (value) => {
    const parsed = parseHost(value);
    if (!entries.some((entry) => entry.hostname === parsed.hostname && entry.port === parsed.port)) {
      entries.push(parsed);
    }
  };
  const originUrl = new URL(origin);
  add(originUrl.host);
  if (!originUrl.port) {
    add(`${originUrl.hostname}:${originUrl.protocol === 'https:' ? '443' : '80'}`);
  }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    add(host);
    add(`${host}:${port}`);
  }
  const configured = process.env.ALLOWED_HOSTS || process.env.HOST_ALLOWLIST;
  if (configured) {
    for (const value of configured.split(',')) {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new Error('ALLOWED_HOSTS contains an empty value');
      }
      add(trimmed);
    }
  }
  return entries;
}

function hostMatches(host, entries) {
  return entries.some(
    (entry) => entry.hostname === host.hostname && entry.port === host.port,
  );
}

function isTrustedProxy() {
  return process.env.TRUST_PROXY === 'true';
}

function validateForwardedHeader(value, name, allowedHosts) {
  if (!value) {
    return;
  }
  if (!isTrustedProxy()) {
    throw new HttpError(400, `${name} is not accepted`);
  }
  if (hasControlCharacters(value) || value.includes(',')) {
    throw new HttpError(400, `${name} is invalid`);
  }
  if (name !== 'Forwarded') {
    return;
  }
  for (const element of value.split(';')) {
    const separator = element.indexOf('=');
    if (separator <= 0) {
      throw new HttpError(400, 'Forwarded is invalid');
    }
    const key = element.slice(0, separator).trim().toLowerCase();
    const rawValue = element.slice(separator + 1).trim();
    if (!/^(?:by|for|host|proto)$/.test(key) || !rawValue || /["'`]/.test(rawValue)) {
      throw new HttpError(400, 'Forwarded is invalid');
    }
    if (key === 'host') {
      const host = parseHost(rawValue);
      if (!hostMatches(host, allowedHosts)) {
        throw new HttpError(421, 'Forwarded host is not allowed');
      }
    } else if (key === 'proto' && !['http', 'https'].includes(rawValue.toLowerCase())) {
      throw new HttpError(400, 'Forwarded proto is invalid');
    } else if (!/^[A-Za-z0-9._:[\]-]+$/.test(rawValue)) {
      throw new HttpError(400, 'Forwarded is invalid');
    }
  }
}

function validateRequestHeaders(req, allowedHosts) {
  const hostValue = getSingleHeader(req, 'host');
  if (hostValue !== undefined) {
    const host = parseHost(hostValue);
    if (!hostMatches(host, allowedHosts)) {
      throw new HttpError(421, 'Host is not allowed');
    }
  } else if (req.httpVersionMajor >= 1) {
    throw new HttpError(400, 'Host header is required');
  }

  const forwardedHost = getSingleHeader(req, 'x-forwarded-host');
  validateForwardedHeader(forwardedHost, 'X-Forwarded-Host', allowedHosts);
  if (forwardedHost) {
    const forwarded = parseHost(forwardedHost);
    if (!hostMatches(forwarded, allowedHosts)) {
      throw new HttpError(421, 'Forwarded host is not allowed');
    }
  }

  const forwardedProto = getSingleHeader(req, 'x-forwarded-proto');
  validateForwardedHeader(forwardedProto, 'X-Forwarded-Proto', allowedHosts);
  if (forwardedProto && !['http', 'https'].includes(forwardedProto.toLowerCase())) {
    throw new HttpError(400, 'X-Forwarded-Proto is invalid');
  }
  const forwarded = getSingleHeader(req, 'forwarded');
  validateForwardedHeader(forwarded, 'Forwarded', allowedHosts);
}

function getRequestUrl(req) {
  const requestTarget = req.url || '/';
  if (hasControlCharacters(requestTarget)) {
    throw new HttpError(400, 'Invalid request target');
  }
  let parsed;
  try {
    parsed = new URL(requestTarget, URL_BASE);
  } catch {
    throw new HttpError(400, 'Invalid request target');
  }
  if (parsed.origin !== URL_BASE) {
    throw new HttpError(400, 'Absolute request targets are not accepted');
  }
  return parsed;
}

function decodePathname(pathname, label = 'request path') {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, `${label} is invalid`);
  }
  if (
    hasControlCharacters(decoded) ||
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return decoded;
}

function stripBasePath(pathname, basePath) {
  if (!basePath) {
    return pathname;
  }
  if (pathname === basePath) {
    return '/';
  }
  if (!pathname.startsWith(`${basePath}/`)) {
    throw new HttpError(404, 'Not Found');
  }
  return pathname.slice(basePath.length) || '/';
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function resolveStaticPath(routePath) {
  const decoded = decodePathname(routePath);
  const relative = decoded.replace(/^\/+/, '');
  if (!relative) {
    throw new HttpError(404, 'Not Found');
  }
  const filePath = path.resolve(STATIC_ROOT, ...relative.split('/'));
  const relativeToRoot = path.relative(STATIC_ROOT, filePath);
  if (
    !isWithin(STATIC_ROOT, filePath) ||
    relativeToRoot === '' ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new HttpError(403, 'Forbidden');
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new HttpError(404, 'Not Found');
    }
    throw new HttpError(500, 'Static file unavailable');
  }
  if (stat.isSymbolicLink()) {
    throw new HttpError(403, 'Forbidden');
  }
  if (!stat.isFile()) {
    throw new HttpError(404, 'Not Found');
  }
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(STATIC_ROOT);
    realFile = fs.realpathSync(filePath);
  } catch {
    throw new HttpError(404, 'Not Found');
  }
  if (!isWithin(realRoot, realFile)) {
    throw new HttpError(403, 'Forbidden');
  }
  return { filePath, size: stat.size, realFile };
}

function getSecurityHeaders(cacheControl) {
  const headers = {
    'content-security-policy':
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cache-control': cacheControl,
  };
  if (cacheControl.includes('no-store')) {
    headers.pragma = 'no-cache';
    headers.expires = '0';
  }
  return headers;
}

function sendBuffer(req, res, statusCode, body, contentType, cacheControl, extraHeaders = {}) {
  if (!Buffer.isBuffer(body)) {
    body = Buffer.from(String(body));
  }
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new HttpError(413, 'Response is too large');
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const headers = {
    ...getSecurityHeaders(cacheControl),
    'content-type': contentType,
    'content-length': body.length,
    ...extraHeaders,
  };
  res.writeHead(statusCode, headers);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

function sendError(req, res, error) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const message = statusCode >= 500 ? 'Internal Server Error' : error.message;
  const body = Buffer.from(`${message}\n`);
  try {
    sendBuffer(
      req,
      res,
      statusCode,
      body,
      'text/plain; charset=utf-8',
      'no-store',
    );
  } catch {
    res.destroy();
  }
}

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return typeof appJson.expo?.name === 'string' &&
      !hasControlCharacters(appJson.expo.name)
      ? appJson.expo.name
      : 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function assertGeneratedManifest(manifest, label) {
  const forbiddenKeys = new Set([
    '_internal',
    'projectRoot',
    'staticConfigPath',
    'packageJsonPath',
    'username',
    'iconUrl',
    'scriptURL',
    'sourceMappingURL',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`${label} contains forbidden field ${key}`);
      }
      visit(child);
    }
  };
  visit(manifest);
  const serialized = JSON.stringify(manifest);
  if (LOCAL_URL_PATTERN.test(serialized)) {
    throw new Error(`${label} contains a local URL`);
  }
  if (serialized.includes(path.resolve(__dirname, '..'))) {
    throw new Error(`${label} contains an absolute project path`);
  }
  const allowedTopLevel = new Set([
    'id',
    'createdAt',
    'runtimeVersion',
    'launchAsset',
    'assets',
    'metadata',
    'extra',
  ]);
  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`${label} contains unexpected field ${key}`);
    }
  }
  if (
    !manifest.launchAsset ||
    typeof manifest.launchAsset !== 'object' ||
    Array.isArray(manifest.launchAsset)
  ) {
    throw new Error(`${label} has an invalid launchAsset`);
  }
  for (const key of Object.keys(manifest.launchAsset)) {
    if (!['key', 'contentType', 'url'].includes(key)) {
      throw new Error(`${label} contains unexpected launchAsset field ${key}`);
    }
  }
  if (
    !manifest.metadata ||
    typeof manifest.metadata !== 'object' ||
    Array.isArray(manifest.metadata) ||
    Object.keys(manifest.metadata).length !== 0
  ) {
    throw new Error(`${label} has unsafe metadata`);
  }
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new Error(`${label} has an invalid asset`);
    }
    for (const key of Object.keys(asset)) {
      if (!['hash', 'name', 'type', 'scales', 'metadata', 'url'].includes(key)) {
        throw new Error(`${label} contains unexpected asset field ${key}`);
      }
    }
  }
  if (manifest.extra !== undefined) {
    const allowedExtra = new Set(['expoClient', 'expoGo']);
    if (!manifest.extra || typeof manifest.extra !== 'object' || Array.isArray(manifest.extra)) {
      throw new Error(`${label} has invalid extra`);
    }
    for (const key of Object.keys(manifest.extra)) {
      if (!allowedExtra.has(key)) {
        throw new Error(`${label} contains unexpected extra field ${key}`);
      }
    }
    const allowedClientFields = new Set([
      'name',
      'slug',
      'version',
      'orientation',
      'icon',
      'scheme',
      'userInterfaceStyle',
      'sdkVersion',
      'ios',
      'android',
      'web',
      'platforms',
      'extra',
    ]);
    if (manifest.extra.expoClient !== undefined) {
      if (
        typeof manifest.extra.expoClient !== 'object' ||
        Array.isArray(manifest.extra.expoClient)
      ) {
        throw new Error(`${label} has invalid expoClient`);
      }
      for (const key of Object.keys(manifest.extra.expoClient)) {
        if (!allowedClientFields.has(key)) {
          throw new Error(`${label} contains unexpected expoClient field ${key}`);
        }
      }
      if (manifest.extra.expoClient.extra !== undefined) {
        if (
          typeof manifest.extra.expoClient.extra !== 'object' ||
          Array.isArray(manifest.extra.expoClient.extra) ||
          Object.keys(manifest.extra.expoClient.extra).some(
            (key) => key !== 'router',
          )
        ) {
          throw new Error(`${label} contains unsafe expoClient extra`);
        }
        if (
          manifest.extra.expoClient.extra.router !== undefined &&
          (typeof manifest.extra.expoClient.extra.router !== 'object' ||
            Array.isArray(manifest.extra.expoClient.extra.router))
        ) {
          throw new Error(`${label} contains unsafe router extra`);
        }
      }
    }
    if (manifest.extra.expoGo !== undefined) {
      if (
        typeof manifest.extra.expoGo !== 'object' ||
        Array.isArray(manifest.extra.expoGo)
      ) {
        throw new Error(`${label} has invalid expoGo`);
      }
      for (const key of Object.keys(manifest.extra.expoGo)) {
        if (!['debuggerHost', 'packagerOpts'].includes(key)) {
          throw new Error(`${label} contains unexpected expoGo field ${key}`);
        }
      }
      if (
        !manifest.extra.expoGo.packagerOpts ||
        manifest.extra.expoGo.packagerOpts.dev !== false
      ) {
        throw new Error(`${label} has unsafe packager options`);
      }
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toScriptString(value) {
  return JSON.stringify(String(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function encodeBasePath(basePath) {
  return basePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function makePublicBase(origin, basePath) {
  const encodedBasePath = encodeBasePath(basePath);
  return `${origin}${encodedBasePath ? `/${encodedBasePath}` : ''}` || `${origin}/`;
}

function serveManifest(platform, req, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');
  let body;
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error('invalid manifest size');
    }
    body = fs.readFileSync(manifestPath);
  } catch {
    throw new HttpError(404, `Manifest not found for platform: ${platform}`);
  }
  try {
    const manifest = JSON.parse(body.toString('utf8'));
    assertGeneratedManifest(manifest, `${platform} manifest`);
  } catch {
    throw new HttpError(500, 'Manifest unavailable');
  }
  sendBuffer(
    req,
    res,
    200,
    body,
    'application/json; charset=utf-8',
    'no-store, no-cache, must-revalidate',
    {
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
    },
  );
}

function serveLandingPage(req, res, config, template, appName) {
  const baseUrl = makePublicBase(config.origin, config.basePath);
  const expsUrl = `exps://${new URL(config.origin).host}${
    encodeBasePath(config.basePath) ? `/${encodeBasePath(config.basePath)}` : ''
  }`;
  const html = template
    .replaceAll('BASE_URL_PLACEHOLDER', escapeHtml(baseUrl))
    .replaceAll('EXPS_URL_ATTRIBUTE_PLACEHOLDER', escapeHtml(expsUrl))
    .replaceAll('EXPS_URL_JSON_PLACEHOLDER', toScriptString(expsUrl))
    .replaceAll('APP_NAME_PLACEHOLDER', escapeHtml(appName));
  const body = Buffer.from(html, 'utf8');
  if (body.length > MAX_HTML_BYTES) {
    throw new HttpError(413, 'Response is too large');
  }
  sendBuffer(
    req,
    res,
    200,
    body,
    'text/html; charset=utf-8',
    'no-store, no-cache, must-revalidate',
  );
}

function isImmutablePath(routePath) {
  const decoded = decodePathname(routePath);
  return (
    decoded.includes('/_expo/static/') &&
    path.posix.extname(decoded).toLowerCase() !== '.map'
  );
}

function streamFile(req, res, filePath, headers) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let settled = false;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          callback(new HttpError(413, 'Response is too large'));
          return;
        }
        callback(null, chunk);
      },
    });
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
      res.removeListener('error', onResponseError);
      stream.removeListener('error', onStreamError);
      limiter.removeListener('error', onLimiterError);
      limiter.removeListener('end', onLimiterEnd);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onFinish = () => finish();
    const onClose = () => {
      if (!res.writableEnded) {
        stream.destroy();
        limiter.destroy();
        finish(new Error('Response closed'));
      } else {
        finish();
      }
    };
    const onResponseError = (error) => {
      stream.destroy();
      limiter.destroy();
      finish(error);
    };
    const onStreamError = (error) => {
      limiter.destroy();
      finish(error);
    };
    const onLimiterError = (error) => {
      stream.destroy();
      finish(error);
    };
    const onLimiterEnd = () => {
      if (bytes === 0 && !res.writableEnded) {
        finish(new Error('Static file is empty'));
      }
    };
    res.once('finish', onFinish);
    res.once('close', onClose);
    res.once('error', onResponseError);
    stream.once('error', onStreamError);
    limiter.once('error', onLimiterError);
    limiter.once('end', onLimiterEnd);
    try {
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        stream.destroy();
        limiter.destroy();
        res.end();
        finish();
      } else {
        stream.pipe(limiter).pipe(res);
      }
    } catch (error) {
      stream.destroy();
      limiter.destroy();
      finish(error);
    }
  });
}

async function serveStaticFile(req, res, routePath) {
  const { filePath, size } = resolveStaticPath(routePath);
  if (size > MAX_RESPONSE_BYTES) {
    throw new HttpError(413, 'Response is too large');
  }
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  const cacheControl = isImmutablePath(routePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-store, no-cache, must-revalidate';
  const headers = {
    ...getSecurityHeaders(cacheControl),
    'content-type': contentType,
    'content-length': size,
  };
  await streamFile(req, res, filePath, headers);
}

function resolveArtifactUrl(value, config, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not an absolute URL`);
  }
  if (
    parsed.origin !== config.origin ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} is not on the canonical origin`);
  }
  const pathname = decodePathname(parsed.pathname, label);
  const prefix = `${config.basePath}/`;
  if (!pathname.startsWith(prefix)) {
    throw new Error(`${label} is outside BASE_PATH`);
  }
  const relative = pathname.slice(prefix.length);
  if (!relative || relative.split('/').some((segment) => segment === '..')) {
    throw new Error(`${label} has an unsafe path`);
  }
  const filePath = path.resolve(STATIC_ROOT, ...relative.split('/'));
  if (!isWithin(STATIC_ROOT, filePath) || filePath === STATIC_ROOT) {
    throw new Error(`${label} escapes static root`);
  }
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(STATIC_ROOT);
    realFile = fs.realpathSync(filePath);
  } catch {
    throw new Error(`${label} does not exist`);
  }
  if (!isWithin(realRoot, realFile) || !fs.lstatSync(filePath).isFile()) {
    throw new Error(`${label} does not exist`);
  }
  return filePath;
}

function validateStartupArtifacts(config) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(STATIC_ROOT);
  } catch {
    throw new Error('static-build is missing');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('static-build is not a real directory');
  }
  for (const platform of ['ios', 'android']) {
    const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');
    let manifest;
    try {
      const stat = fs.lstatSync(manifestPath);
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
        throw new Error('invalid manifest');
      }
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      throw new Error(`Invalid ${platform} manifest artifact`);
    }
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      !manifest.launchAsset ||
      typeof manifest.launchAsset.url !== 'string' ||
      !Array.isArray(manifest.assets)
    ) {
      throw new Error(`Invalid ${platform} manifest structure`);
    }
    assertGeneratedManifest(manifest, `${platform} manifest`);
    resolveArtifactUrl(
      manifest.launchAsset.url,
      config,
      `${platform} launchAsset`,
    );
    for (const asset of manifest.assets) {
      if (!asset || typeof asset.url !== 'string') {
        throw new Error(`Invalid ${platform} asset structure`);
      }
      resolveArtifactUrl(asset.url, config, `${platform} asset`);
    }
  }
}

async function handleRequest(req, res, config, template, appName, allowedHosts) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      throw new HttpError(405, 'Method Not Allowed');
    }
    validateRequestHeaders(req, allowedHosts);
    const requestUrl = getRequestUrl(req);
    const decodedPath = decodePathname(requestUrl.pathname);
    const routePath = stripBasePath(decodedPath, config.basePath);
    const platformHeader = getSingleHeader(req, 'expo-platform');
    if (platformHeader && !['ios', 'android'].includes(platformHeader)) {
      throw new HttpError(400, 'Invalid expo-platform header');
    }

    if (routePath === '/manifest') {
      if (!platformHeader) {
        throw new HttpError(404, 'Not Found');
      }
      serveManifest(platformHeader, req, res);
      return;
    }
    if (routePath === '/') {
      if (platformHeader) {
        serveManifest(platformHeader, req, res);
      } else {
        serveLandingPage(req, res, config, template, appName);
      }
      return;
    }
    await serveStaticFile(req, res, routePath);
  } catch (error) {
    sendError(req, res, error);
  }
}

function createServer(config) {
  validateStartupArtifacts(config);
  let template;
  try {
    const stat = fs.lstatSync(TEMPLATE_PATH);
    if (!stat.isFile() || stat.size > MAX_HTML_BYTES) {
      throw new Error('invalid landing page template');
    }
    template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  } catch {
    throw new Error('Landing page template is missing or invalid');
  }
  const appName = getAppName();
  const allowedHosts = getAllowedHosts(config.origin, config.port);
  const server = http.createServer((req, res) => {
    try {
      void handleRequest(req, res, config, template, appName, allowedHosts);
    } catch (error) {
      sendError(req, res, error);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
    socket.destroy();
  });
  return server;
}

function startServer() {
  const config = getConfiguration();
  const server = createServer(config);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    const forceTimer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error(`Server shutdown failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);
  if (process.platform === 'win32') {
    process.once('SIGBREAK', shutdown);
  }
  server.once('error', (error) => {
    console.error(`Server error: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(config.port, config.bindHost, () => {
    console.log(
      `Serving static Expo build on ${config.bindHost}:${config.port} (origin ${config.origin})`,
    );
  });
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  HttpError,
  assertGeneratedManifest,
  createServer,
  getConfiguration,
  getRequestUrl,
  normalizeBasePath,
  parseBindHost,
  parsePort,
  resolveStaticPath,
  startServer,
  streamFile,
  validateStartupArtifacts,
};
