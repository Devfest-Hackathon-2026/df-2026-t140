import { cycleSoundLevel, soundLevelOf, useSoundSettings } from '@/shared/lib'
import { Icon } from './Icon'
import styles from './SoundControls.module.css'

const LEVEL_LABEL = { high: '大', low: '小', off: '消音' } as const

/** 押すたびに、この端末の効果音を 大 → 小 → 消音 と切り替える。 */
export function SoundControls() {
  const level = soundLevelOf(useSoundSettings())
  return (
    <button type="button" className={styles.speaker} aria-label={`効果音の音量：${LEVEL_LABEL[level]}`} onClick={cycleSoundLevel}>
      <Icon name={`sound-${level}`} size={26} />
    </button>
  )
}
