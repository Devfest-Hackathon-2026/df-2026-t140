import { useEffect } from 'react'
import { useMyMembership } from '@/entities/member'
import { rememberLastTrip } from '@/shared/lib'

/**
 * 旅の入口の判断：自分がその旅のメンバーかどうか。
 * メンバーなら、ホームの一覧で「いま開いている」と出せるよう、開いた旅を覚えておく。
 */
export function useTripGate(tripId: string) {
  const membership = useMyMembership(tripId)
  const isMember = Boolean(membership.data)

  useEffect(() => {
    if (isMember) rememberLastTrip(tripId)
  }, [isMember, tripId])

  return { loading: membership.loading, isMember, failed: Boolean(membership.error) }
}
