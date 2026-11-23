import { useCallback, useEffect, useState } from 'react'
import { recall, remember } from '@/shared/lib'

/** 出せるようになってから案内を出すまでの時間（しおりのシートが下から出てくる動きを先に終わらせる） */
const SHOW_DELAY_MS = 700

const keyOf = (tripId: string) => `shiori-guide-seen:${tripId}`

/**
 * しおりの中の案内（ShioriGuide：シート → 再生ボタン）を出すか。
 * 場所の入ったしおりの画面を初めて開いたときに、旅ごと・端末ごとに一度だけ出す。
 * 入口の案内（useShioriCoach）から開いても、ほかの道から開いても出す（入口の案内をとばした人にも、あとで届くように）。
 * 出した時点で端末に覚える。案内の途中で画面を離れても（戻る操作、再読み込みなど）、もう出さない。
 *
 * @param inShiori しおりを開いているか
 * @param ready しおりの一覧のシートがふつうの高さで見えていて、再生ボタンもある状態か
 */
export function useShioriGuide(tripId: string, inShiori: boolean, ready: boolean) {
  const [seenTrip, setSeenTrip] = useState<string | null>(() => (recall(keyOf(tripId)) ? tripId : null))
  // 案内を出したことのある旅（端末に覚えられない環境でも、この画面のあいだは二度出さない）
  const [startedTrip, setStartedTrip] = useState<string | null>(null)
  // 旅を切り替えたら、その旅の覚えを読み直す。案内を出したあとでしおりを離れたら、済んだことにする（途中で離れた案内を、また出さないように）
  const [readAt, setReadAt] = useState({ tripId, inShiori })
  if (readAt.tripId !== tripId || readAt.inShiori !== inShiori) {
    setReadAt({ tripId, inShiori })
    if (readAt.tripId !== tripId) setSeenTrip(recall(keyOf(tripId)) ? tripId : null)
    else if (!inShiori && startedTrip === tripId) setSeenTrip(tripId)
  }
  const seen = seenTrip === tripId
  const eligible = inShiori && ready && !seen
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!eligible) return
    const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [eligible])

  // 出したら、済んだことを端末に覚える（出している間は、まだ seen にしない）
  const show = eligible && shown
  if (show && startedTrip !== tripId) setStartedTrip(tripId)
  useEffect(() => {
    if (show) remember(keyOf(tripId), '1')
  }, [show, tripId])

  /** 案内を終える（再生ボタンを押した、とばした、出せなかった） */
  const done = useCallback(() => {
    remember(keyOf(tripId), '1')
    setSeenTrip(tripId)
  }, [tripId])

  return { show, done }
}
