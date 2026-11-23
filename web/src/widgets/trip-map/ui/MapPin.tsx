import { translate } from '@/shared/lib'
import { Avatar, type Member } from '@/entities/member'
import { pinDisplayName, type Pin, PinShape } from '@/entities/pin'
import styles from './MapPin.module.css'

interface Props {
  pin: Pin
  /** 希望を書いた人（誰の希望から立ったピンか）。抜けた人なら undefined */
  wisher: Pick<Member, 'displayName' | 'color'> | undefined
  selected: boolean
  /** 前の検索の候補。灰色の半透明の小さいピンにし、名札は出さない（選んだときは、ふつうの選んだピン） */
  past?: boolean
  /** 名札を省く（まわりと重なって、広げても置けないとき。lib/declutter.ts） */
  labelHidden?: boolean
  onSelect: () => void
}

/**
 * 地図の上の候補のピン。押すと場所カードが出る。下の名札に、場所の名前と、誰の希望かを出す。
 * 大きさ 0 の点（その場所）を基準に、ピンは上へ、名札は下へ描く。
 */
export function MapPin({ pin, wisher, selected, past = false, labelHidden = false, onSelect }: Props) {
  const who = wisher ? translate(`${wisher.displayName}の希望`, `${wisher.displayName}'s wish`) : translate('希望', 'wish')
  // しおりの空いた時間への提案（#520）は、薄い青のピンにする（誰の希望でもない）
  const filler = pin.filler
  const faded = past && !selected
  const name = pinDisplayName(pin)
  return (
    <>
      <button
        type="button"
        className={styles.pin}
        aria-label={filler
          ? translate(`${name}（${filler.day} 日目のゆとりへの提案）`, `${name}, suggestion for free time on day ${filler.day}`)
          : faded
            ? translate(`${name}（前に探した${who}の候補）`, `${name}, earlier suggestion for ${who}`)
            : translate(`${name}（${who}の候補）`, `${name}, suggestion for ${who}`)}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <PinShape category={pin.category} look={selected ? 'selected' : filler ? 'filler' : faded ? 'past' : 'candidate'} emphasized={pin.namedMatch && !faded} />
      </button>
      {!labelHidden && !faded && (
        <span className={selected ? `${styles.label} ${styles.labelSelected}` : styles.label}>
          <span className={styles.name}>{pinDisplayName(pin)}</span>
          {wisher && !selected && <Avatar member={wisher} size={18} />}
        </span>
      )}
    </>
  )
}
