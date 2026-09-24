import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { normalizeHost, type Connection } from '@/protocol/netcast'

export const CONNECTION_STORAGE_KEY = 'netcast-remote-connection'
export const SECURE_CONNECTION_KEY = 'netcast-remote-connection-secure'
export const LEGACY_SECURE_TOKEN_KEY = 'netcast-remote-access-token'
export const SECURE_TOKEN_KEY = LEGACY_SECURE_TOKEN_KEY
export const CONNECTION_STORAGE_VERSION = 3

export type CanonicalConnection = {
  version: typeof CONNECTION_STORAGE_VERSION
  host: string
  accessToken: string
  name: string
}

type StorageOperation =
  | 'read'
  | 'write'
  | 'remove'
  | 'parse'
  | 'secure-read'
  | 'secure-write'
  | 'secure-remove'
  | 'legacy-remove'

export class StorageError extends Error {
  readonly operation: StorageOperation
  readonly original: unknown

  constructor(operation: StorageOperation, original: unknown) {
    super('Depolama işlemi tamamlanamadı.')
    this.name = 'StorageError'
    this.operation = operation
    this.original = original
  }
}

export type LoadConnectionResult =
  | { status: 'missing' }
  | { status: 'invalid'; host?: string; name?: string; warning?: StorageError }
  | { status: 'ready'; connection: Connection; warning?: StorageError }

export type SaveConnectionResult = {
  stored: boolean
  warning?: StorageError
}

let storageTail = Promise.resolve()

function runStorageOperation<T>(operation: () => Promise<T>) {
  const result = storageTail.then(operation, operation)
  storageTail = result.then(() => undefined, () => undefined)
  return result
}

function firstError(...errors: Array<StorageError | undefined>) {
  return errors.find((error): error is StorageError => Boolean(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJsonRecord(raw: string) {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new StorageError('parse', error)
  }
  if (!isRecord(value)) throw new StorageError('parse', value)
  return value
}

function normalizedName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 120)
}

export function parseStoredConnection(raw: string) {
  const value = parseJsonRecord(raw)
  const host = typeof value.host === 'string' ? normalizeHost(value.host) : ''
  if (!host) throw new StorageError('parse', value)
  const legacyToken = typeof value.accessToken === 'string' ? value.accessToken.trim() : ''
  const name = normalizedName(value.name)
  return {
    host,
    legacyToken,
    name: name || undefined,
    hasLegacyFields: 'accessToken' in value || 'session' in value || value.version !== CONNECTION_STORAGE_VERSION,
  }
}

export function parseCanonicalConnection(raw: string): CanonicalConnection {
  const value = parseJsonRecord(raw)
  if (value.version !== CONNECTION_STORAGE_VERSION) throw new StorageError('parse', value)
  const host = typeof value.host === 'string' ? normalizeHost(value.host) : ''
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken.trim() : ''
  const name = normalizedName(value.name)
  if (!host || !accessToken || !name) throw new StorageError('parse', value)
  return {
    version: CONNECTION_STORAGE_VERSION,
    host,
    accessToken,
    name,
  }
}

function canonicalValue(connection: Connection): CanonicalConnection {
  return {
    version: CONNECTION_STORAGE_VERSION,
    host: normalizeHost(connection.host),
    accessToken: connection.accessToken.trim(),
    name: normalizedName(connection.name) || 'LG NetCast TV',
  }
}

function runtimeConnection(connection: CanonicalConnection): Connection {
  return {
    host: connection.host,
    accessToken: connection.accessToken,
    name: connection.name,
  }
}

async function cleanupLegacyStorage() {
  let warning: StorageError | undefined
  try {
    await AsyncStorage.removeItem(CONNECTION_STORAGE_KEY)
  } catch (error) {
    warning = new StorageError('remove', error)
  }
  try {
    await SecureStore.deleteItemAsync(LEGACY_SECURE_TOKEN_KEY)
  } catch (error) {
    warning ??= new StorageError('legacy-remove', error)
  }
  return warning
}

async function readLegacySecureToken() {
  try {
    return (await SecureStore.getItemAsync(LEGACY_SECURE_TOKEN_KEY))?.trim() ?? ''
  } catch {
    return ''
  }
}

async function removeInvalidCanonical(warning?: StorageError) {
  try {
    await SecureStore.deleteItemAsync(SECURE_CONNECTION_KEY)
  } catch (error) {
    return warning ?? new StorageError('secure-remove', error)
  }
  return warning
}

export function loadPersistedConnection(): Promise<LoadConnectionResult> {
  return runStorageOperation(async () => {
    let canonicalRaw: string | null = null
    let invalidCanonical = false
    let secureReadWarning: StorageError | undefined
    try {
      canonicalRaw = await SecureStore.getItemAsync(SECURE_CONNECTION_KEY)
    } catch (error) {
      secureReadWarning = new StorageError('secure-read', error)
    }

    if (canonicalRaw) {
      try {
        const canonical = parseCanonicalConnection(canonicalRaw)
        const warning = firstError(secureReadWarning, await cleanupLegacyStorage())
        return {
          status: 'ready',
          connection: runtimeConnection(canonical),
          ...(warning ? { warning } : {}),
        }
      } catch (error) {
        if (!(error instanceof StorageError)) throw error
        invalidCanonical = true
        secureReadWarning = await removeInvalidCanonical(secureReadWarning)
      }
    }

    let legacyRaw: string | null
    try {
      legacyRaw = await AsyncStorage.getItem(CONNECTION_STORAGE_KEY)
    } catch (error) {
      if (secureReadWarning) throw secureReadWarning
      throw new StorageError('read', error)
    }

    if (!legacyRaw) {
      if (invalidCanonical) {
        return {
          status: 'invalid',
          ...(secureReadWarning ? { warning: secureReadWarning } : {}),
        }
      }
      if (secureReadWarning) throw secureReadWarning
      return { status: 'missing' }
    }

    let legacy: ReturnType<typeof parseStoredConnection>
    try {
      legacy = parseStoredConnection(legacyRaw)
    } catch (error) {
      if (!(error instanceof StorageError)) throw error
      const warning = firstError(secureReadWarning, await cleanupLegacyStorage())
      return {
        status: 'invalid',
        ...(warning ? { warning } : {}),
      }
    }

    const accessToken = legacy.legacyToken || await readLegacySecureToken()
    if (!accessToken) {
      const warning = firstError(secureReadWarning, await cleanupLegacyStorage())
      return {
        status: 'invalid',
        host: legacy.host,
        ...(legacy.name ? { name: legacy.name } : {}),
        ...(warning ? { warning } : {}),
      }
    }

    const canonical: CanonicalConnection = {
      version: CONNECTION_STORAGE_VERSION,
      host: legacy.host,
      accessToken,
      name: legacy.name || 'LG NetCast TV',
    }

    try {
      await SecureStore.setItemAsync(SECURE_CONNECTION_KEY, JSON.stringify(canonical))
    } catch (error) {
      const cleanupWarning = await cleanupLegacyStorage()
      const rollbackWarning = await removeInvalidCanonical()
      const warning = firstError(
        new StorageError('secure-write', error),
        secureReadWarning,
        rollbackWarning,
        cleanupWarning,
      )
      return {
        status: 'invalid',
        host: legacy.host,
        ...(legacy.name ? { name: legacy.name } : {}),
        ...(warning ? { warning } : {}),
      }
    }

    const warning = firstError(secureReadWarning, await cleanupLegacyStorage())
    if (warning?.operation === 'remove') {
      const cleanupWarning = await removeInvalidCanonical(warning)
      return {
        status: 'invalid',
        host: legacy.host,
        ...(legacy.name ? { name: legacy.name } : {}),
        ...(cleanupWarning ? { warning: cleanupWarning } : {}),
      }
    }
    return {
      status: 'ready',
      connection: runtimeConnection(canonical),
      ...(warning ? { warning } : {}),
    }
  })
}

export function savePersistedConnection(connection: Connection): Promise<SaveConnectionResult> {
  return runStorageOperation(async () => {
    const canonical = canonicalValue(connection)
    if (!canonical.host || !canonical.accessToken) {
      return {
        stored: false,
        warning: new StorageError('write', new Error('invalid connection')),
      }
    }

    let previousRaw: string | null = null
    let previousCanonical: string | null = null
    try {
      previousRaw = await SecureStore.getItemAsync(SECURE_CONNECTION_KEY)
      if (previousRaw) {
        try {
          parseCanonicalConnection(previousRaw)
          previousCanonical = previousRaw
        } catch {
          previousCanonical = null
        }
      }
    } catch (error) {
      return {
        stored: false,
        warning: new StorageError('secure-read', error),
      }
    }

    try {
      await SecureStore.setItemAsync(SECURE_CONNECTION_KEY, JSON.stringify(canonical))
    } catch (error) {
      let rollbackWarning: StorageError | undefined
      try {
        if (previousCanonical) {
          await SecureStore.setItemAsync(SECURE_CONNECTION_KEY, previousCanonical)
        } else {
          await SecureStore.deleteItemAsync(SECURE_CONNECTION_KEY)
        }
      } catch (rollbackError) {
        rollbackWarning = new StorageError('secure-write', rollbackError)
      }
      const cleanupWarning = await cleanupLegacyStorage()
      return {
        stored: false,
        warning: firstError(new StorageError('secure-write', error), rollbackWarning, cleanupWarning),
      }
    }

    const cleanupWarning = await cleanupLegacyStorage()
    return {
      stored: true,
      ...(cleanupWarning ? { warning: cleanupWarning } : {}),
    }
  })
}

export function clearPersistedConnection() {
  return runStorageOperation(async () => {
    let firstStorageError: StorageError | undefined
    try {
      await SecureStore.deleteItemAsync(SECURE_CONNECTION_KEY)
    } catch (error) {
      firstStorageError = new StorageError('secure-remove', error)
    }
    try {
      await SecureStore.deleteItemAsync(LEGACY_SECURE_TOKEN_KEY)
    } catch (error) {
      firstStorageError ??= new StorageError('legacy-remove', error)
    }
    try {
      await AsyncStorage.removeItem(CONNECTION_STORAGE_KEY)
    } catch (error) {
      firstStorageError ??= new StorageError('remove', error)
    }
    if (firstStorageError) throw firstStorageError
  })
}
