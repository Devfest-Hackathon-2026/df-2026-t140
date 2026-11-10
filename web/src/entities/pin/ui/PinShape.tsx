import type { PinCategory } from '../model/types'
import { CategoryIcon } from './CategoryIcon'
import styles from './PinShape.module.css'

interface Props {
  category: PinCategory
  /** candidate：白い候補のピン。selected：選んでいる、色つきの大きいピン */
  look?: 'candidate' | 'selected'
}

/**
 * 地図の上の印（ピンの形）。先がとがった下の端が、その場所を指す。
 * 候補は白いピン、選んでいるものは色つきの大きいピン（A＋C）。
 */
export function PinShape({ category, look = 'candidate' }: Props) {
  const selected = look === 'selected'
  const width = selected ? 56 : 40
  return (
    <span className={selected ? `${styles.pin} ${styles.selected}` : styles.pin} style={{ width, height: width * 1.3 }}>
      <svg className={styles.shape} viewBox="0 0 40 52" aria-hidden="true">
        {selected && <path className={styles.ring} d="M20 50.5C20 50.5 2.5 32.5 2.5 19a17.5 17.5 0 0 1 35 0c0 13.500-17.5 31.500-17.500 31.500z" />}
        <path className={styles.body} d="M20 47S6.500 31.500 6.500 19.500a13.500 13.500 0 0 1 27 0C33.500 31.500 20 47 20 47z" />
      </svg>
      <span className={styles.icon}>
        <CategoryIcon category={category} size={selected ? 28 : 20} />
      </span>
    </span>
  )
}
