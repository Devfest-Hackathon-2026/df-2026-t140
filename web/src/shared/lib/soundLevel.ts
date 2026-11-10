export type SoundLevel = 'high' | 'low' | 'off'
export interface SoundSettings { volume: number; muted: boolean }

const HIGH_VOLUME = 0.7
const LOW_VOLUME = 0.35

/** 大と小のあいだの音量が保存されている端末も、近いほうの段階として扱う。 */
export function soundLevelOf({ muted, volume }: SoundSettings): SoundLevel {
  if (muted || volume === 0) return 'off'
  return volume >= (HIGH_VOLUME + LOW_VOLUME) / 2 ? 'high' : 'low'
}

/** 大 → 小 → 消音 → 大 の順に、次の設定を返す。 */
export function nextSoundSettings(current: SoundSettings): SoundSettings {
  const level = soundLevelOf(current)
  if (level === 'high') return { volume: LOW_VOLUME, muted: false }
  if (level === 'low') return { volume: current.volume, muted: true }
  return { volume: HIGH_VOLUME, muted: false }
}
