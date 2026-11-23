import { EditTripDates } from '@/features/edit-trip-dates'
import { InvitePanel } from '@/features/invite-friends'
import { translate } from '@/shared/lib'
import { Button, Icon, Sheet } from '@/shared/ui'

interface Props {
  tripId: string
  tripTitle: string
  /** 旅の日程。旅を作った直後（showNext）でなければ、発案者が変えられる行を出す */
  startDate: string
  endDate: string | null
  /** 発案者か。日程を変えられるのは発案者だけ */
  isOwner: boolean
  /** 旅程を確定しているか */
  confirmed: boolean
  /** 旅の合言葉。まだなければ、招待のパネルが作ってもらう */
  joinCode: string | undefined
  /**
   * 「次へ：計画をはじめる」を出すか。旅を作った直後だけ true。
   * すでに旅に入っていて上の帯から開いたときは、右上の × と役割が同じなので出さない
   */
  showNext?: boolean
  /** 「次へ：計画をはじめる」や閉じるボタンで呼ぶ */
  onClose: () => void
}

/**
 * 友達を招待するシート（S02）。共有のボタン、旅の合言葉、QR コード、「次へ：計画をはじめる」だけを置く。
 * 出発地・名前の変更、メンバーの一覧、旅から抜けるボタンは置かない（Takana の依頼、2026-11-21）。
 * 上の帯から開いたときは、旅の設定として、日程の行も置く（発案者だけが変えられる。Lazyturtle0852 の決定、2026-11-22）
 */
export function InviteSheet({ tripId, tripTitle, startDate, endDate, isOwner, confirmed, joinCode, showNext = false, onClose }: Props) {
  return (
    <Sheet
      title={translate('友達を招待しよう', "Invite friends")}
      action={
        <Button sound="close" iconOnly variant="text" aria-label={translate('閉じる', "Close")} onClick={onClose}>
          <Icon name="close" />
        </Button>
      }
    >
      {!showNext && <EditTripDates tripId={tripId} startDate={startDate} endDate={endDate} isOwner={isOwner} confirmed={confirmed} />}
      <InvitePanel tripId={tripId} tripTitle={tripTitle} joinCode={joinCode} />
      {showNext && (
        <Button sound="close" variant="go" size="large" block onClick={onClose}>
          {translate('次へ：計画をはじめる', "Next: Start planning")}
        </Button>
      )}
    </Sheet>
  )
}
