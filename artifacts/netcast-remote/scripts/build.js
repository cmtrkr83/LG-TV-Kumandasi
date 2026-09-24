const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { TextDecoder } = require('util');
const { pipeline } = require('stream/promises');

const PLATFORMS = ['ios', 'android'];
const METRO_READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const CHILD_STOP_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_000;
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const LOCK_PATH = path.join(__dirname, '..', '.netcast-remote-build.lock');
const STAGING_PREFIX = '.netcast-remote-build-';
const BACKUP_PREFIX = '.static-build-backup-';
const STAGING_MODE = 0o750;
const FINAL_BUILD_MODE = 0o755;
const LOCAL_URL_PATTERN = /(?:https?|wss?|file):\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i;
const FORBIDDEN_MANIFEST_KEYS = new Set([
  '_internal',
  'projectRoot',
  'staticConfigPath',
  'packageJsonPath',
  'username',
  'iconUrl',
  'scriptURL',
  'sourceMappingURL',
]);
const childStopPromises = new WeakMap();

const runtime = {
  abortController: new AbortController(),
  activeFetches: new Set(),
  timers: new Set(),
  interrupted: false,
  signal: null,
  cleaning: false,
  stoppingMetro: false,
  cleanupPromise: null,
  signalHandlers: [],
};

const projectRoot = path.resolve(__dirname, '..');

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'Could not find workspace root (no pnpm-workspace.yaml found)',
  );
}

const workspaceRoot = findWorkspaceRoot(projectRoot);

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function assertSafeString(value, label, options = {}) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (hasControlCharacters(value)) {
    throw new Error(`${label} contains control characters`);
  }
  return value;
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

function isLoopbackHostname(hostname) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function getCanonicalOrigin() {
  const configured =
    process.env.PUBLIC_ORIGIN ||
    process.env.EXPO_PUBLIC_DOMAIN ||
    process.env.DEPLOYMENT_DOMAIN;
  if (!configured) {
    throw new Error(
      'No canonical origin found. Set PUBLIC_ORIGIN, EXPO_PUBLIC_DOMAIN, or DEPLOYMENT_DOMAIN',
    );
  }

  const raw = configured.trim();
  if (hasControlCharacters(raw) || raw.includes('\\')) {
    throw new Error('Canonical origin contains unsafe characters');
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid canonical origin: ${configured}`);
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
    throw new Error(`Invalid canonical origin: ${configured}`);
  }
  if (isLoopbackHostname(parsed.hostname)) {
    throw new Error('Build canonical origin must not be loopback or unspecified');
  }
  return parsed.origin;
}

function getExpoPublicReplId() {
  const value = process.env.EXPO_PUBLIC_REPL_ID;
  if (!value) {
    return undefined;
  }
  return assertSafeString(value, 'EXPO_PUBLIC_REPL_ID');
}

function assertNotInterrupted() {
  if (runtime.interrupted) {
    throw new Error(`Build interrupted by ${runtime.signal || 'signal'}`);
  }
  if (runtime.abortController.signal.aborted && !runtime.cleaning) {
    throw new Error('Build aborted');
  }
}

function addTrackedTimeout(callback, delayMs) {
  const timer = setTimeout(() => {
    runtime.timers.delete(timer);
    callback();
  }, delayMs);
  runtime.timers.add(timer);
  return timer;
}

function delay(delayMs, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      runtime.timers.delete(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Operation aborted'));
    };
    const timer = addTrackedTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
  }
}

function assertResponseOrigin(response, expectedOrigin, label) {
  if (!expectedOrigin || response.redirected) {
    throw new Error(`${label} response origin is not allowed`);
  }
  let actual;
  try {
    actual = new URL(response.url);
  } catch {
    throw new Error(`${label} response origin is invalid`);
  }
  if (actual.origin !== expectedOrigin) {
    throw new Error(`${label} response origin does not match ${expectedOrigin}`);
  }
}

async function fetchWithLifecycle(
  url,
  options,
  consume,
  label,
  timeoutMs,
  expectedOrigin,
) {
  assertNotInterrupted();
  const controller = new AbortController();
  const parentSignal = options?.signal;
  let timedOut = false;
  runtime.activeFetches.add(controller);

  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = addTrackedTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    assertResponseOrigin(response, expectedOrigin, label);
    return await consume(response);
  } catch (error) {
    if (runtime.interrupted) {
      throw new Error(`Build interrupted by ${runtime.signal || 'signal'}`);
    }
    if (timedOut) {
      throw new Error(`${label} timeout after ${Math.ceil(timeoutMs / 1000)}s`);
    }
    if (parentSignal?.aborted) {
      throw new Error(`${label} aborted`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    runtime.timers.delete(timer);
    runtime.activeFetches.delete(controller);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function readResponseText(response, label, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`${label} response is too large`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`${label} response has no readable body`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} response is too large`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function withTimeout(label, timeoutMs, operation) {
  const controller = new AbortController();
  const parentSignal = runtime.abortController.signal;
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = addTrackedTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (runtime.interrupted) {
      throw new Error(`Build interrupted by ${runtime.signal || 'signal'}`);
    }
    if (timedOut) {
      throw new Error(`${label} timeout after ${Math.ceil(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    runtime.timers.delete(timer);
    parentSignal.removeEventListener('abort', abortFromParent);
  }
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

function resolveBoundedPath(root, relativePath, filename) {
  const relative = path.posix.join(relativePath, filename);
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith('../')
  ) {
    throw new Error(`Unsafe relative path: ${relative}`);
  }
  const candidate = path.resolve(root, ...relative.split('/'));
  if (!isWithin(root, candidate) || candidate === root) {
    throw new Error(`Path escapes root: ${relative}`);
  }
  return candidate;
}

function removePathIfExists(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function normalizeDirectoryMode(target, mode) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Build directory is not a real directory: ${target}`);
  }
  fs.chmodSync(target, mode);
}

function normalizeBuildTreeModes(root, mode) {
  normalizeDirectoryMode(root, mode);
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink in build directory: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        normalizeDirectoryMode(entryPath, mode);
        visit(entryPath);
      }
    }
  };
  visit(root);
}

function prepareDirectories(stagingRoot, timestamp) {
  console.log('Preparing build directories...');
  const dirs = [
    path.join(stagingRoot, timestamp, '_expo', 'static', 'js', 'ios'),
    path.join(stagingRoot, timestamp, '_expo', 'static', 'js', 'android'),
    path.join(stagingRoot, 'ios'),
    path.join(stagingRoot, 'android'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  normalizeBuildTreeModes(stagingRoot, STAGING_MODE);
  console.log('Build:', timestamp);
}

function clearMetroCache() {
  console.log('Clearing Metro cache...');
  const cacheDirs = [
    path.join(projectRoot, '.metro-cache'),
    path.join(projectRoot, 'node_modules/.cache/metro'),
  ];
  for (const dir of cacheDirs) {
    removePathIfExists(dir);
  }
  console.log('Cache cleared');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function isChildAlive(child) {
  return Boolean(
    child &&
      child.exitCode === null &&
      child.signalCode === null &&
      isProcessAlive(child.pid),
  );
}

function killProcessGroup(child, signal) {
  if (!child) {
    return Promise.resolve();
  }
  if (
    process.platform !== 'win32' &&
    (child.exitCode !== null || child.signalCode !== null)
  ) {
    return Promise.resolve();
  }
  if (process.platform === 'win32' && child.pid) {
    return new Promise((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/T', '/F'],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      killer.once('error', () => {
        try {
          child.kill(signal);
        } catch {
        }
        resolve();
      });
      killer.once('exit', () => resolve());
    });
  }
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return Promise.resolve();
    } catch {
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      return Promise.reject(error);
    }
  }
  return Promise.resolve();
}

function waitForChildExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      runtime.timers.delete(timer);
      resolve();
    };
    const timer = addTrackedTimeout(onExit, CHILD_STOP_TIMEOUT_MS);
    child.once('exit', onExit);
  });
}

function terminateChild(child) {
  if (!child) {
    return Promise.resolve();
  }
  const existing = childStopPromises.get(child);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    if (
      process.platform !== 'win32' &&
      (child.exitCode !== null || child.signalCode !== null)
    ) {
      return;
    }
    runtime.stoppingMetro = true;
    try {
      await killProcessGroup(child, 'SIGTERM');
      await waitForChildExit(child);
      if (isChildAlive(child)) {
        await killProcessGroup(child, 'SIGKILL');
        await waitForChildExit(child);
      }
    } finally {
      runtime.stoppingMetro = false;
    }
  })();
  childStopPromises.set(child, promise);
  return promise;
}

function getPnpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    const resolvedExecPath = path.isAbsolute(npmExecPath)
      ? npmExecPath
      : path.resolve(npmExecPath);
    if (/\.(?:c|m)?js$/i.test(resolvedExecPath)) {
      return {
        command: process.execPath,
        args: [resolvedExecPath, ...args],
      };
    }
    return { command: resolvedExecPath, args };
  }
  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
  };
}

function createMetroMonitor(child) {
  const controller = new AbortController();
  const monitor = {
    child,
    controller,
    signal: controller.signal,
    exited: false,
    exitCode: null,
    exitSignal: null,
    error: null,
    outputReady: false,
  };
  child.once('error', (error) => {
    monitor.error = error;
    controller.abort(error);
  });
  child.once('exit', (code, signal) => {
    monitor.exited = true;
    monitor.exitCode = code;
    monitor.exitSignal = signal;
    controller.abort(new Error(`Metro exited with code ${code ?? 'unknown'}`));
  });
  return monitor;
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    const onError = (error) => {
      probe.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close((error) =>
          error ? reject(error) : reject(new Error('No TCP port available')),
        );
        return;
      }
      if (
        !Number.isInteger(address.port) ||
        address.port < 1 ||
        address.port > 65535
      ) {
        probe.close((error) =>
          error ? reject(error) : reject(new Error('Invalid TCP port')),
        );
        return;
      }
      probe.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    };
    probe.once('error', onError);
    probe.once('listening', onListening);
    probe.listen(0, '127.0.0.1');
  });
}

async function checkMetroHealth(port, child, signal) {
  if (!child.pid || !isChildAlive(child)) {
    return false;
  }
  const expectedOrigin = `http://localhost:${port}`;
  try {
    await fetchWithLifecycle(
      `${expectedOrigin}/status`,
      { signal },
      async (response) => readResponseText(response, 'Metro health check', 64 * 1024),
      'Metro health check',
      HEALTH_TIMEOUT_MS,
      expectedOrigin,
    );
    return isChildAlive(child);
  } catch (error) {
    if (runtime.interrupted || runtime.abortController.signal.aborted) {
      throw error;
    }
    return false;
  }
}

async function waitForMetroReady(child, port, monitor) {
  const deadline = Date.now() + METRO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertNotInterrupted();
    if (monitor.exited || monitor.error || !isChildAlive(child)) {
      throw new Error(
        `Metro child exited before readiness${
          monitor.error ? `: ${monitor.error.message}` : ''
        }`,
      );
    }
    await delay(250, monitor.signal);
    if (monitor.exited || monitor.error || !isChildAlive(child)) {
      throw new Error(
        `Metro child exited before readiness${
          monitor.error ? `: ${monitor.error.message}` : ''
        }`,
      );
    }
    if (
      monitor.outputReady &&
      (await checkMetroHealth(port, child, monitor.signal))
    ) {
      console.log('Metro ready');
      return;
    }
  }
  throw new Error('Metro timeout');
}

async function startMetro(ctx) {
  const expoPublicDomain = new URL(ctx.origin).host;
  const expoPublicReplId = getExpoPublicReplId();
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertNotInterrupted();
    const port = await findAvailablePort();
    console.log(`Starting Metro on dynamic port ${port}...`);
    console.log(`Setting EXPO_PUBLIC_DOMAIN=${expoPublicDomain}`);
    if (expoPublicReplId) {
      console.log('Setting EXPO_PUBLIC_REPL_ID');
    }
    const env = {
      ...process.env,
      EXPO_PUBLIC_DOMAIN: expoPublicDomain,
      EXPO_PUBLIC_REPL_ID: expoPublicReplId,
      REACT_NATIVE_PACKAGER_HOSTNAME: 'localhost',
    };
    let child;
    const expoArgs = [
      'exec',
      'expo',
      'start',
      '--no-dev',
      '--minify',
      '--localhost',
      '--port',
      String(port),
    ];
    const pnpmInvocation = getPnpmInvocation(expoArgs);
    try {
      child = spawn(pnpmInvocation.command, pnpmInvocation.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        cwd: projectRoot,
        env,
        windowsHide: true,
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    runtime.metroProcess = child;
    const monitor = createMetroMonitor(child);
    const abortMetro = () => monitor.controller.abort();
    if (runtime.abortController.signal.aborted) {
      monitor.controller.abort();
    } else {
      runtime.abortController.signal.addEventListener('abort', abortMetro, {
        once: true,
      });
    }
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log(`[Metro] ${output}`);
        }
        if (
          output.includes(`:${port}`) &&
          (output.includes('Waiting on') || output.includes('Metro'))
        ) {
          monitor.outputReady = true;
        }
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.error(`[Metro Error] ${output}`);
        }
      });
    }

    try {
      await waitForMetroReady(child, port, monitor);
      runtime.abortController.signal.removeEventListener('abort', abortMetro);
      const abortOnUnexpectedExit = () => {
        if (
          runtime.metroProcess === child &&
          !runtime.cleaning &&
          !runtime.stoppingMetro
        ) {
          runtime.abortController.abort(
            new Error('Metro child exited before the build completed'),
          );
        }
      };
      child.once('exit', abortOnUnexpectedExit);
      return { child, port, origin: `http://localhost:${port}` };
    } catch (error) {
      runtime.abortController.signal.removeEventListener('abort', abortMetro);
      lastError = error;
      await terminateChild(child);
      if (runtime.metroProcess === child) {
        runtime.metroProcess = null;
      }
      if (runtime.interrupted) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Metro could not be started');
}

function parseJsStringLiteral(literal, label) {
  try {
    const value = JSON.parse(literal);
    return assertSafeString(value, label, { allowEmpty: true });
  } catch (error) {
    throw new Error(`Invalid ${label} in bundle: ${error.message}`);
  }
}

function readBundleStringField(body, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|[,{}])\\s*${escapedField}\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`,
    'm',
  );
  const match = body.match(pattern);
  if (!match) {
    throw new Error(`Asset field ${field} is missing from bundle`);
  }
  return parseJsStringLiteral(match[1], field);
}

function decodeAssetComponent(value, label) {
  let decoded = assertSafeString(value, label, { allowEmpty: true });
  for (let index = 0; index < 2; index += 1) {
    if (hasControlCharacters(decoded)) {
      throw new Error(`${label} contains control characters`);
    }
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid percent encoding`);
    }
  }
  if (hasControlCharacters(decoded)) {
    throw new Error(`${label} contains control characters`);
  }
  if (/["'`]/.test(decoded) || decoded.includes('\\')) {
    throw new Error(`${label} contains a quote or backslash`);
  }
  return decoded;
}

function normalizeAssetRelativePath(value) {
  assertSafeString(value, 'unstable_path');
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    /["'`]/.test(value)
  ) {
    throw new Error(`Unsafe unstable_path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.') {
    throw new Error(`Unsafe unstable_path: ${value}`);
  }
  if (normalized.startsWith('../') || normalized === '..') {
    const resolved = path.resolve(projectRoot, ...value.split('/'));
    const workspaceRelative = path
      .relative(workspaceRoot, resolved)
      .split(path.sep)
      .join('/');
    if (
      !isWithin(workspaceRoot, resolved) ||
      !workspaceRelative ||
      workspaceRelative === '..' ||
      workspaceRelative.startsWith('../') ||
      path.posix.isAbsolute(workspaceRelative) ||
      path.win32.isAbsolute(workspaceRelative) ||
      !/^node_modules(?:\/|$)/.test(workspaceRelative)
    ) {
      throw new Error(`Path traversal in unstable_path: ${value}`);
    }
    return normalizeAssetRelativePath(workspaceRelative);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`Path traversal in unstable_path: ${value}`);
  }
  return normalized;
}

function parseMetroAssetLocation(value, metroOrigin, label) {
  let parsed;
  try {
    parsed = new URL(value, `${metroOrigin}/`);
  } catch {
    throw new Error(`Invalid ${label} URL in bundle`);
  }
  const port = new URL(metroOrigin).port;
  const allowedOrigins = new Set([
    metroOrigin,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  if (
    !allowedOrigins.has(parsed.origin) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(`Non-local ${label} URL in bundle`);
  }
  return parsed;
}

function assetIdentity(asset) {
  return [
    asset.platform,
    asset.relativePath,
    asset.name,
    asset.type,
    asset.hash,
  ].join('\u0000');
}

function readBundleScales(body) {
  const match = body.match(/(?:^|[,{])\s*scales\s*:\s*(\[[^\]]*\])/m);
  if (!match) {
    return [1];
  }
  let scales;
  try {
    scales = JSON.parse(match[1]);
  } catch {
    throw new Error('Invalid asset scales in bundle');
  }
  if (
    !Array.isArray(scales) ||
    scales.length === 0 ||
    scales.some((scale) => typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)
  ) {
    throw new Error('Invalid asset scales in bundle');
  }
  return scales;
}

function parseAssetRecord(body, platform, metroOrigin) {
  const location = readBundleStringField(body, 'httpServerLocation');
  const parsedLocation = parseMetroAssetLocation(
    location,
    metroOrigin,
    'asset',
  );
  const unstablePath = parsedLocation.searchParams.get('unstable_path');
  if (!unstablePath) {
    throw new Error(`Asset missing unstable_path: ${location}`);
  }
  const decodedPath = normalizeAssetRelativePath(
    decodeAssetComponent(unstablePath, 'unstable_path'),
  );
  const name = decodeAssetComponent(
    readBundleStringField(body, 'name'),
    'asset name',
  );
  const type = decodeAssetComponent(
    readBundleStringField(body, 'type'),
    'asset type',
  );
  if (!name || name.includes('/')) {
    throw new Error(`Unsafe asset name: ${name}`);
  }
  if (!/^[A-Za-z0-9]+$/.test(type)) {
    throw new Error(`Unsafe asset type: ${type}`);
  }
  const hash = readBundleStringField(body, 'hash');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hash)) {
    throw new Error(`Unsafe asset hash: ${hash}`);
  }
  const asset = {
    platform,
    relativePath: decodedPath,
    name,
    filename: `${name}.${type}`,
    type,
    hash,
    scales: readBundleScales(body),
    originalPath: `${parsedLocation.pathname}${parsedLocation.search}`,
  };
  asset.key = assetIdentity(asset);
  return asset;
}

function extractAssets(ctx) {
  const bundles = {};
  for (const platform of PLATFORMS) {
    const bundlePath = path.join(
      ctx.stagingRoot,
      ctx.timestamp,
      '_expo',
      'static',
      'js',
      platform,
      'bundle.js',
    );
    bundles[platform] = fs.readFileSync(bundlePath, 'utf-8');
  }

  const assetsMap = new Map();
  const assetPattern = /registerAsset\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const platform of PLATFORMS) {
    const matches = [...bundles[platform].matchAll(assetPattern)];
    const registrations = (
      bundles[platform].match(/registerAsset\s*\(\s*\{/g) || []
    ).length;
    if (matches.length !== registrations) {
      throw new Error(`Could not parse every ${platform} asset registration`);
    }
    for (const match of matches) {
      const asset = parseAssetRecord(match[1], platform, ctx.metroOrigin);
      if (assetsMap.has(asset.key)) {
        throw new Error(`Duplicate asset registration: ${asset.filename}`);
      }
      assetsMap.set(asset.key, asset);
    }
  }
  return Array.from(assetsMap.values());
}

function resolveAssetSource(asset) {
  const roots = [...new Set([projectRoot, workspaceRoot])];
  for (const root of roots) {
    let candidate;
    try {
      candidate = resolveBoundedPath(root, asset.relativePath, asset.filename);
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile()) {
        continue;
      }
      const realRoot = fs.realpathSync(root);
      const realCandidate = fs.realpathSync(candidate);
      const realWorkspace = fs.realpathSync(workspaceRoot);
      if (!isWithin(realRoot, realCandidate) && !isWithin(realWorkspace, realCandidate)) {
        continue;
      }
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        throw error;
      }
    }
  }
  throw new Error(`Asset not found on disk: ${asset.filename}`);
}

async function copyAssets(assets, ctx) {
  if (assets.length === 0) {
    return 0;
  }
  console.log('Copying assets...');
  const assetRoot = path.join(
    ctx.stagingRoot,
    ctx.timestamp,
    '_expo',
    'static',
    'js',
  );
  let successCount = 0;
  for (const asset of assets) {
    assertNotInterrupted();
    const source = resolveAssetSource(asset);
    const output = resolveBoundedPath(
      assetRoot,
      asset.relativePath,
      asset.filename,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const realAssetRoot = fs.realpathSync(assetRoot);
    if (!isWithin(realAssetRoot, path.dirname(output))) {
      throw new Error(`Asset destination escapes staging: ${asset.filename}`);
    }
    if (fs.existsSync(output)) {
      const sourceContent = fs.readFileSync(source);
      const outputContent = fs.readFileSync(output);
      if (!sourceContent.equals(outputContent)) {
        throw new Error(`Conflicting asset content: ${asset.filename}`);
      }
    } else {
      fs.copyFileSync(source, output);
    }
    const stat = fs.statSync(output);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Copied asset is invalid: ${asset.filename}`);
    }
    successCount += 1;
  }
  console.log(`Copied ${successCount} assets`);
  return successCount;
}

function encodePublicPath(basePath, segments) {
  const rawPath = path.posix.join('/', basePath, ...segments);
  if (rawPath.includes('\\') || hasControlCharacters(rawPath)) {
    throw new Error('Generated public path is unsafe');
  }
  const encoded = rawPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded || '/';
}

function makePublicUrl(ctx, ...segments) {
  const pathname = encodePublicPath(ctx.basePath, segments);
  return `${ctx.origin}${pathname === '/' ? '/' : pathname}`;
}

function serializeBundleString(value) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new Error('Could not serialize bundle value');
  }
  return serialized
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function updateBundleUrls(ctx, assets) {
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]));
  const assetPattern = /registerAsset\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const platform of PLATFORMS) {
    const bundlePath = path.join(
      ctx.stagingRoot,
      ctx.timestamp,
      '_expo',
      'static',
      'js',
      platform,
      'bundle.js',
    );
    let bundle = fs.readFileSync(bundlePath, 'utf-8');
    let replacements = 0;
    const registrations = (bundle.match(/registerAsset\s*\(\s*\{/g) || []).length;
    bundle = bundle.replace(assetPattern, (fullMatch, body) => {
      const asset = parseAssetRecord(body, platform, ctx.metroOrigin);
      if (!assetsByKey.has(asset.key)) {
        throw new Error(`No validated asset for bundle URL: ${asset.filename}`);
      }
      let objectReplacements = 0;
      const rewritten = fullMatch.replace(
        /httpServerLocation\s*:\s*("(?:\\.|[^"\\])*")/g,
        (match, literal) => {
          objectReplacements += 1;
          parseJsStringLiteral(literal, 'httpServerLocation');
          return `httpServerLocation:${serializeBundleString(
            makePublicUrl(
              ctx,
              ctx.timestamp,
              '_expo',
              'static',
              'js',
              asset.relativePath,
              asset.filename,
            ),
          )}`;
        },
      );
      if (objectReplacements !== 1) {
        throw new Error(`Asset has an invalid URL field: ${asset.filename}`);
      }
      replacements += objectReplacements;
      return rewritten;
    });
    if (replacements !== registrations) {
      throw new Error(`Not every ${platform} asset URL was rewritten`);
    }
    bundle = bundle.replace(/\/\/# sourceMappingURL=[^\r\n]*/g, '');
    bundle = bundle.replace(
      /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?/gi,
      `${makePublicUrl(ctx)}`,
    );
    bundle = bundle.replace(
      /"localhost"===([A-Za-z_$][\w$]*)&&\(\1=""\),/g,
      '',
    );
    if (LOCAL_URL_PATTERN.test(bundle)) {
      throw new Error(`${platform} bundle still contains a local URL`);
    }
    if (/sourceMappingURL/i.test(bundle)) {
      throw new Error(`${platform} bundle still contains a source map URL`);
    }
    fs.writeFileSync(bundlePath, bundle);
  }
  console.log('Updated bundle URLs');
}

function assertSafeConfigPath(value, label) {
  assertSafeString(value, label);
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid percent encoding`);
    }
  }
  if (
    value.startsWith('/') ||
    decoded.startsWith('/') ||
    value.includes('\\') ||
    decoded.includes('\\') ||
    /^[A-Za-z]:/.test(value) ||
    /^[A-Za-z]:/.test(decoded) ||
    /["'`]/.test(value) ||
    /["'`]/.test(decoded) ||
    decoded.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`${label} is not a safe relative path`);
  }
  return value;
}

function pickExpoClient(rawClient) {
  if (!rawClient || typeof rawClient !== 'object' || Array.isArray(rawClient)) {
    throw new Error('Manifest is missing expoClient');
  }
  const result = {};
  for (const field of [
    'name',
    'slug',
    'version',
    'orientation',
    'icon',
    'scheme',
    'userInterfaceStyle',
    'sdkVersion',
  ]) {
    if (typeof rawClient[field] === 'string') {
      result[field] = field === 'icon'
        ? assertSafeConfigPath(rawClient[field], 'expoClient.icon')
        : assertSafeString(rawClient[field], `expoClient.${field}`);
    }
  }
  if (rawClient.ios && typeof rawClient.ios === 'object') {
    result.ios = {};
    if (typeof rawClient.ios.supportsTablet === 'boolean') {
      result.ios.supportsTablet = rawClient.ios.supportsTablet;
    }
    if (
      rawClient.ios.infoPlist &&
      typeof rawClient.ios.infoPlist.NSLocalNetworkUsageDescription === 'string'
    ) {
      result.ios.infoPlist = {
        NSLocalNetworkUsageDescription: assertSafeString(
          rawClient.ios.infoPlist.NSLocalNetworkUsageDescription,
          'expoClient.ios.infoPlist.NSLocalNetworkUsageDescription',
        ),
      };
    }
  }
  if (rawClient.android && typeof rawClient.android === 'object') {
    if (Array.isArray(rawClient.android.permissions)) {
      result.android = {
        permissions: rawClient.android.permissions.map((permission) =>
          assertSafeString(permission, 'expoClient.android.permission'),
        ),
      };
    }
  }
  if (rawClient.web && typeof rawClient.web === 'object') {
    if (typeof rawClient.web.favicon === 'string') {
      result.web = {
        favicon: assertSafeConfigPath(
          rawClient.web.favicon,
          'expoClient.web.favicon',
        ),
      };
    }
  }
  if (Array.isArray(rawClient.platforms)) {
    result.platforms = rawClient.platforms.filter(
      (platform) => platform === 'ios' || platform === 'android',
    );
  }
  if (
    rawClient.extra &&
    typeof rawClient.extra === 'object' &&
    !Array.isArray(rawClient.extra) &&
    rawClient.extra.router &&
    typeof rawClient.extra.router === 'object' &&
    !Array.isArray(rawClient.extra.router)
  ) {
    result.extra = { router: {} };
  }
  return result;
}

function normalizeScales(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (scale) =>
        typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0,
    )
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value.slice();
}

function sanitizeAssetMetadata(value, label, depth = 0) {
  if (depth > 8 || value === null) {
    if (depth > 8) {
      throw new Error(`${label} is too deep`);
    }
    return null;
  }
  if (typeof value === 'string') {
    return assertSafeString(value, label, { allowEmpty: true });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} is invalid`);
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeAssetMetadata(item, `${label}[${index}]`, depth + 1),
    );
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} is invalid`);
  }
  const result = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (
      FORBIDDEN_MANIFEST_KEYS.has(key) ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      throw new Error(`${label} contains forbidden field ${key}`);
    }
    result[key] = sanitizeAssetMetadata(child, `${label}.${key}`, depth + 1);
  }
  return result;
}

function rawAssetMatches(asset, rawAsset, ctx) {
  if (
    rawAsset.hash !== asset.hash ||
    rawAsset.name !== asset.name ||
    rawAsset.type !== asset.type
  ) {
    return false;
  }
  if (typeof rawAsset.url !== 'string') {
    return true;
  }
  const parsed = parseMetroAssetLocation(rawAsset.url, ctx.metroOrigin, 'asset');
  const unstablePath = parsed.searchParams.get('unstable_path');
  if (unstablePath) {
    return (
      normalizeAssetRelativePath(
        decodeAssetComponent(unstablePath, 'unstable_path'),
      ) === asset.relativePath
    );
  }
  const pathname = decodePublicPathname(parsed.pathname, 'asset URL');
  return pathname.endsWith(`/${asset.filename}`);
}

function makeManifestAsset(asset, rawAsset, ctx) {
  const result = {
    hash: asset.hash,
    name: asset.name,
    type: asset.type,
    scales: rawAsset && Object.hasOwn(rawAsset, 'scales')
      ? normalizeScales(rawAsset.scales, 'asset scales')
      : normalizeScales(asset.scales || [1], 'asset scales'),
    url: makePublicUrl(
      ctx,
      ctx.timestamp,
      '_expo',
      'static',
      'js',
      asset.relativePath,
      asset.filename,
    ),
  };
  if (rawAsset && Object.hasOwn(rawAsset, 'metadata')) {
    result.metadata = sanitizeAssetMetadata(rawAsset.metadata, 'asset.metadata');
  }
  return result;
}

function makeManifestAssetKey(asset) {
  return [asset.hash, asset.name, asset.type, asset.url].join('\u0000');
}

function makeDebuggerHost(ctx, platform) {
  return `${new URL(ctx.origin).host}${encodePublicPath(ctx.basePath, [platform])}`;
}

function buildManifest(ctx, rawManifest, platform, assets) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error(`Malformed raw manifest for ${platform}`);
  }
  if (
    !rawManifest.launchAsset ||
    typeof rawManifest.launchAsset !== 'object' ||
    typeof rawManifest.launchAsset.url !== 'string'
  ) {
    throw new Error(`Malformed launchAsset for ${platform}`);
  }
  parseMetroAssetLocation(
    rawManifest.launchAsset.url,
    ctx.metroOrigin,
    'launchAsset',
  );
  if (!Array.isArray(rawManifest.assets)) {
    throw new Error(`Malformed assets for ${platform}`);
  }
  if (typeof rawManifest.runtimeVersion !== 'string') {
    throw new Error(`Malformed runtimeVersion for ${platform}`);
  }
  if (typeof rawManifest.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(rawManifest.id)) {
    throw new Error(`Malformed manifest id for ${platform}`);
  }

  const platformAssets = assets.filter((asset) => asset.platform === platform);
  const matchedRawAssets = new Map();
  const usedAssets = new Set();
  if (rawManifest.assets.length > 0) {
    for (const rawAsset of rawManifest.assets) {
      if (
        !rawAsset ||
        typeof rawAsset !== 'object' ||
        typeof rawAsset.hash !== 'string' ||
        typeof rawAsset.name !== 'string' ||
        typeof rawAsset.type !== 'string'
      ) {
        throw new Error(`Malformed raw asset for ${platform}`);
      }
      const candidates = platformAssets.filter(
        (asset) =>
          !usedAssets.has(asset.key) && rawAssetMatches(asset, rawAsset, ctx),
      );
      if (candidates.length !== 1) {
        throw new Error(`Raw asset does not uniquely match the bundle for ${platform}`);
      }
      usedAssets.add(candidates[0].key);
      matchedRawAssets.set(candidates[0].key, rawAsset);
    }
    for (const asset of platformAssets) {
      if (!usedAssets.has(asset.key)) {
        throw new Error(`Bundle asset is missing from raw manifest for ${platform}`);
      }
    }
  }
  const manifestAssets = platformAssets.map((asset) =>
    makeManifestAsset(asset, matchedRawAssets.get(asset.key), ctx),
  );

  const rawClient = rawManifest.extra?.expoClient;
  const expoClient = pickExpoClient(rawClient);
  return {
    id: rawManifest.id,
    createdAt: new Date().toISOString(),
    runtimeVersion: assertSafeString(
      rawManifest.runtimeVersion,
      `runtimeVersion.${platform}`,
    ),
    launchAsset: {
      key: `bundle-${ctx.timestamp}`,
      contentType: 'application/javascript',
      url: makePublicUrl(
        ctx,
        ctx.timestamp,
        '_expo',
        'static',
        'js',
        platform,
        'bundle.js',
      ),
    },
    assets: manifestAssets,
    metadata: {},
    extra: {
      expoClient,
      expoGo: {
        debuggerHost: makeDebuggerHost(ctx, platform),
        packagerOpts: { dev: false },
      },
    },
  };
}

function writeManifests(ctx, rawManifests, assets) {
  for (const platform of PLATFORMS) {
    const manifest = buildManifest(ctx, rawManifests[platform], platform, assets);
    const manifestPath = path.join(ctx.stagingRoot, platform, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log('Manifests written');
}

function assertNoForbiddenKeys(value, location = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MANIFEST_KEYS.has(key)) {
      throw new Error(`Forbidden manifest field ${location}.${key}`);
    }
    assertNoForbiddenKeys(child, `${location}.${key}`);
  }
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink in build output: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(`Unsupported build output entry: ${entryPath}`);
      }
    }
  };
  visit(root);
  return files;
}

function assertNoSensitiveText(text, filePath) {
  if (LOCAL_URL_PATTERN.test(text)) {
    throw new Error(`Local URL remains in build output: ${filePath}`);
  }
  if (/sourceMappingURL/i.test(text)) {
    throw new Error(`Source map URL remains in build output: ${filePath}`);
  }
  if (text.includes(projectRoot) || text.includes(workspaceRoot)) {
    throw new Error(`Absolute workspace path remains in build output: ${filePath}`);
  }
  if (
    /["'](?:_internal|projectRoot|staticConfigPath|packageJsonPath|username|iconUrl|scriptURL|sourceMappingURL)["']\s*:/.test(
      text,
    )
  ) {
    throw new Error(`Sensitive field remains in build output: ${filePath}`);
  }
}

function decodePublicPathname(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`${label} has invalid percent encoding`);
  }
  if (
    hasControlCharacters(decoded) ||
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`${label} contains an unsafe path`);
  }
  return decoded;
}

function resolvePublicFile(ctx, value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not an absolute URL`);
  }
  if (
    parsed.origin !== ctx.origin ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} is not a safe public URL`);
  }
  const pathname = decodePublicPathname(parsed.pathname, label);
  const prefix = `${ctx.basePath}/${ctx.timestamp}/_expo/static/js/`;
  if (!pathname.startsWith(prefix)) {
    throw new Error(`${label} points outside the generated bundle: ${value}`);
  }
  const relative = pathname.slice(prefix.length);
  if (!relative) {
    throw new Error(`${label} has an empty file path`);
  }
  const candidate = resolveBoundedPath(
    ctx.stagingRoot,
    `${ctx.timestamp}/_expo/static/js`,
    relative,
  );
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile()) {
    throw new Error(`${label} does not point to a file: ${value}`);
  }
  const realRoot = fs.realpathSync(ctx.stagingRoot);
  const realCandidate = fs.realpathSync(candidate);
  if (!isWithin(realRoot, realCandidate)) {
    throw new Error(`${label} escapes the build directory`);
  }
  return candidate;
}

function validateBundle(ctx, platform, assets) {
  const platformAssets = assets.filter((asset) => asset.platform === platform);
  const bundlePath = path.join(
    ctx.stagingRoot,
    ctx.timestamp,
    '_expo',
    'static',
    'js',
    platform,
    'bundle.js',
  );
  const stat = fs.lstatSync(bundlePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Invalid ${platform} bundle`);
  }
  const bundle = fs.readFileSync(bundlePath, 'utf-8');
  assertNoSensitiveText(bundle, bundlePath);
  const allowedUrls = new Set([
    makePublicUrl(
      ctx,
      ctx.timestamp,
      '_expo',
      'static',
      'js',
      platform,
      'bundle.js',
    ),
    ...platformAssets.map((asset) =>
      makePublicUrl(
        ctx,
        ctx.timestamp,
        '_expo',
        'static',
        'js',
        asset.relativePath,
        asset.filename,
      ),
    ),
  ]);
  const locations = [
    ...bundle.matchAll(/httpServerLocation\s*:\s*("(?:\\.|[^"\\])*")/g),
  ];
  for (const match of locations) {
    const location = parseJsStringLiteral(match[1], 'httpServerLocation');
    if (!allowedUrls.has(location)) {
      throw new Error(`${platform} bundle contains an unapproved asset URL`);
    }
    resolvePublicFile(ctx, location, `${platform} bundle asset URL`);
  }
}

function validateManifest(ctx, platform, assets) {
  const manifestPath = path.join(ctx.stagingRoot, platform, 'manifest.json');
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Invalid ${platform} manifest`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assertNoForbiddenKeys(manifest);
  assertNoSensitiveText(JSON.stringify(manifest), manifestPath);
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
      throw new Error(`Unexpected manifest field: ${key}`);
    }
  }
  if (!manifest.launchAsset || !Array.isArray(manifest.assets)) {
    throw new Error(`Malformed generated manifest for ${platform}`);
  }
  const expectedBundleUrl = makePublicUrl(
    ctx,
    ctx.timestamp,
    '_expo',
    'static',
    'js',
    platform,
    'bundle.js',
  );
  if (
    manifest.launchAsset.url !== expectedBundleUrl ||
    manifest.launchAsset.contentType !== 'application/javascript'
  ) {
    throw new Error(`Invalid launchAsset URL for ${platform}`);
  }
  resolvePublicFile(ctx, manifest.launchAsset.url, `${platform} launchAsset`);

  const platformAssets = assets.filter((asset) => asset.platform === platform);
  const expectedAssets = new Map(
    platformAssets.map((asset) => [
      makeManifestAssetKey(makeManifestAsset(asset, undefined, ctx)),
      asset,
    ]),
  );
  const seenKeys = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new Error(`Malformed asset in ${platform} manifest`);
    }
    const allowedAssetFields = new Set([
      'hash',
      'name',
      'type',
      'scales',
      'metadata',
      'url',
    ]);
    for (const key of Object.keys(asset)) {
      if (!allowedAssetFields.has(key)) {
        throw new Error(`Unexpected asset field: ${key}`);
      }
    }
    if (
      typeof asset.hash !== 'string' ||
      typeof asset.name !== 'string' ||
      typeof asset.type !== 'string' ||
      typeof asset.url !== 'string'
    ) {
      throw new Error(`Malformed asset in ${platform} manifest`);
    }
    normalizeScales(asset.scales, `${platform} asset scales`);
    if (Object.hasOwn(asset, 'metadata')) {
      sanitizeAssetMetadata(asset.metadata, `${platform} asset metadata`);
    }
    const key = makeManifestAssetKey(asset);
    if (!expectedAssets.has(key) || seenKeys.has(key)) {
      throw new Error(`Unapproved or duplicate asset for ${platform}`);
    }
    seenKeys.add(key);
    resolvePublicFile(ctx, asset.url, `${platform} asset URL`);
  }
  if (seenKeys.size !== expectedAssets.size) {
    throw new Error(`Asset count mismatch for ${platform}`);
  }
  for (const key of expectedAssets.keys()) {
    if (!seenKeys.has(key)) {
      throw new Error(`Asset is missing from ${platform} manifest`);
    }
  }
  validateBundle(ctx, platform, assets);
}

function validateStaging(ctx, assets) {
  const files = listFiles(ctx.stagingRoot);
  const textExtensions = new Set([
    '.js',
    '.json',
    '.html',
    '.css',
    '.map',
    '.txt',
    '.xml',
    '.svg',
  ]);
  for (const file of files) {
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      assertNoSensitiveText(fs.readFileSync(file, 'utf-8'), file);
    }
  }
  for (const platform of PLATFORMS) {
    validateManifest(ctx, platform, assets);
  }
  const expectedAssetFiles = new Set(
    assets.map((asset) =>
      path.relative(
        ctx.stagingRoot,
        path.join(
          ctx.stagingRoot,
          ctx.timestamp,
          '_expo',
          'static',
          'js',
          asset.relativePath,
          asset.filename,
        ),
      ),
    ),
  );
  const actualAssetFiles = listFiles(
    path.join(ctx.stagingRoot, ctx.timestamp, '_expo', 'static', 'js'),
  )
    .map((file) => path.relative(ctx.stagingRoot, file))
    .filter((file) => !file.endsWith(`${path.sep}ios${path.sep}bundle.js`) && !file.endsWith(`${path.sep}android${path.sep}bundle.js`));
  for (const file of actualAssetFiles) {
    if (!expectedAssetFiles.has(file)) {
      throw new Error(`Unexpected asset file in build output: ${file}`);
    }
  }
  if (actualAssetFiles.length !== expectedAssetFiles.size) {
    throw new Error('Asset file count does not match manifest');
  }
}

async function downloadFile(url, outputPath, parentSignal) {
  const expectedOrigin = new URL(url).origin;
  await fetchWithLifecycle(
    url,
    { signal: parentSignal },
    async (response) => {
      if (!response.body) {
        throw new Error('Download response has no body');
      }
      let size = 0;
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          if (size > MAX_DOWNLOAD_BYTES) {
            callback(new Error('Downloaded file is too large'));
            return;
          }
          callback(null, chunk);
        },
      });
      const file = fs.createWriteStream(outputPath, { flags: 'wx' });
      try {
        await pipeline(Readable.fromWeb(response.body), limiter, file);
      } catch (error) {
        file.destroy();
        removePathIfExists(outputPath);
        throw error;
      }
      if (size === 0) {
        removePathIfExists(outputPath);
        throw new Error('Downloaded file is empty');
      }
    },
    'Download',
    REQUEST_TIMEOUT_MS,
    expectedOrigin,
  );
}

function makeBundleUrl(ctx, platform) {
  const entryPath = path.resolve(
    projectRoot,
    'node_modules',
    'expo-router',
    'entry',
  );
  const bundlePath = path.relative(workspaceRoot, entryPath).split(path.sep).join('/');
  if (
    bundlePath.startsWith('..') ||
    path.isAbsolute(bundlePath) ||
    bundlePath.includes('\\')
  ) {
    throw new Error('Expo entry path escapes workspace root');
  }
  const encodedBundlePath = bundlePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = new URL(`/${encodedBundlePath}.bundle`, `${ctx.metroOrigin}/`);
  url.searchParams.set('platform', platform);
  url.searchParams.set('dev', 'false');
  url.searchParams.set('hot', 'false');
  url.searchParams.set('lazy', 'false');
  url.searchParams.set('minify', 'true');
  return url.toString();
}

async function downloadBundle(ctx, platform) {
  const output = path.join(
    ctx.stagingRoot,
    ctx.timestamp,
    '_expo',
    'static',
    'js',
    platform,
    'bundle.js',
  );
  console.log(`Fetching ${platform} bundle...`);
  await downloadFile(makeBundleUrl(ctx, platform), output, ctx.signal);
  console.log(`${platform} bundle ready`);
}

async function downloadManifest(ctx, platform, signal) {
  console.log(`Fetching ${platform} manifest...`);
  const text = await fetchWithLifecycle(
    `${ctx.metroOrigin}/manifest`,
    { signal, headers: { 'expo-platform': platform } },
    async (response) =>
      readResponseText(response, `${platform} manifest`, 4 * 1024 * 1024),
    `${platform} manifest`,
    REQUEST_TIMEOUT_MS,
    ctx.metroOrigin,
  );
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error(`${platform} manifest is not valid JSON`);
  }
  console.log(`${platform} manifest ready`);
  return manifest;
}

async function downloadBundlesAndManifests(ctx) {
  console.log('Downloading bundles and manifests...');
  console.log('This may take several minutes for production builds...');

  return withTimeout('Bundle and manifest download', BUILD_TIMEOUT_MS, async (signal) => {
    // Bundles are sequential — Metro can't handle both platforms simultaneously
    // without stalling. Manifests are cheap and run in parallel after.
    await downloadBundle({ ...ctx, signal }, 'ios');
    await downloadBundle({ ...ctx, signal }, 'android');

    const manifestController = new AbortController();
    const abortManifests = () => manifestController.abort();
    signal.addEventListener('abort', abortManifests, { once: true });
    try {
      const [iosManifest, androidManifest] = await Promise.all([
        downloadManifest(ctx, 'ios', manifestController.signal),
        downloadManifest(ctx, 'android', manifestController.signal),
      ]);
      console.log('All downloads completed successfully');
      return { ios: iosManifest, android: androidManifest };
    } catch (error) {
      manifestController.abort();
      throw error;
    } finally {
      signal.removeEventListener('abort', abortManifests);
    }
  });
}

function unlinkOwnedPath(target, expectedStat) {
  try {
    const current = fs.lstatSync(target);
    if (
      current.isFile() &&
      current.dev === expectedStat.dev &&
      current.ino === expectedStat.ino
    ) {
      fs.unlinkSync(target);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function quarantineStaleLock() {
  let observedStat;
  try {
    observedStat = fs.lstatSync(LOCK_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (!observedStat.isFile()) {
    return false;
  }
  const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').split('\n')[0]);
  if (!Number.isInteger(pid) || isProcessAlive(pid)) {
    return false;
  }
  const quarantine = `${LOCK_PATH}.stale-${process.pid}-${Date.now()}-${Math.floor(
    Math.random() * 1_000_000,
  )}`;
  try {
    fs.renameSync(LOCK_PATH, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  let quarantinedStat;
  try {
    quarantinedStat = fs.lstatSync(quarantine);
  } catch (error) {
    throw new Error(`Lock quarantine could not be verified: ${error.message}`);
  }
  if (
    quarantinedStat.dev !== observedStat.dev ||
    quarantinedStat.ino !== observedStat.ino
  ) {
    try {
      if (!fs.existsSync(LOCK_PATH)) {
        fs.renameSync(quarantine, LOCK_PATH);
      }
    } catch (restoreError) {
      throw new Error(`Lock quarantine restore failed: ${restoreError.message}`);
    }
    throw new Error('Another netcast-remote build is already running');
  }
  unlinkOwnedPath(quarantine, quarantinedStat);
  return true;
}

function acquireBuildLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd;
    let created = false;
    let createdStat;
    try {
      fd = fs.openSync(LOCK_PATH, 'wx', 0o600);
      created = true;
      createdStat = fs.fstatSync(fd);
      fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, 'utf8');
      return { fd, path: LOCK_PATH, stat: createdStat };
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
        }
      }
      if (created && createdStat) {
        unlinkOwnedPath(LOCK_PATH, createdStat);
      }
      if (error.code !== 'EEXIST') {
        throw error;
      }
      if (!quarantineStaleLock()) {
        throw new Error('Another netcast-remote build is already running');
      }
    }
  }
  throw new Error('Another netcast-remote build is already running');
}

function releaseBuildLock(lock) {
  if (!lock) {
    return;
  }
  try {
    fs.closeSync(lock.fd);
  } catch (error) {
    if (error.code !== 'EBADF') {
      throw error;
    }
  }
  unlinkOwnedPath(lock.path, lock.stat);
}

function listBuildEntries(prefix) {
  return fs
    .readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => ({
      name: entry.name,
      path: path.join(projectRoot, entry.name),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
}

function cleanupStaleStaging() {
  for (const entry of listBuildEntries(STAGING_PREFIX)) {
    if (!entry.isDirectory && !entry.isSymbolicLink) {
      throw new Error(`Unexpected staging entry: ${entry.path}`);
    }
    removePathIfExists(entry.path);
  }
}

function recoverInterruptedPromotion() {
  const staticBuild = path.join(projectRoot, 'static-build');
  let finalEntry;
  try {
    finalEntry = fs.lstatSync(staticBuild);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const backupEntries = listBuildEntries(BACKUP_PREFIX);
  if (
    backupEntries.some(
      (entry) => !entry.isDirectory || entry.isSymbolicLink,
    )
  ) {
    throw new Error('Invalid static-build backup entry');
  }
  const backups = backupEntries;
  if (!finalEntry) {
    if (backups.length > 1) {
      throw new Error('Multiple static-build backups require manual recovery');
    }
    if (backups.length === 1) {
      normalizeBuildTreeModes(backups[0].path, FINAL_BUILD_MODE);
      fs.renameSync(backups[0].path, staticBuild);
      normalizeBuildTreeModes(staticBuild, FINAL_BUILD_MODE);
    }
  } else {
    normalizeBuildTreeModes(staticBuild, FINAL_BUILD_MODE);
  }
  cleanupStaleStaging();
}

function cleanupBackupDirectories() {
  for (const entry of listBuildEntries(BACKUP_PREFIX)) {
    if (!entry.isDirectory || entry.isSymbolicLink) {
      throw new Error(`Invalid static-build backup entry: ${entry.path}`);
    }
    removePathIfExists(entry.path);
  }
}

function createStagingDirectory() {
  const stagingRoot = fs.mkdtempSync(path.join(projectRoot, STAGING_PREFIX));
  normalizeDirectoryMode(stagingRoot, STAGING_MODE);
  return stagingRoot;
}

function promoteBuild(stagingRoot, timestamp) {
  const staticBuild = path.join(projectRoot, 'static-build');
  const backup = path.join(
    projectRoot,
    `${BACKUP_PREFIX}${timestamp}-${process.pid}`,
  );
  let oldMoved = false;
  let newMoved = false;
  try {
    normalizeBuildTreeModes(stagingRoot, STAGING_MODE);
    if (fs.existsSync(staticBuild)) {
      fs.renameSync(staticBuild, backup);
      oldMoved = true;
    }
    fs.renameSync(stagingRoot, staticBuild);
    newMoved = true;
    normalizeBuildTreeModes(staticBuild, FINAL_BUILD_MODE);
  } catch (error) {
    if (newMoved && oldMoved && fs.existsSync(backup)) {
      const failedBuild = `${staticBuild}.failed-${timestamp}-${process.pid}`;
      try {
        fs.renameSync(staticBuild, failedBuild);
        fs.renameSync(backup, staticBuild);
        removePathIfExists(failedBuild);
      } catch (restoreError) {
        throw new Error(
          `${error.message}; old build restore failed: ${restoreError.message}`,
        );
      }
    } else if (newMoved && !oldMoved) {
      try {
        fs.renameSync(staticBuild, stagingRoot);
      } catch (restoreError) {
        throw new Error(
          `${error.message}; failed build restore failed: ${restoreError.message}`,
        );
      }
    } else if (oldMoved && !newMoved && !fs.existsSync(staticBuild)) {
      try {
        fs.renameSync(backup, staticBuild);
      } catch (restoreError) {
        throw new Error(
          `${error.message}; old build restore failed: ${restoreError.message}`,
        );
      }
    }
    throw error;
  }
  try {
    cleanupBackupDirectories();
  } catch (error) {
    console.error(`Build backup cleanup failed: ${error.message}`);
  }
  return null;
}

function setupSignalHandlers() {
  const handleSignal = (signal) => {
    if (runtime.interrupted) {
      return;
    }
    runtime.interrupted = true;
    runtime.signal = signal;
    runtime.abortController.abort(new Error(`Received ${signal}`));
    void terminateChild(runtime.metroProcess).catch(() => {});
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => handleSignal(signal);
    runtime.signalHandlers.push({ signal, handler });
    process.on(signal, handler);
  }
}

function removeSignalHandlers() {
  for (const { signal, handler } of runtime.signalHandlers) {
    process.removeListener(signal, handler);
  }
  runtime.signalHandlers = [];
}

async function cleanupRuntime() {
  if (runtime.cleanupPromise) {
    return runtime.cleanupPromise;
  }
  runtime.cleaning = true;
  runtime.cleanupPromise = (async () => {
    runtime.abortController.abort();
    for (const controller of runtime.activeFetches) {
      controller.abort();
    }
    await terminateChild(runtime.metroProcess);
    for (const timer of runtime.timers) {
      clearTimeout(timer);
    }
    runtime.timers.clear();
    if (
      runtime.metroProcess &&
      runtime.metroProcess.exitCode === null &&
      runtime.metroProcess.signalCode === null
    ) {
      throw new Error('Metro child did not stop');
    }
    runtime.metroProcess = null;
    removeSignalHandlers();
  })();
  return runtime.cleanupPromise;
}

async function main() {
  setupSignalHandlers();
  let lock;
  let stagingRoot;
  try {
    lock = acquireBuildLock();
    recoverInterruptedPromotion();
    const basePath = normalizeBasePath(process.env.BASE_PATH);
    const origin = getCanonicalOrigin();
    const timestamp = `${Date.now()}-${process.pid}`;
    stagingRoot = createStagingDirectory();
    const ctx = {
      origin,
      basePath,
      timestamp,
      stagingRoot,
      metroOrigin: 'http://localhost:1',
      signal: runtime.abortController.signal,
    };
    prepareDirectories(stagingRoot, timestamp);
    clearMetroCache();

    const metro = await startMetro(ctx);
    ctx.metroOrigin = metro.origin;
    const rawManifests = await downloadBundlesAndManifests(ctx);
    assertNotInterrupted();

    console.log('Processing assets...');
    const assets = extractAssets(ctx);
    console.log('Found', assets.length, 'unique asset(s)');
    await copyAssets(assets, ctx);
    updateBundleUrls(ctx, assets);
    writeManifests(ctx, rawManifests, assets);
    validateStaging(ctx, assets);
    assertNotInterrupted();

    await terminateChild(metro.child);
    if (runtime.metroProcess === metro.child) {
      runtime.metroProcess = null;
    }
    assertNotInterrupted();
    promoteBuild(stagingRoot, timestamp);
    stagingRoot = null;
    assertNotInterrupted();
    console.log('Build complete! Deploy to:', origin);
  } finally {
    try {
      await cleanupRuntime();
    } finally {
      if (stagingRoot) {
        try {
          removePathIfExists(stagingRoot);
        } catch (error) {
          console.error(`Staging cleanup failed: ${error.message}`);
        }
      }
      try {
        releaseBuildLock(lock);
      } catch (error) {
        console.error(`Build lock cleanup failed: ${error.message}`);
      }
    }
  }
}

if (require.main === module) {
  main()
    .then(() => {
      process.exitCode = runtime.interrupted ? 1 : 0;
    })
    .catch((error) => {
      console.error('Build failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  assetIdentity,
  buildManifest,
  copyAssets,
  createStagingDirectory,
  extractAssets,
  getCanonicalOrigin,
  getPnpmInvocation,
  makeManifestAsset,
  makePublicUrl,
  normalizeAssetRelativePath,
  normalizeBasePath,
  parseAssetRecord,
  promoteBuild,
  quarantineStaleLock,
  readResponseText,
  recoverInterruptedPromotion,
  updateBundleUrls,
  validateStaging,
};
