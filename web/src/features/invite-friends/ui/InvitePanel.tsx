import { useState } from 'react'
import { Button, Icon } from '@/shared/ui'
import { useInvite } from '../model/useInvite'
import styles from './InvitePanel.module.css'
import { QrCode } from './QrCode'

interface Props {
  tripId: string
  /** 共有するときの文に入れる旅のタイトル */
  tripTitle: string
}

/** 招待リンクのコピー、QR コード、アプリでの共有（S02） */
export function InvitePanel({ tripId, tripTitle }: Props) {
  const { url, copy, share } = useInvite(tripId, tripTitle)
  const [showQr, setShowQr] = useState(false)

  return (
    <div className={styles.panel}>
      <div className={styles.linkBox}>
        <Icon name="link" size={20} />
        <span className={styles.url} data-testid="invite-url">
          {url}
        </span>
        <Button variant="soft" size="small" onClick={() => void copy()}>
          コピー
        </Button>
      </div>
      <div className={styles.actions}>
        <Button onClick={() => setShowQr((shown) => !shown)} aria-expanded={showQr}>
          {showQr ? 'QRコードを閉じる' : 'QRコードを表示'}
        </Button>
        <Button onClick={() => void share()}>アプリで共有</Button>
      </div>
      {showQr && (
        <div className={styles.qr}>
          <QrCode text={url} />
          <p>友達のスマホのカメラで読み取ると、参加の画面が開きます。</p>
        </div>
      )}
    </div>
  )
}
