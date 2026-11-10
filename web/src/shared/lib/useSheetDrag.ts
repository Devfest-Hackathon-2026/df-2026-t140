import { type MouseEvent, type PointerEvent, useCallback, useRef, useState } from 'react'
import { dragAxis, dragGrow, dragOffset, dragSettle, type SheetRest } from './sheetDrag'

export type { SheetRest } from './sheetDrag'

/** これより動かしたら、押したのではなくドラッグとみなす（px。sheetDrag の判定と同じ） */
const DRAG_SLOP_PX = 6
/** 開いた形の高さを測る前の仮の値（画面の高さに対する割合） */
const FULL_HEIGHT_FALLBACK = 0.5
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 最後に動かしてからこれ以上たって離したら、はじいたのではなく止めてから離したとみなす（ms） */
const FLICK_STALE_MS = 100
/** 元の位置へ戻すときの動きの長さ（ms） */
export const SHEET_RETURN_MS = 220

interface DragStart {
  pointerId: number
  x: number
  y: number
  lastY: number
  lastTime: number
  velocity: number
  range: number
  moved: boolean
  /** 中のボタンやリンクの上から押し始めたか（押しただけなら、そのボタンの動きに任せる） */
  onControl: boolean
}

/**
 * 開いた形を 2 段（ふつう・大きい）にするシートが渡す処理。
 * grow：ふつうの高さで、取っ手を上へ引いた。shrink：大きい高さで、取っ手を下へ引いた（閉じずに、ふつうの高さに戻す）。
 * どちらも、渡さなければ今までどおり（上へは動かず、下へ引くと閉じる）
 */
export interface SheetSteps {
  grow?: () => void
  shrink?: () => void
}

/** シートごとに変える動き。渡さなければ、しおり・場所の情報のシートと同じ */
export interface SheetDragOptions {
  /**
   * 押しただけのときに開く・閉じるを切り替えるか（既定は true）。
   * 場所カードのように、つかむ所の中の取っ手のボタンが自分で切り替えるときは false にする
   */
  tap?: boolean
  /** 動ける範囲（px）を、つかむたびに測る。渡さなければ、開いた形のシートの高さと peekVisible の差 */
  measureRange?: (from: SheetRest) => number
}

/**
 * 下のシートを、取っ手（閉じた状態ではシートの上の部分）でドラッグして開け閉めする（ヨウキンが 2026-11-07 に決めた）。
 * ドラッグ中は指についてシートが動き（offset）、離すと sheetDrag の判定で吸い付く先を決めて onSettle を呼ぶ。
 * 足りなければ元の位置へ戻す（returning の間だけ、戻る動きを付ける）。
 * 開いた形のシートに fullRef を付けると、その高さと peekVisible（閉じた状態の高さ）から、動ける範囲を決める
 */
export function useSheetDrag(
  from: SheetRest,
  peekVisible: number,
  onSettle: (to: SheetRest, offset: number) => void,
  steps: SheetSteps = {},
  { tap = true, measureRange }: SheetDragOptions = {},
) {
  // ドラッグ中・戻る途中のずれ（px、下向きが正）。null ならドラッグしていない
  const [offset, setOffset] = useState<number | null>(null)
  const [returning, setReturning] = useState(false)
  // 離して向こうの状態へ移したときの、動きの始まりの位置。閉じる動きは指で下げた位置から（dragFrom）、
  // 開く動きは指で引き上げた高さから（expandVisible）始める。次の動きが終わったら消す
  const [launch, setLaunch] = useState<{ dragFrom?: number; expandVisible?: number } | null>(null)
  const start = useRef<DragStart | null>(null)
  const fullHeight = useRef(0)
  // ドラッグしたあとの click は、ボタンを押したことにしない
  const suppressClick = useRef(false)

  const fullRef = useCallback((element: HTMLElement | null) => {
    if (element) fullHeight.current = element.offsetHeight
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      // 親へは伝える（シートの左右のスワイプ。shared/lib の useSwipe）。動かし始めの向きで、縦ならこちら、横ならスワイプに任せる。
      // 縦に動かしたときは、離したときの pointerup を親へ伝えない（finish）
      // 前のドラッグの click 止めは残さない（タッチでは、指を動かすと click が起きず、目印が残るため）
      suppressClick.current = false
      // 開いた形の高さは、つかむたびに測り直す（前後の場所へ移る、しおりの行が増えるなどで変わるため）
      if (from === 'full') {
        const sheet = event.currentTarget.closest('section')
        if (sheet) fullHeight.current = sheet.offsetHeight
      }
      const full = fullHeight.current || window.innerHeight * FULL_HEIGHT_FALLBACK
      start.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        velocity: 0,
        range: Math.max(0, measureRange ? measureRange(from) : full - peekVisible),
        moved: false,
        onControl: (event.target as HTMLElement).closest('button, a') !== null,
      }
      setReturning(false)
    },
    [from, peekVisible, measureRange],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = start.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dy = event.clientY - drag.y
      if (!drag.moved) {
        const axis = dragAxis(event.clientX - drag.x, dy)
        if (axis === null) return
        if (axis === 'horizontal') {
          // 横に払った：上げ下げはせず、前後の場所へのスワイプ（親の useSwipe）に任せる
          start.current = null
          return
        }
        drag.moved = true
        // 動かし始めてから指を捕まえる（押しただけのときは、中のボタンの click をそのまま通す）
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // 指がもう離れていて捕まえられなくても、ドラッグはそのまま続ける
        }
      }
      const elapsed = event.timeStamp - drag.lastTime
      if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed
      drag.lastY = event.clientY
      drag.lastTime = event.timeStamp
      setOffset(dragOffset(from, dy, drag.range))
    },
    [from],
  )

  const finish = useCallback(
    (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const drag = start.current
      if (!drag || drag.pointerId !== event.pointerId) return
      start.current = null
      if (!drag.moved) {
        // 押しただけ。開いた形の取っ手なら閉じる（Apple の取っ手と同じ）。
        // 閉じた形なら、取っ手のあたり（中のボタンやリンクの外）を押したときに開く（ボタンの上なら、そのボタンに任せる）
        if (cancelled || !tap) return
        if (from === 'full') onSettle('peek', 0)
        else if (!drag.onControl) onSettle('full', 0)
        return
      }
      // 縦に動かした。親のスワイプ（useSwipe）に、離したことを伝えない（斜めに動かしても前後へ移らないように）
      event.stopPropagation()
      // ドラッグのあとの click（マウスでは起きる）を 1 回だけ止める。起きなかったとき（タッチ）のため、すぐあとに目印を消す
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      const dy = event.clientY - drag.y
      // 指を止めてから離したなら、止める前の速さは数えない
      const velocity = event.timeStamp - drag.lastTime > FLICK_STALE_MS ? 0 : drag.velocity
      // 動かしたあとに元の近くまで戻して離したのは、押したのではない（切り替えずに元のまま）
      const backToStart = Math.abs(dy) < DRAG_SLOP_PX
      // 開いた形が 2 段のシート：ふつうの高さで上へ引いたら大きく、大きい高さで下へ引いたら（閉じずに）ふつうの高さへ
      if (!cancelled && !backToStart && from === 'full' && steps.grow && dragGrow(dy, velocity)) {
        setOffset(null)
        steps.grow()
        return
      }
      const to = cancelled || backToStart ? from : dragSettle(from, dy, velocity, drag.range)
      const moved = dragOffset(from, dy, drag.range)
      if (to === 'peek' && from === 'full' && steps.shrink) {
        setOffset(null)
        steps.shrink()
        return
      }
      if (to === from) {
        // 元の位置へ戻す。もう元の位置にいる（ずれが 0）か、動きを減らす設定なら、戻る動きを付けずにすぐ終える
        // （ずれが 0 のままでは transition が起きず、transitionend を待つと戻る途中のまま固まるため）
        if (moved === 0 || prefersReducedMotion()) {
          setOffset(null)
          return
        }
        setReturning(true)
        setOffset(0)
        // transitionend が来ない場合（途中で消えた、ブラウザが省いたなど）も、戻る動きの長さのあとに終える
        // 次のドラッグが始まっていたら、そのずれは消さない
        setTimeout(() => {
          if (start.current) return
          setReturning(false)
          setOffset(null)
        }, SHEET_RETURN_MS + 80)
        return
      }
      setLaunch(to === 'peek' ? { dragFrom: moved } : { expandVisible: peekVisible - moved })
      setOffset(null)
      onSettle(to, moved)
    },
    [from, onSettle, peekVisible, steps, tap],
  )

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => finish(event, false), [finish])
  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => finish(event, true), [finish])

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // 元の位置へ戻る動きが終わった
  const onReturned = useCallback(() => {
    setReturning(false)
    setOffset(null)
  }, [])

  // 開く・閉じる動きが終わった。始まりの位置はもう使わない
  const clearLaunch = useCallback(() => setLaunch(null), [])

  return {
    /** ドラッグ中・戻る途中のずれ（px、下向きが正）。null ならドラッグしていない */
    offset,
    /** 元の位置へ戻る途中か（このときだけ、戻る動きを付ける） */
    returning,
    onReturned,
    /** 離したあとの開く・閉じる動きの始まりの位置。shared/ui の sheetDragStyle に渡す */
    launch,
    clearLaunch,
    fullRef,
    /** つかむところ（開いた形の取っ手、閉じた形のシート）に付ける */
    gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  }
}
