import { translate } from '@/shared/lib'
import { Button } from '@/shared/ui'
import { useRestorePlace } from '../model/useRestorePlace'
import styles from './RestorePlaceButton.module.css'

interface Props {
  tripId: string
  pinId: string
}

/**
 * 「しおりに戻す」。日程や時間に入りきらず、しおりから外れた建物の場所カード（S05）にだけ置く（Takana の決定、2026-11-23、バグ30）。
 * 外れていることの案内と、戻すボタン。外した場所の一覧は出さない（地図で建物を押したときだけ分かる）。
 * 戻すと、時間に収まらなくてもしおりに入る（ほかの場所は外さない）
 */
export function RestorePlaceButton({ tripId, pinId }: Props) {
  const { restore, restoring } = useRestorePlace(tripId, pinId)
  return (
    <div className={styles.box}>
      <p className={styles.note}>{translate('時間が足りず、しおりから外れています', 'Left out of the itinerary because there was not enough time.')}</p>
      <Button variant="route" block onClick={() => void restore()} disabled={restoring}>
        {restoring ? translate('戻しています…', 'Adding back…') : translate('しおりに戻す', 'Add back to itinerary')}
      </Button>
    </div>
  )
}
