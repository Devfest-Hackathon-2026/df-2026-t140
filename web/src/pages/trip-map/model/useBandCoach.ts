import { useCallback, useEffect, useState } from 'react'
import { recall, remember } from '@/shared/lib'

/** シートが下がりきってから案内を出すまでの時間 */
const SHOW_DELAY_MS = 600

/** この端末で一度済ませたら、どの旅でも出さない（帯を押すと開くことは、旅が変わっても同じ） */
const SEEN_KEY = 'band-coach-seen'

/** やりたいことの欄の案内（旅を作った直後の 2 段目。UI/UX レビューの M-1）を、この端末で済ませた印 */
export const FIELD_COACH_SEEN_KEY = 'field-coach-seen'

/**
 * 旅の設定の入口の案内（旅の名前の帯を指す。ShioriCoachMark の band の形）を出すか。
 * 旅を作った直後の招待のシート（共有のボタンと「次へ：計画をはじめる」）を閉じたときか、しおりからみんなの地図に戻ったとき（arm）に、
 * この端末でまだ済ませていなければ一度だけ出す。帯を押す（done）と済んだことにする。
 *
 * 同じ形で、旅を作った直後の 2 段目（やりたいことの欄を指す案内）にも使う（seenKey に FIELD_COACH_SEEN_KEY を渡す）。
 *
 * @param ready 帯が見えていて、案内を出してよい状態か（読み込み中、場所カード、しおり、招待のシート、ほかの案内では出さない）
 * @param seenKey 済ませた印を端末に覚えておく名前
 */
export function useBandCoach(ready: boolean, seenKey: string = SEEN_KEY) {
  const [seen, setSeen] = useState(() => Boolean(recall(seenKey)))
  const [armed, setArmed] = useState(false)
  const eligible = armed && ready && !seen
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!eligible) return
    const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [eligible])

  const arm = useCallback(() => setArmed(true), [])
  const done = useCallback(() => {
    remember(seenKey, '1')
    setSeen(true)
    setArmed(false)
  }, [seenKey])

  return { show: eligible && shown, arm, done, seen }
}
