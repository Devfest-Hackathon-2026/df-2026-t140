import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate as t } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { leaveTrip } from '../api/leaveTrip'

/**
 * 旅から抜ける操作。抜けたあとは旅を読めないので、先に onLeaving で別の画面（ホーム）へ移ってから抜ける。
 * 結果は、移った先の画面にお知らせで出す。
 */
export function useLeaveTrip(tripId: string, onLeaving: () => void) {
  const session = useSession()
  const toast = useToast()

  return async function leave() {
    prepareSounds()
    onLeaving()
    try {
      await leaveTrip(session, tripId)
      playSound('close')
      toast(t('旅から抜けました', 'You left the trip'))
    } catch {
      playSound('error')
      toast(t('旅から抜けられませんでした。もう一度試してください', 'Could not leave the trip. Try again.'))
    }
  }
}
