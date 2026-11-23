import { useCallback, useState } from 'react'
import { recall, remember } from '@/shared/lib'
import { closedNights, hintNight } from './hint'

const keyOf = (tripId: string) => `lodging-hint-closed:${tripId}`

/**
 * 宿の知らせを、どの夜について出すか。右の × で閉じた夜は、その端末ではもう出さない（旅ごとに覚える。しおりの枠は残る）
 */
export function useLodgingHint(tripId: string, openNights: readonly number[]) {
  const [closed, setClosed] = useState(() => ({ tripId, nights: closedNights(recall(keyOf(tripId))) }))
  // 旅を切り替えたら、その旅の覚えを読み直す
  if (closed.tripId !== tripId) setClosed({ tripId, nights: closedNights(recall(keyOf(tripId))) })
  const nights = closed.tripId === tripId ? closed.nights : []

  const close = useCallback(
    (night: number) => {
      setClosed((now) => {
        const next = [...new Set([...(now.tripId === tripId ? now.nights : []), night])]
        remember(keyOf(tripId), next.join(','))
        return { tripId, nights: next }
      })
    },
    [tripId],
  )

  return { night: hintNight(openNights, nights), close }
}
