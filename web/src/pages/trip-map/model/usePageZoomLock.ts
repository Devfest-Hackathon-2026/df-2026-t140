import { useEffect } from 'react'

/**
 * 地図の画面を出している間、ブラウザがページ全体を指 2 本で拡大しないようにする（Takana の依頼、2026-11-22）。
 * ふつうは CSS の touch-action（TripMapPage.module.css）で止まるが、iPhone の Safari は、指 2 本の拡大を
 * gesturestart などの独自の知らせで始めるので、それを取り消す。地図の拡大・縮小は Google の地図が自分で受け取るので、影響しない
 */
export function usePageZoomLock() {
  useEffect(() => {
    const cancel = (event: Event) => event.preventDefault()
    const names = ['gesturestart', 'gesturechange', 'gestureend'] as const
    names.forEach((name) => document.addEventListener(name, cancel, { passive: false }))
    return () => names.forEach((name) => document.removeEventListener(name, cancel))
  }, [])
}
