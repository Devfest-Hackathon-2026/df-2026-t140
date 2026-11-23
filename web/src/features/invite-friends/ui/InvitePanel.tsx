import { translate } from '@/shared/lib'
import { useState } from 'react'
import { Button, Icon } from '@/shared/ui'
import { useInvite } from '../model/useInvite'
import styles from './InvitePanel.module.css'
import { QrCode } from './QrCode'

interface Props {
  tripId: string
  /** 共有するときの文に入れる旅のタイトル */
  tripTitle: string
  /** 旅に入っている合言葉。まだなければ、このパネルが作ってもらう */
  joinCode: string | undefined
}

/**
 * 旅の合言葉、OS の共有の画面を開くボタン、QR コード（S02）。
 * 招待リンクのコピーは、OS の共有の画面でする（共有の画面のない端末では、共有のボタンがコピーになる）
 */
export function InvitePanel({ tripId, tripTitle, joinCode: tripJoinCode }: Props) {
  const { url, joinCode, copyJoinCode, share } = useInvite(tripId, tripTitle, tripJoinCode)
  const [showQr, setShowQr] = useState(false)

  return (
    <div className={styles.panel}>
      {joinCode !== null && (
        <div className={styles.codeBox}>
          <div className={styles.codeText}>
            <span className={styles.codeLabel}>{translate('旅の合言葉', "Trip code")}</span>
            {joinCode ? (
              <span className={styles.code} data-testid="join-code">
                {joinCode}
              </span>
            ) : (
              <span className={styles.codePending}>{translate('用意しています…', "Getting ready…")}</span>
            )}
          </div>
          <Button variant="soft" size="small" disabled={!joinCode} onClick={() => void copyJoinCode()}>
            {translate('コピー', 'Copy')}
          </Button>
        </div>
      )}
      <div className={styles.actions}>
        <Button block onClick={() => void share()} data-testid="invite-share">
          <Icon name="share" />
          {translate('共有する', 'Share')}
        </Button>
        <Button
          iconOnly
          aria-label={showQr ? translate('QRコードを閉じる', 'Hide QR code') : translate('QRコードを表示', 'Show QR code')}
          aria-expanded={showQr}
          onClick={() => setShowQr((shown) => !shown)}
        >
          <Icon name="qr" />
        </Button>
      </div>
      {showQr && (
        <div className={styles.qr}>
          <QrCode text={url} />
          <p>{translate('友達のスマホのカメラで読み取ると、参加の画面が開きます。', "Friends can scan this code with their phone camera to join.")}</p>
        </div>
      )}
    </div>
  )
}
