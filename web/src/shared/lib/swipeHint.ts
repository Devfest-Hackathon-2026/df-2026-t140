import { useEffect, useState } from 'react'
import { recall, remember } from './storage'

// 場所カード（S05）と場所の情報（S12）の、スワイプできることを教える合図（ヨウキンが 2026-11-07 に Claude Design の案 3 から選んだ）。
// 一度でも左右に移ったら、その端末ではもう出さない（覚えられない環境では毎回出るだけ）。どちらで覚えても、両方で出なくなる

const LEARNED_KEY = 'placeCardSwipeLearned'
/** 合図の一言を出しておく長さ（ms）。shared/ui/SideCards.module.css の hint の動きと合わせる */
const HINT_MS = 4200

/** 一度でも左右に移ったことにする */
export function learnSwipe(): void {
  remember(LEARNED_KEY, '1')
}

/**
 * 合図を出すか。左右に選べる候補があり、まだ一度もスワイプしていなければ、カードを開いたときに 1 回だけ出す。
 * 出しておく長さが過ぎたら消す
 */
export function useSwipeHint(canSwipe: boolean): boolean {
  const [show, setShow] = useState(() => canSwipe && recall(LEARNED_KEY) !== '1')
  useEffect(() => {
    if (!show) return
    const timer = setTimeout(() => setShow(false), HINT_MS)
    return () => clearTimeout(timer)
  }, [show])
  return show
}
