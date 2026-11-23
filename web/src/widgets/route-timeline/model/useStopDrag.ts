import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { playSound } from '@/shared/lib'
import { autoScrollStep, insertionAt, LONG_PRESS_MS, pressMovedTooFar, RETURN_MS, type RowBand } from '../lib/stopDrag'

/** 行を取っているあいだの見た目 */
export interface StopDragView {
  /** 取っている行（行の ID。ふつうはピンの ID。entities/route の stopIdOf）。取っていなければ null。下の pinId も行の ID */
  draggingId: string | null
  /** いま落とすと、取った行が入る位置の行（行の ID）。その行の上か下に、差し込む位置の線を出す */
  overId: string | null
  /** 線を overId の行の下に出すか（下へ動かすとき）。false なら上 */
  after: boolean
  /** 取った行の、元の位置からのずれ（px）。しおりの欄は横にはみ出すと切れるので、縦にだけ動かす（x はいつも 0） */
  x: number
  y: number
  /** 落とさずに離して、元の位置へ戻る途中か */
  returning: boolean
}

const IDLE: StopDragView = { draggingId: null, overId: null, after: false, x: 0, y: 0, returning: false }

interface Press {
  pointerId: number
  /** マウスか（マウスは、押したまま動かすだけで取れる） */
  mouse: boolean
  pinId: string
  startX: number
  startY: number
  lastY: number
  /** しおりの欄（縦に動かせる親）。端に指があるあいだ、欄を動かす */
  scroller: HTMLElement | null
  /** 押したときの、行の元の場所の上端（画面の中の位置）と、いま出している位置を決めたときの上端 */
  startTop: number
  shownTop: number
  timer: number
  lifted: boolean
  overId: string | null
}

/** 縦に動かせるいちばん近い親（しおりのシートの行の欄） */
function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/**
 * しおりの場所の行を取り、ドラッグして行と行のあいだに落として差し込む操作（企画書「ユーザー体験」3-6）。
 * - 押してから LONG_PRESS_MS のあいだ指が動かなければ取れる。その前に動いたら、ふつうのスクロールにする
 * - マウス（PC）では、長押しを待たず、押したまま少し動かすだけで取れる（ふつうのドラッグアンドドロップ）
 * - 取ったあとは、指の動きでしおりの欄がスクロールしないようにする。欄の上下の端に近づくと、欄をそちらへ動かす
 * - 離したとき、順番が変わる位置（線が出ている位置）なら onSwap（取った行、入る位置の行）を呼ぶ。そうでなければ、取った行は元の位置へ戻る
 * - 取ったあとの click は、場所を押したことにしない
 * onSwap を渡さなければ、行は取れない
 */
export function useStopDrag(onSwap?: (fromPinId: string, toPinId: string) => void) {
  const [view, setView] = useState<StopDragView>(IDLE)
  const rows = useRef(new Map<string, HTMLElement>())
  const press = useRef<Press | null>(null)
  const frame = useRef(0)
  const returnTimer = useRef(0)
  // 取ったあと、この時刻までの click は場所を押したことにしない
  const suppressClickUntil = useRef(0)
  const onSwapRef = useRef(onSwap)
  useEffect(() => {
    onSwapRef.current = onSwap
  })
  const detach = useRef<() => void>(() => {})

  const finish = useCallback(() => {
    const current = press.current
    if (!current) return
    window.clearTimeout(current.timer)
    cancelAnimationFrame(frame.current)
    detach.current()
    press.current = null
  }, [])

  useEffect(
    () => () => {
      finish()
      window.clearTimeout(returnTimer.current)
    },
    [finish],
  )

  const bands = (): RowBand[] =>
    [...rows.current].map(([pinId, element]) => {
      const rect = element.getBoundingClientRect()
      return { pinId, top: rect.top, bottom: rect.bottom }
    })

  const rowTop = (id: string): number | null => rows.current.get(id)?.getBoundingClientRect().top ?? null

  const follow = () => {
    const current = press.current
    if (!current?.lifted) return
    const slot = insertionAt(current.lastY, bands(), current.pinId)
    current.overId = slot?.to ?? null
    // 取った行の元の場所は、欄のスクロールと、取ったあとに上の行が詰まる（滞在と移動の行を隠す）ぶん動く。
    // その動きを打ち消して、取った行が指（マウス）の下に付いてくるようにする
    current.shownTop = rowTop(current.pinId) ?? current.shownTop
    const shifted = current.shownTop - current.startTop
    setView({ draggingId: current.pinId, overId: current.overId, after: slot?.after ?? false, x: 0, y: current.lastY - current.startY - shifted, returning: false })
  }

  const settle = (current: Press, drop: boolean) => {
    suppressClickUntil.current = performance.now() + 400
    finish()
    if (drop && current.overId) {
      onSwapRef.current?.(current.pinId, current.overId)
      setView(IDLE)
      return
    }
    // 落とせる行の外で離した：元の位置へ戻してから、取る前の見た目に戻す
    setView({ draggingId: current.pinId, overId: null, after: false, x: 0, y: 0, returning: true })
    window.clearTimeout(returnTimer.current)
    returnTimer.current = window.setTimeout(() => setView(IDLE), RETURN_MS)
  }

  const lift = () => {
    const current = press.current
    if (!current || current.lifted) return
    window.clearTimeout(current.timer)
    current.lifted = true
    current.scroller = scrollParentOf(rows.current.get(current.pinId) ?? null)
    navigator.vibrate?.(12)
    playSound('select')
    follow()
    // 欄の端に指があるあいだ、欄を少しずつ動かす
    const step = () => {
      const now = press.current
      if (!now?.lifted) return
      if (now.scroller) {
        const rect = now.scroller.getBoundingClientRect()
        const amount = autoScrollStep(now.lastY, rect.top, rect.bottom)
        if (amount !== 0) {
          now.scroller.scrollTop += amount
        }
      }
      // 欄が動いた、行が詰まった（取った直後）で、元の場所が動いたら、取った行の位置を合わせ直す
      if (rowTop(now.pinId) !== now.shownTop) follow()
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  const onPointerDown = (pinId: string, event: PointerEvent<HTMLElement>) => {
    if (!onSwapRef.current || press.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    window.clearTimeout(returnTimer.current)
    setView(IDLE)
    const current: Press = {
      pointerId: event.pointerId,
      mouse: event.pointerType === 'mouse',
      pinId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      scroller: null,
      startTop: rowTop(pinId) ?? 0,
      shownTop: rowTop(pinId) ?? 0,
      timer: window.setTimeout(lift, LONG_PRESS_MS),
      lifted: false,
      overId: null,
    }
    press.current = current

    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== current.pointerId) return
      current.lastY = move.clientY
      if (current.lifted) follow()
      else if (pressMovedTooFar(move.clientX - current.startX, move.clientY - current.startY)) {
        // 指は、取れる前に動いたらスクロール。マウスはスクロールとぶつからないので、押したまま動かしたらその場で取る
        if (current.mouse) lift()
        else finish()
      }
    }
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== current.pointerId) return
      if (current.lifted) settle(current, up.type === 'pointerup')
      else finish()
    }
    // 取ったあとは、指の動きでしおりの欄や画面がスクロールしないようにする
    const onTouchMove = (touch: TouchEvent) => {
      if (current.lifted && touch.cancelable) touch.preventDefault()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    detach.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.removeEventListener('touchmove', onTouchMove)
    }
  }

  /** 取ったあとの click を、場所を押したことにしない（行の外側に付ける） */
  const onClickCapture = (event: MouseEvent) => {
    if (performance.now() < suppressClickUntil.current) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  /** 行の要素を覚える（落とせる行の範囲を測るため）。場所の行にだけ付ける */
  const rowRef = useCallback(
    (pinId: string) => (element: HTMLElement | null) => {
      if (element) rows.current.set(pinId, element)
      else rows.current.delete(pinId)
    },
    [],
  )

  return { view, enabled: Boolean(onSwap), onPointerDown, onClickCapture, rowRef }
}
