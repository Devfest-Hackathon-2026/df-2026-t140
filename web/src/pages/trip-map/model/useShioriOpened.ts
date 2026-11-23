import { useEffect, useState } from 'react'
import { recall, remember } from '@/shared/lib'

const keyOf = (tripId: string) => `shiori-opened:${tripId}`

/**
 * その旅のしおりを、この端末で一度でも開いたか（場所が入ったしおり）。旅ごとに覚える。
 * 宿の知らせ（「1 日目の宿がまだ決まっていません」）は、しおりを一度開いたあとに出す。
 * 最初の建築の直後は、建物がふくらむ動きと、しおりの入口の案内を先に見せるため（UI/UX レビューの M-4。#708）
 *
 * @param open いま、場所の入ったしおりを開いているか
 */
export function useShioriOpened(tripId: string, open: boolean): boolean {
  const [openedTrip, setOpenedTrip] = useState<string | null>(() => (recall(keyOf(tripId)) ? tripId : null))
  // 旅を切り替えたら、その旅の覚えを読み直す
  const [readTrip, setReadTrip] = useState(tripId)
  if (readTrip !== tripId) {
    setReadTrip(tripId)
    setOpenedTrip(recall(keyOf(tripId)) ? tripId : null)
  }
  const opened = openedTrip === tripId

  useEffect(() => {
    if (!open || opened) return
    remember(keyOf(tripId), '1')
    setOpenedTrip(tripId)
  }, [open, opened, tripId])

  return opened
}
