import { useEffect, useRef, useState } from 'react'
import { TRAVEL_MODE_LABELS, type TravelMode } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { changeTravelMode } from '../api/changeTravelMode'

/**
 * しおりで、旅の移動手段を選び直す。押したらすぐ選んだ側を出し（保存を待たない）、失敗したら元に戻す。
 * 選び直せるのはメンバーなら誰でも（幹事だけにしない）。
 * 組み直せたときは、旅の購読（saved）が次に変わるまで選んだ側を出し続ける（応答が先に届いても、前の手段に戻って見えないように）。
 * 次に届いた値がほかの人の選び直しでも、その値を出す。購読が変わらないまま数秒たったら、購読の値に戻す
 */
export function useChangeTravelMode(tripId: string, saved: TravelMode) {
  const session = useSession()
  const toast = useToast()
  const [pending, setPending] = useState<TravelMode | null>(null)
  // 組み直せたあと、購読を待っている（このときに購読が変わったら、値に関わらず選んだ側を出すのをやめる）
  const waiting = useRef(false)
  const latest = useRef(saved)
  useEffect(() => {
    latest.current = saved
  }, [saved])
  useEffect(() => {
    if (waiting.current) {
      waiting.current = false
      setPending(null)
    }
  }, [saved])

  async function choose(mode: TravelMode) {
    if (pending || mode === saved) return
    setPending(mode)
    try {
      const status = await changeTravelMode(session, tripId, mode)
      if (status === 'changed') {
        toast(translate(`${TRAVEL_MODE_LABELS[mode]}の時間で、しおりを組み直しました`, `Itinerary updated for ${TRAVEL_MODE_LABELS[mode].toLowerCase()}.`))
        // 購読が先に届いていれば、もう待たない
        if (latest.current === mode) {
          setPending(null)
          return
        }
        // 選んだ側のまま、旅の購読が変わるのを待つ（上の useEffect で消す）。届かなくても数秒で戻す
        waiting.current = true
        setTimeout(() => {
          if (!waiting.current) return
          waiting.current = false
          setPending(null)
        }, 5000)
        return
      }
      setPending(null)
    } catch {
      playSound('error')
      toast(translate('移動手段を変えられませんでした。もう一度試してください', "Couldn't change the travel mode. Try again."))
      setPending(null)
    }
  }

  return { value: pending ?? saved, busy: pending !== null, choose }
}
