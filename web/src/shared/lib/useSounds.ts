import { useEffect, useSyncExternalStore } from 'react'
import { getSoundSettings, prepareSounds, stopSounds, subscribeSoundSettings } from './sound'

export function useSoundSettings() {
  return useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings)
}

/** 起動時には鳴らさず、人が触れたときに音の準備をする。 */
export function useSounds(): void {
  useEffect(() => {
    const prepare = (event: Event) => { if (event.isTrusted) prepareSounds() }
    const hidden = () => { if (document.visibilityState === 'hidden') stopSounds() }
    document.addEventListener('pointerdown', prepare, true)
    document.addEventListener('click', prepare, true)
    document.addEventListener('keydown', prepare, true)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('pointerdown', prepare, true)
      document.removeEventListener('click', prepare, true)
      document.removeEventListener('keydown', prepare, true)
      document.removeEventListener('visibilitychange', hidden)
      stopSounds()
    }
  }, [])
}
