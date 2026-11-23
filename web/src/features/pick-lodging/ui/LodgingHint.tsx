import { CategoryIcon } from '@/entities/pin'
import { translate, playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import styles from './LodgingHint.module.css'

interface Props {
  /** 宿がまだ決まっていない夜（1 日目の夜が 1） */
  night: number
  /** 「宿を探す」を押した（すぐ探しはじめる） */
  onFind: () => void
  /** × を押した（この端末では、この夜の知らせをもう出さない） */
  onClose: () => void
  /** 宿を探している途中（ボタンを押せなくする） */
  busy?: boolean
}

/**
 * やりたいことを書く欄の上の、宿の知らせ（企画書「ユーザー体験」2-5）。
 * しおりができていて、宿の決まっていない夜があるときに出す。「宿を探す」を押すと、すぐ探しはじめ、
 * その日の最後の場所と翌日の最初の場所のあいだに宿の候補のピンが立つ
 */
export function LodgingHint({ night, onFind, onClose, busy }: Props) {
  return (
    <div className={styles.hint} role="status">
      <span className={styles.icon} aria-hidden="true">
        <CategoryIcon category="lodging" size={20} />
      </span>
      <span className={styles.text}>{translate(`${night} 日目の宿がまだ決まっていません`, `Lodging for night ${night} hasn't been chosen`)}</span>
      <Button variant="go" size="small" sound={false} className={styles.find} disabled={busy} onClick={onFind}>
        {translate('宿を探す', 'Find lodging')}
      </Button>
      <button type="button" className={styles.close} aria-label={translate('この知らせを閉じる', 'Dismiss this notice')} onClick={() => { playSound('close'); onClose() }}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
