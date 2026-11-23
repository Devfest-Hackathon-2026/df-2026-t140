import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/styles/tokens.css'
import './app/styles/base.css'
import { App, applyTheme } from './app'
import { appLanguage } from './shared/lib/language'

document.documentElement.lang = appLanguage
if (appLanguage === 'en') document.title = 'Tabimusubi'
applyTheme()

// 本番のビルドだけ。開発サーバーと /dev/sim の画面には入れない
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => console.warn(error))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
