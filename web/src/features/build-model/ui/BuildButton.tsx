import { translate } from '@/shared/lib'
import { BUILD_LIMIT_PER_TRIP } from '@/entities/pin'
import { Button, ErrorText, Icon } from '@/shared/ui'
import { useBuild } from '../model/useBuild'
import styles from './BuildButton.module.css'

interface Props {
  tripId: string
  pinId: string
  /** その旅で、もう建っている（工事中と完成の）数。上限に達していたら押せない */
  builtCount: number
  /** 建築を頼めたときに呼ぶ。場所カードを閉じて、書く欄に戻る */
  onRequested: () => void
  /** 前の建築が失敗したピン。もう一度建てられる */
  retry?: boolean
}

/**
 * 「建築する！」（S05）。押すと裏で建築が始まり、すぐ次のやりたいことを探せる（待ち画面は出さない）。
 * メンバーなら誰でも押せる。1 つの旅で建てられるのは 20 棟まで（Functions も同じ決めで断る）。
 */
export function BuildButton({ tripId, pinId, builtCount, onRequested, retry = false }: Props) {
  const { build, sending, problem } = useBuild(tripId, pinId, onRequested, retry)
  const full = builtCount >= BUILD_LIMIT_PER_TRIP

  return (
    <div className={styles.wrap}>
      <Button variant="build" size="large" block disabled={sending || full} onClick={build}>
        <Icon name="hammer" />
        {full ? translate(`建築は ${BUILD_LIMIT_PER_TRIP} 棟まで`, `Limit: ${BUILD_LIMIT_PER_TRIP} buildings`) : retry ? translate('もう一度、建築する！', "Build again") : translate('建築する！', "Build")}
      </Button>
      {full && !problem && (
        <p className={styles.hint}>
          {translate(`この旅には、もう ${BUILD_LIMIT_PER_TRIP} 棟が建っています（1 つの旅で ${BUILD_LIMIT_PER_TRIP} 棟まで）。`, `This trip has reached the limit of ${BUILD_LIMIT_PER_TRIP} buildings.`)}
        </p>
      )}
      <ErrorText>{problem}</ErrorText>
    </div>
  )
}
