import { useEffect } from 'react'

/** 画面を暗くする案内（ShioriCoachMark、ShioriGuide）を、Esc キーでとばす */
export function useSkipKey(onSkip: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])
}
