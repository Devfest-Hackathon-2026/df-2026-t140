import { Avatar, type Member } from '@/entities/member'
import { type Pin, PinShape } from '@/entities/pin'
import styles from './MapPin.module.css'

interface Props {
  pin: Pin
  /** 希望を書いた人（誰の希望から立ったピンか）。抜けた人なら undefined */
  wisher: Pick<Member, 'displayName' | 'color'> | undefined
  selected: boolean
  /** 名札を省く（まわりと重なって、広げても置けないとき。lib/declutter.ts） */
  labelHidden?: boolean
  onSelect: () => void
}

/**
 * 地図の上の候補のピン。押すと場所カードが出る。下の名札に、場所の名前と、誰の希望かを出す。
 * 大きさ 0 の点（その場所）を基準に、ピンは上へ、名札は下へ描く。
 */
export function MapPin({ pin, wisher, selected, labelHidden = false, onSelect }: Props) {
  const who = wisher ? `${wisher.displayName}の希望` : '希望'
  return (
    <>
      <button
        type="button"
        className={styles.pin}
        aria-label={`${pin.name}（${who}の候補）`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <PinShape category={pin.category} look={selected ? 'selected' : 'candidate'} />
      </button>
      {!labelHidden && (
        <span className={selected ? `${styles.label} ${styles.labelSelected}` : styles.label}>
          <span className={styles.name}>{pin.name}</span>
          {wisher && !selected && <Avatar member={wisher} size={18} />}
        </span>
      )}
    </>
  )
}
