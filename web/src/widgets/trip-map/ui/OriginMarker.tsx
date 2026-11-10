import { Icon } from '@/shared/ui'
import styles from './OriginMarker.module.css'

interface Props {
  /** 出発地（集合場所）の名前 */
  name: string
  /** 場所の情報で、集合場所を見ているとき */
  selected: boolean
  /** 押したとき（しおりでは、集合場所の情報を開く）。渡さなければ押せない印にする */
  onSelect?: () => void
}

/**
 * しおりの地図に出す、集合場所の印（#226）。しおりの集合場所の行と同じ、濃い色の丸に電車の印。
 * 建物ではないので、建物の模型やピンの形にはしない。下の名札に「集合場所」と名前を出す。
 * 位置は出発地の名前から引くおよその位置（entities/trip の originLocation）
 */
export function OriginMarker({ name, selected, onSelect }: Props) {
  const label = (
    <span className={selected ? `${styles.label} ${styles.labelSelected}` : styles.label}>
      <span className={styles.kind}>集合場所</span>
      <span className={styles.name}>{name}</span>
    </span>
  )
  const mark = (
    <span className={styles.dot}>
      <Icon name="train" size={20} />
    </span>
  )
  return (
    <>
      {onSelect ? (
        <button type="button" className={styles.button} aria-label={`集合場所：${name}`} aria-pressed={selected} onClick={onSelect}>
          {mark}
        </button>
      ) : (
        <span className={styles.button} role="img" aria-label={`集合場所：${name}`}>
          {mark}
        </span>
      )}
      {label}
    </>
  )
}
