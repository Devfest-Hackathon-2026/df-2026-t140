import type { PinCategory } from '../model/types'
import { CANDIDATE_PIN_WIDTH, NAMED_PIN_WIDTH, PAST_PIN_WIDTH } from '../model/pins'
import { CategoryIcon } from './CategoryIcon'
import styles from './PinShape.module.css'

interface Props {
  category: PinCategory
  /**
   * candidate：白い候補のピン。filler：しおりの空いた時間への提案の、薄い青のピン。selected：選んでいる、色つきの大きいピン。
   * past：前の検索の候補の、灰色の半透明の小さいピン（面積は候補の約半分。絵は出さず、白い点だけ）
   */
  look?: 'candidate' | 'filler' | 'selected' | 'past'
  emphasized?: boolean
}

/**
 * 地図の上の印（ピンの形）。先がとがった下の端が、その場所を指す。
 * 候補は白いピン、空いた時間への提案は薄い青のピン（#520）、選んでいるものは色つきの大きいピン（A＋C）。
 */
export function PinShape({ category, look = 'candidate', emphasized = false }: Props) {
  const selected = look === 'selected'
  const past = look === 'past'
  const width = past ? PAST_PIN_WIDTH : emphasized ? NAMED_PIN_WIDTH : selected ? 56 : CANDIDATE_PIN_WIDTH
  const className = [styles.pin, selected && styles.selected, look === 'filler' && styles.filler, past && styles.past].filter(Boolean).join(' ')
  return (
    <span className={className} style={{ width, height: width * 1.3 }}>
      <svg className={styles.shape} viewBox="0 0 40 52" aria-hidden="true">
        {selected && <path className={styles.ring} d="M20 50.5C20 50.5 2.5 32.5 2.5 19a17.5 17.5 0 0 1 35 0c0 13.500-17.5 31.500-17.500 31.500z" />}
        <path className={styles.body} d="M20 47S6.500 31.500 6.500 19.500a13.500 13.500 0 0 1 27 0C33.500 31.500 20 47 20 47z" />
        {past && <circle className={styles.dot} cx="20" cy="19.5" r="5" />}
      </svg>
      {!past && (
        <span className={styles.icon}>
          <CategoryIcon category={category} size={width / 2} />
        </span>
      )}
    </span>
  )
}
