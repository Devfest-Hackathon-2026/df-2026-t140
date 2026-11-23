import { simFrame } from './simFrame.ts'

export type AppLanguage = 'ja' | 'en'

const storageKey = `${simFrame?.storagePrefix ?? ''}app-language`
const languageParam = 'lang'

function readLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'ja'

  const requested = new URLSearchParams(window.location.search).get(languageParam)
  if (requested === 'ja' || requested === 'en') {
    try {
      window.localStorage.setItem(storageKey, requested)
    } catch {
      // The URL still selects the language when storage is unavailable.
    }
    return requested
  }

  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'ja'
  } catch {
    return 'ja'
  }
}

export const appLanguage = readLanguage()

export function translate<T>(japanese: T, english: T): T {
  return appLanguage === 'en' ? english : japanese
}

export function setAppLanguage(language: AppLanguage): void {
  if (language === appLanguage) return

  const nextUrl = new URL(window.location.href)
  try {
    window.localStorage.setItem(storageKey, language)
    nextUrl.searchParams.delete(languageParam)
  } catch {
    nextUrl.searchParams.set(languageParam, language)
  }
  if (nextUrl.href === window.location.href) window.location.reload()
  else window.location.replace(nextUrl.href)
}
