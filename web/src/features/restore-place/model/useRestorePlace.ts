import { useState } from 'react'
import { useSession } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { restorePlace } from '../api/restorePlace'

/**
 * しおりから外した場所を、しおりに戻す操作（Takana の決定、2026-11-23、バグ30）。
 * 戻し終わると、ルートの購読でしおりに場所が入り、場所カードの案内も消える。戻せなかったときは、お知らせを出して元のまま
 */
export function useRestorePlace(tripId: string, pinId: string) {
  const session = useSession()
  const toast = useToast()
  const [restoring, setRestoring] = useState(false)

  async function restore(): Promise<void> {
    if (restoring) return
    setRestoring(true)
    try {
      await restorePlace(session, tripId, pinId)
      playSound('confirm')
      toast(translate('しおりに戻しました', 'Added back to the itinerary.'))
    } catch {
      playSound('error')
      toast(translate('しおりに戻せませんでした。もう一度試してください', "Couldn't add it back to the itinerary. Try again."))
    } finally {
      setRestoring(false)
    }
  }

  return { restore, restoring }
}
