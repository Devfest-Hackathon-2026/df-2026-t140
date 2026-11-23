import { translate } from '@/shared/lib'
import { Icon, type IconName } from '@/shared/ui'
import styles from './OriginMarker.module.css'

interface Props {
  /** 出発地（集合場所）や空港の名前 */
  name: string
  /** 名札の上の段に出す種類（ないときは「集合場所」） */
  kind?: string
  /** 丸の中の絵（ないときは電車） */
  icon?: IconName
  /** 場所の情報で、集合場所を見ているとき */
  selected: boolean
  /** 押したとき（しおりでは、集合場所の情報を開く）。渡さなければ押せない印にする */
  onSelect?: () => void
}

/**
 * しおりの地図に出す、集合場所の印（#226）。しおりの集合場所の行と同じ、濃い色の丸に電車の印。
 * 建物ではないので、建物の模型やピンの形にはしない。下の名札に「集合場所」と名前を出す。
 * 位置は出発地の名前から引くおよその位置（entities/trip の originLocation）。
 * 飛行機の区間で乗り降りする空港も、同じ形（飛行機の絵、「空港」の札）で出す
 */
export function OriginMarker({ name, kind = translate('集合場所', 'Meeting point'), icon = 'train', selected, onSelect }: Props) {
  const label = (
    <span className={selected ? `${styles.label} ${styles.labelSelected}` : styles.label}>
      <span className={styles.kind}>{kind}</span>
      <span className={styles.name}>{name}</span>
    </span>
  )
  const mark = (
    <span className={styles.dot}>
      <Icon name={icon} size={20} />
    </span>
  )
  return (
    <>
      {onSelect ? (
        <button type="button" className={styles.button} aria-label={`${kind}：${name}`} aria-pressed={selected} onClick={onSelect}>
          {mark}
        </button>
      ) : (
        <span className={styles.button} role="img" aria-label={`${kind}：${name}`}>
          {mark}
        </span>
      )}
      {label}
    </>
  )
}
