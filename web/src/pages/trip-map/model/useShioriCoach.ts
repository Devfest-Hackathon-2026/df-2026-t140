import { useCallback, useEffect, useState } from 'react'
import { recall, remember } from '@/shared/lib'

/** 出せるようになってから案内を出すまでの時間（建った建物がふくらむ動きを先に見せる） */
const SHOW_DELAY_MS = 1200

const keyOf = (tripId: string) => `shiori-coach-seen:${tripId}`

/**
 * しおりの入口の案内（左上のしおりボタンを指す。ShioriCoachMark）を出すか。
 * その旅のしおりに場所が入っていて、この端末でまだその旅の案内を済ませていないときに、旅ごとに一度だけ出す。
 * ルートボタンを押す（done）か、しおりを開くと済んだことにする。
 *
 * @param ready ルートボタンが見えていて、案内を出してよい状態か（読み込み中、場所カード、招待のシートでは出さない）
 */
export function useShioriCoach(tripId: string, hasStops: boolean, ready: boolean) {
  const [seenTrip, setSeenTrip] = useState<string | null>(() => (recall(keyOf(tripId)) ? tripId : null))
  // 旅を切り替えたら、その旅の覚えを読み直す
  const [readTrip, setReadTrip] = useState(tripId)
  if (readTrip !== tripId) {
    setReadTrip(tripId)
    setSeenTrip(recall(keyOf(tripId)) ? tripId : null)
  }
  const seen = seenTrip === tripId
  const eligible = hasStops && ready && !seen
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!eligible) return
    const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [eligible])

  const done = useCallback(() => {
    remember(keyOf(tripId), '1')
    setSeenTrip(tripId)
  }, [tripId])

  return { show: eligible && shown, done }
}
