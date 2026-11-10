import { type PointerEvent, useCallback, useRef } from 'react'
import { swipeTarget } from './swipe'

/**
 * 左右のスワイプで前後へ移る。返す処理を、スワイプできる範囲（シートやカード）に付ける。
 * ボタンやリンクの上から始めた動きは数えない（押す操作と取り違えない）。端なら onPrev・onNext を渡さない。
 * ただし data-swipe-through を付けたボタン（場所カードの取っ手）は、上から払っても数える（押しただけかは、そのボタンが見分ける）
 */
export function useSwipe(onPrev: (() => void) | undefined, onNext: (() => void) | undefined) {
  const start = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    const fromControl = target.closest('button, a') !== null && target.closest('[data-swipe-through]') === null
    start.current = fromControl ? null : { x: event.clientX, y: event.clientY }
  }, [])

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const from = start.current
      start.current = null
      if (!from) return
      const target = swipeTarget(event.clientX - from.x, event.clientY - from.y)
      if (target === 'next') onNext?.()
      else if (target === 'prev') onPrev?.()
    },
    [onPrev, onNext],
  )

  const onPointerCancel = useCallback(() => {
    start.current = null
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}
