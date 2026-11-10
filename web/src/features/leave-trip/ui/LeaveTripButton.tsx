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
        この旅から抜ける
      </Button>
    )
  }

  return (
    <div className={styles.confirm}>
      <p>抜けると、この旅は一覧から消えます。招待リンクから、もう一度参加できます。</p>
      <div className={styles.buttons}>
        <Button sound="close" onClick={() => setConfirming(false)}>やめる</Button>
        <Button variant="danger" onClick={() => void leave()}>
          抜ける
        </Button>
      </div>
    </div>
  )
}
