import { useEffect } from 'react'
import { useMyMembership } from '@/entities/member'
import { useInvitedTripTitle } from '@/features/join-trip'
import { useLinkOutcomeNotice } from '@/features/link-google'
import { rememberLastTrip } from '@/shared/lib'

/**
 * 旅の入口の判断：自分がその旅のメンバーかどうか。
 * メンバーなら、ホームの一覧で「いま開いている」と出せるよう、開いた旅を覚えておく。
 * メンバーでなければ、参加の画面の見出しに旅の名前を出す（名前が届くまでは名前なし）。
 */
export function useTripGate(tripId: string) {
  // 参加の画面で Google アカウントにログインして戻ってきたところなら、結果を知らせる
  // （ログインしたらメンバーだったときは、連携のカードが出ずに旅が開くので、ここで出す）
  useLinkOutcomeNotice()
  const membership = useMyMembership(tripId)
  const isMember = Boolean(membership.data)
  const failed = Boolean(membership.error)
  const title = useInvitedTripTitle(tripId, !membership.loading && !isMember && !failed)

  useEffect(() => {
    if (isMember) rememberLastTrip(tripId)
  }, [isMember, tripId])

  return { loading: membership.loading, isMember, failed, title }
}
