import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEFAULT_LANGUAGE, isLanguage, type Language } from './messages'

export const LANGUAGE_STORAGE_KEY = 'netcast-remote-language'
export const LANGUAGE_LOAD_TIMEOUT_MS = 2000

export type LanguageLoadResult = {
  language: Language
  ready: true
}

export type LanguageReader = () => Promise<string | null>
export type LanguageWriter = (language: Language) => Promise<boolean | void>

export type LanguageWriteController = {
  enqueue: (language: Language) => Promise<boolean>
  drain: () => Promise<boolean>
  revision: () => number
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Language preference load timed out'))
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

export async function loadLanguagePreference(
  read: LanguageReader = () => AsyncStorage.getItem(LANGUAGE_STORAGE_KEY),
  timeoutMs = LANGUAGE_LOAD_TIMEOUT_MS,
): Promise<LanguageLoadResult> {
  try {
    const stored = await withTimeout(Promise.resolve().then(read), timeoutMs)
    return {
      language: isLanguage(stored) ? stored : DEFAULT_LANGUAGE,
      ready: true,
    }
  } catch {
    return {
      language: DEFAULT_LANGUAGE,
      ready: true,
    }
  }
}

export function chooseLoadedLanguage(
  selected: Language | null,
  loaded: Language,
): Language {
  return selected ?? loaded
}

export async function loadLanguage(): Promise<Language> {
  return (await loadLanguagePreference()).language
}

export async function saveLanguage(language: Language): Promise<boolean> {
  if (!isLanguage(language)) return false
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    return true
  } catch {
    return false
  }
}

export function createLanguageWriteController(
  write: LanguageWriter,
): LanguageWriteController {
  let revision = 0
  let tail: Promise<boolean> = Promise.resolve(true)

  const enqueue = (language: Language) => {
    if (!isLanguage(language)) return Promise.resolve(false)
    const requestRevision = ++revision
    const operation = tail.then(async () => {
      if (requestRevision !== revision) return false
      try {
        return (await write(language)) !== false
      } catch {
        return false
      }
    })
    tail = operation.catch(() => false)
    return operation
  }

  return {
    enqueue,
    drain: () => tail,
    revision: () => revision,
  }
}
