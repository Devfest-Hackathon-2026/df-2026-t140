import { recall, remember } from '@/shared/lib'

// 見た目の案。色や形は app/styles/tokens.css の [data-theme='…'] で決まる。
// 案を足すときは、tokens.css にかたまりを足して、ここに名前を足す。
const THEMES = ['ac', 'a'] as const
type Theme = (typeof THEMES)[number]
const DEFAULT_THEME: Theme = 'ac'
const STORAGE_KEY = 'theme'

function isTheme(value: string | null): value is Theme {
  return (THEMES as readonly string[]).includes(value ?? '')
}

/** URL の ?theme=、前に選んだもの、既定（A＋C）の順で決め、<html data-theme> に入れる */
export function applyTheme(): void {
  const fromUrl = new URLSearchParams(location.search).get('theme')
  const stored = recall(STORAGE_KEY)
  const theme = isTheme(fromUrl) ? fromUrl : isTheme(stored) ? stored : DEFAULT_THEME
  if (isTheme(fromUrl)) remember(STORAGE_KEY, fromUrl)
  document.documentElement.dataset.theme = theme
}
