import { Icon, type IconName } from '@/shared/ui'
import { TRAVEL_MODE_LABELS, TRAVEL_MODES, type TravelMode } from '../model/travelMode'
import styles from './TravelModeChoice.module.css'

const ICONS: Record<TravelMode, IconName> = { transit: 'train', car: 'car', plane: 'plane' }

interface Props {
  value: TravelMode
  onChange: (mode: TravelMode) => void
  /** 読み上げの名前（見出しがない所で使うとき） */
  label: string
  disabled?: boolean
  /** しおりの中など、狭い所に置く小さい形 */
  compact?: boolean
}

/** 旅の移動手段（電車・バス、車、飛行機）の 3 択。旅を作る画面（S01）と、しおり（S11）で使う */
export function TravelModeChoice({ value, onChange, label, disabled, compact }: Props) {
  return (
    <div className={compact ? `${styles.choice} ${styles.compact}` : styles.choice} role="radiogroup" aria-label={label}>
      {TRAVEL_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={mode === value}
          className={mode === value ? `${styles.option} ${styles.selected}` : styles.option}
          disabled={disabled}
          onClick={() => mode !== value && onChange(mode)}
        >
          <Icon name={ICONS[mode]} size={compact ? 18 : 22} />
          {TRAVEL_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  )
}
