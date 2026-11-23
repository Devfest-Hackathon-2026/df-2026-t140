import { cycleSoundLevel, soundLevelOf, useSoundSettings, translate as t } from '@/shared/lib'
import { Icon } from './Icon'
import styles from './SoundControls.module.css'

const LEVEL_LABEL = { high: t('大', 'High'), low: t('小', 'Low'), off: t('消音', 'Off') } as const

/** 押すたびに、この端末の効果音を 大 → 小 → 消音 と切り替える。 */
export function SoundControls() {
  const level = soundLevelOf(useSoundSettings())
  return (
    <button type="button" className={styles.speaker} aria-label={t(`効果音の音量：${LEVEL_LABEL[level]}`, `Sound effects: ${LEVEL_LABEL[level]}`)} onClick={cycleSoundLevel}>
      <Icon name={`sound-${level}`} size={26} />
    </button>
  )
}
