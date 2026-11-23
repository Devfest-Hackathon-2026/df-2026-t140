import { translate as t } from '@/shared/lib'
import { useState } from 'react'
import { Button } from '@/shared/ui'
import { useLeaveTrip } from '../model/useLeaveTrip'
import styles from './LeaveTripButton.module.css'

interface Props {
  tripId: string
  /** 抜ける直前に呼ぶ。抜けたあとは旅を読めないので、先に別の画面（ホーム）へ移る */
  onLeaving: () => void
}

/** 「この旅から抜ける」。押しまちがいを防ぐため、もう一度確かめてから抜ける */
export function LeaveTripButton({ tripId, onLeaving }: Props) {
  const leave = useLeaveTrip(tripId, onLeaving)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button sound="attention" variant="danger" onClick={() => setConfirming(true)}>
        {t('この旅から抜ける', 'Leave this trip')}
      </Button>
    )
  }

  return (
    <div className={styles.confirm}>
      <p>{t('抜けると、この旅は一覧から消えます。招待リンクから、もう一度参加できます。', 'Leaving removes this trip from your list. You can rejoin using the invite link.')}</p>
      <div className={styles.buttons}>
        <Button sound="close" onClick={() => setConfirming(false)}>{t('やめる', 'Cancel')}</Button>
        <Button variant="danger" onClick={() => void leave()}>
          {t('抜ける', 'Leave trip')}
        </Button>
      </div>
    </div>
  )
}
