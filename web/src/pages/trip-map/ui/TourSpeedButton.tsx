import { translate } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import type { TourSpeed } from '../model/tour'
import styles from './TourSpeedButton.module.css'

interface Props {
  speed: TourSpeed
  /** 押した。次の速さへ切り替える */
  onCycle: () => void
}

/** 旅の再生の速さのボタン。押すたびに ×1 → ×2 → ×4 と切り替わる。速めているあいだは、ルートの色にして分かるようにする */
export function TourSpeedButton({ speed, onCycle }: Props) {
  return (
    <button
      type="button"
      className={`${styles.speed} ${speed > 1 ? styles.fast : ''}`}
      aria-label={translate(`再生の速さを変える（いまは ${speed} 倍）`, `Change playback speed (now ${speed}×)`)}
      onClick={onCycle}
    >
      <Icon name="fast" size={20} />
      <span aria-hidden="true">×{speed}</span>
    </button>
  )
}
