import { useEffect, useRef } from 'react'
import { Avatar } from '@/entities/member'
import { ModelTurntable } from '@/entities/model3d'
import { pinDisplayArea, pinDisplayName } from '@/entities/pin'
import { dateRangeLabel, translate as t } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import type { CollectionBuilding } from '../model/useCollection'
import styles from './BuildingFloat.module.css'

interface Props {
  building: CollectionBuilding
  onClose: () => void
}

/**
 * 建物の詳細（コレクションの上に重ねて出す。企画書「ユーザー体験」4-2）。回る模型、名前、場所、旅の名前と日程、誰のやりたいことか。
 * × か、まわりの暗い所を押すと閉じる。しおりへ移るボタンは置かない（かめのコメント、2026-11-21）
 */
export function BuildingFloat({ building, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const { pin, trip, model, wisher, wishText } = building

  useEffect(() => {
    const element = dialog.current
    if (!element || element.open) return
    element.showModal()
    // 最初のフォーカスは詳細そのものに置く（タップで開いたときに、× に青い輪郭を出さない）
    element.focus()
  }, [])

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      tabIndex={-1}
      aria-labelledby="building-float-name"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.body}>
        <div className={styles.stage}>
          {model && <ModelTurntable model={model} className={styles.model} />}
          <Button sound="close" iconOnly className={styles.close} aria-label={t('閉じる', 'Close')} onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        <div className={styles.head}>
          <h2 id="building-float-name" className={styles.name}>
            {pinDisplayName(pin)}
          </h2>
          <p className={styles.meta}>
            {pin.area && (
              <span className={styles.metaItem}>
                <Icon name="pin" size={14} />
                {pinDisplayArea(pin)}
              </span>
            )}
            <span className={styles.metaItem}>
              <Icon name="calendar" size={14} />
              {trip.title}{t('（', ' (')}{dateRangeLabel(trip.startDate, trip.endDate)}{t('）', ')')}
            </span>
          </p>
        </div>
        {(wisher || wishText) && (
          <div className={styles.wish}>
            {wisher && <Avatar member={wisher} size={40} />}
            <p className={styles.wishText}>
              {wisher && <span className={styles.wishWho}>{t(`${wisher.displayName}のやりたいこと`, `${wisher.displayName}’s wish`)}</span>}
              {wishText && <span className={styles.wishBody}>{wishText}</span>}
            </p>
          </div>
        )}
      </div>
    </dialog>
  )
}
