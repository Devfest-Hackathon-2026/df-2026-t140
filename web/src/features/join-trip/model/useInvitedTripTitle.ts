import { useEffect, useState } from 'react'
import { useSession } from '@/shared/api'
import { previewTrip } from '../api/previewTrip'

/**
 * 招待された旅の名前。参加する前の見出しに出す。
 * 届くまでと、聞けなかったときは null（見出しは名前なしで出し、参加の操作は止めない）。
 * enabled が false のあいだ（メンバーかどうかを確かめている間、メンバーだったとき）は聞かない。
 */
export function useInvitedTripTitle(tripId: string, enabled: boolean): string | null {
  const session = useSession()
  const [title, setTitle] = useState<{ tripId: string; value: string | null } | null>(null)

  useEffect(() => {
    if (!enabled || !tripId) return
    let cancelled = false
    previewTrip(session, tripId).then(
      (value) => !cancelled && setTitle({ tripId, value }),
      () => {
        // 名前が出ないだけなので、知らせない（旅がないときは、参加を押したときに案内する）
      },
    )
    return () => {
      cancelled = true
    }
  }, [session, tripId, enabled])

  return title?.tripId === tripId ? title.value : null
}
