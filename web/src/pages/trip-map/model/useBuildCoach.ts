import { useCallback, useEffect, useState } from 'react'
import { recall, remember } from '@/shared/lib'

/** 場所カードが出てから案内を出すまでの時間（カードが下から入ってくる動きを先に終わらせる） */
const SHOW_DELAY_MS = 700

/** この端末で一度済ませたら、どの旅でも出さない（建築のしかたは、旅が変わっても同じ） */
const SEEN_KEY = 'build-coach-seen'

/**
 * 「建築する！」の案内（場所カードの建築ボタンを指す。ShioriCoachMark の button の形）を出すか。
 * 候補のピンを初めて選んで、建築ボタンが押せる状態の場所カードが出たときに、この端末で一度だけ出す。
 * 明るく残したボタンを押す（案内を閉じるだけ。建築は始めない）か、とばすか、自分で建築を頼むと済んだことにする。
 *
 * @param ready 押せる建築ボタンの入った場所カードが見えていて、案内を出してよい状態か
 */
export function useBuildCoach(ready: boolean) {
  const [seen, setSeen] = useState(() => Boolean(recall(SEEN_KEY)))
  const eligible = ready && !seen
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
    remember(SEEN_KEY, '1')
    setSeen(true)
  }, [])

  return { show: eligible && shown, done }
}
