import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  translate,
  type Language,
  type MessageDescriptor,
  type MessageParams,
  type Translate,
} from './messages'
import {
  chooseLoadedLanguage,
  createLanguageWriteController,
  loadLanguagePreference,
  saveLanguage,
  type LanguageWriteController,
} from './preference'

export {
  LANGUAGE_LOAD_TIMEOUT_MS,
  LANGUAGE_STORAGE_KEY,
  chooseLoadedLanguage,
  createLanguageWriteController,
  loadLanguage,
  loadLanguagePreference,
  saveLanguage,
} from './preference'
export type {
  LanguageLoadResult,
  LanguageReader,
  LanguageWriteController,
  LanguageWriter,
} from './preference'

export type LanguageContextValue = {
  language: Language
  ready: boolean
  setLanguage: (language: Language) => void
  t: Translate
}

type LanguageProviderProps = {
  children: React.ReactNode
  onReady?: () => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children, onReady }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE)
  const [ready, setReady] = useState(false)
  const selectedLanguageRef = useRef<Language | null>(null)
  const onReadyRef = useRef(onReady)
  const writeControllerRef = useRef<LanguageWriteController | null>(null)

  if (!writeControllerRef.current) {
    writeControllerRef.current = createLanguageWriteController(saveLanguage)
  }

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    if (!ready) return
    try {
      onReadyRef.current?.()
    } catch {
      return
    }
  }, [ready])

  useEffect(() => {
    let active = true

    void loadLanguagePreference().then((result) => {
      if (!active) return
      const selectedLanguage = selectedLanguageRef.current
      const nextLanguage = chooseLoadedLanguage(
        selectedLanguage,
        result.language,
      )
      if (selectedLanguage === null) setLanguageState(nextLanguage)
      setReady(true)
    })

    return () => {
      active = false
      void writeControllerRef.current?.drain().catch(() => undefined)
    }
  }, [])

  const setLanguage = useCallback((nextLanguage: Language) => {
    if (!isLanguage(nextLanguage)) return
    selectedLanguageRef.current = nextLanguage
    setLanguageState(nextLanguage)
    void writeControllerRef.current?.enqueue(nextLanguage)
  }, [])

  const t = useCallback<Translate>(
    (keyOrDescriptor: string | MessageDescriptor, params?: MessageParams) => {
      if (typeof keyOrDescriptor === 'string')
        return translate(language, keyOrDescriptor, params)
      return translate(language, keyOrDescriptor)
    },
    [language],
  )

  const value = useMemo(
    () => ({ language, ready, setLanguage, t }),
    [language, ready, setLanguage, t],
  )

  return (
    <LanguageContext.Provider value={value}>
      {ready ? children : null}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context)
    throw new Error('useLanguage must be used within LanguageProvider')
  return context
}

export function useTranslation(): LanguageContextValue {
  return useLanguage()
}
