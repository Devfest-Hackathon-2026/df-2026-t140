import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { swipeTarget } from '@/shared/lib'
import { type Move, stepAfter, tapMove } from './steps'

const isControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, a') !== null

/**
 * チュートリアルの今の位置と、進む・戻るの操作。
 * handlers を画面全体を覆う要素に付けると、タップ（右半分で次、左半分で前。最初の 1 枚はどこでも次）と左右のスワイプで切り替わる。frameRef はフォーカスを置く枠。
 * ボタン（スキップ、はじめる）の上から始めた動きは数えない。キーボードの左右とスペースでも動き、Esc で閉じる。
 * 最後の 1 枚から次へ進むと onDone を呼ぶ。ただし最後の 1 枚が出てから LAST_LOCK_MS のあいだは閉じない（lastReady が false。スキップと Esc は別で、いつでも閉じる）。
 * 開いているあいだは、フォーカスをチュートリアルの中にとどめる（後ろの画面の部品に Tab で届かないように）
 */
/** 最後の 1 枚が出てから、閉じるボタンを押せるようになるまで（ミリ秒）。旅の再生の動きを見てもらうため */
export const LAST_LOCK_MS = 4000

export function useTutorial(count: number, onDone: () => void) {
  const [index, setIndex] = useState(0)
  const isLast = index === count - 1
  /** 最後の 1 枚で、閉じてよくなったか */
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const lastReady = isLast && readyAt === index
  useEffect(() => {
    if (!isLast) return
    const timer = setTimeout(() => setReadyAt(index), LAST_LOCK_MS)
    return () => clearTimeout(timer)
  }, [isLast, index])
  const frameRef = useRef<HTMLDivElement>(null)
  /** 押し始めた所と、そこから離すまでに動いた距離 */
  const press = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  /** いまの動きをスワイプとして使ったか（続いて届く click を、タップとして数えない） */
  const swiped = useRef(false)

  const go = useCallback(
    (move: Move) => {
      const after = stepAfter(index, count, move)
      if (after === 'done') {
        if (lastReady) onDone()
      } else {
        // 1 枚動くたびに、最後の 1 枚の待ちをやり直す（戻ってからもう一度来たときも、4 秒待つ）
        setReadyAt(null)
        setIndex(after)
      }
    },
    [index, count, onDone, lastReady],
  )

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    swiped.current = false
    press.current = isControl(event.target) ? null : { x: event.clientX, y: event.clientY, dx: 0, dy: 0 }
  }, [])

  // 左右のスワイプは、指を離したときに決める（右から左で次）
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const from = press.current
      if (!from) return
      from.dx = event.clientX - from.x
      from.dy = event.clientY - from.y
      const move = swipeTarget(from.dx, from.dy)
      if (!move) return
      swiped.current = true
      // 最後の 1 枚で閉じるときに、この動きの続き（click）が後ろの画面に届かないよう、ひと呼吸おいてから進める
      setTimeout(() => go(move), 0)
    },
    [go],
  )

  const onPointerCancel = useCallback(() => {
    press.current = null
  }, [])

  // タップは click で受ける（click まで待ってから閉じるので、同じタップが後ろの画面の部品を押さない）
  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const from = press.current
      press.current = null
      if (swiped.current || isControl(event.target)) return
      const box = event.currentTarget.getBoundingClientRect()
      const xRatio = box.width > 0 ? (event.clientX - box.left) / box.width : 1
      const move = tapMove(from?.dx ?? 0, from?.dy ?? 0, xRatio, index > 0)
      if (move) go(move)
    },
    [go, index],
  )

  // 開いたら、フォーカスをチュートリアルの中へ移す（後ろのボタンに残さない）
  useEffect(() => {
    frameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDone()
        return
      }
      if (event.key === 'Tab') {
        // フォーカスを中のボタンのあいだで回す。ボタンがなければ、枠にとどめる
        const frame = frameRef.current
        if (!frame) return
        const buttons = [...frame.querySelectorAll<HTMLElement>('button')]
        const at = buttons.indexOf(document.activeElement as HTMLElement)
        const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]
        event.preventDefault()
        ;(next ?? frame).focus()
        return
      }
      // ボタンの上のスペースや Enter は、そのボタンを押す操作なので、ここでは動かさない
      if (isControl(event.target)) return
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        go('next')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go('prev')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onDone])

  /** 次の 1 枚へ進める（1 周し終えたとき）。最後の 1 枚では何もしない */
  const next = useCallback(() => {
    if (index < count - 1) {
      setReadyAt(null)
      setIndex(index + 1)
    }
  }, [index, count])

  return {
    index,
    isFirst: index === 0,
    isLast,
    lastReady,
    frameRef,
    next,
    handlers: { onPointerDown, onPointerUp, onPointerCancel, onClick },
  }
}
