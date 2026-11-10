import { type AnimationEvent, useCallback, useState } from 'react'
import { type SheetEntrance, type SheetSettled, sheetPhase, settledAfterAnimation } from './sheetPhase'

export type { SheetEntrance, SheetPhase } from './sheetPhase'

/** 閉じた状態で見えている高さ（px）。測るまでの仮の値（390×844 で測った、場所の情報の閉じた状態の高さ） */
const PEEK_VISIBLE_DEFAULT = 83

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 下から出るシート（しおり、場所の情報）の、開くとき上がり、閉じるとき下がる動き（ヨウキンが 2026-11-07 に決めた）。
 * 返す phase を shared/ui の sheetMotionClass に渡してクラスにし、onAnimationEnd をシートに、peekRef を閉じた形のシートに付ける。
 * 閉じるときは、開いたシートを上の部分だけ残る位置まで下げてから、閉じた状態に切り替える。
 * 段階は、描画の中で状態を書き換えずに、最後に動きを終えた形と props から決める
 */
export function useSheetMotion(peek: boolean, entrance: SheetEntrance) {
  const [settled, setSettled] = useState<SheetSettled>(peek ? 'peek' : null)
  const [peekVisible, setPeekVisible] = useState(PEEK_VISIBLE_DEFAULT)
  const phase = sheetPhase(peek, settled, entrance, prefersReducedMotion())

  // シート自身の動きが終わったら、その形で落ち着いたことにする（中の部品の動きの終わりは数えない）
  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) setSettled(settledAfterAnimation(peek))
    },
    [peek],
  )

  // 閉じた状態の高さを測り、下げる距離と、開くときに上がり始める位置に使う
  const peekRef = useCallback((element: HTMLElement | null) => {
    if (element) setPeekVisible(element.offsetHeight)
  }, [])

  return { phase, onAnimationEnd, peekRef, peekVisible }
}
