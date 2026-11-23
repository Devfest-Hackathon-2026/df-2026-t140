import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SHEET_RETURN_MS, type SheetSteps } from './useSheetDrag'

/**
 * 下のシートを、取っ手で上へ引いて画面の上まで広げた形（広げた形）にする（Takana の依頼、2026-11-22。シートの動きを揃える）。
 * どのシートも同じ動き：開いた形で取っ手を上へ引くと、指についてシートが伸び、離すと上の端まで広がって止まる。
 * 広げた形で下へ引くと、元の高さに戻る。上の端は、旅の画面では上の帯（ホームボタンと旅の名前）のすぐ下、
 * オンボーディングでは画面の一番上（ceiling で選ぶ）
 */

/** 上の端との間に空けるすきま（px） */
const CEILING_GAP_PX = 8
/** 広げる動き・戻す動き（shared/ui の sheetMotion の expand・closing と同じ速さ） */
const GROW_MOTION = { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
const SHRINK_MOTION = { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }

/**
 * 広げたときの上の端。
 * header：ページ（data-sheet-page）の上の帯（data-sheet-ceiling。widgets/trip-header）のすぐ下。
 * screen：画面の一番上（上の安全域の下）
 */
export type SheetCeiling = 'header' | 'screen'

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 画面の上の安全域（iPhone のノッチなど）の高さ（px） */
function safeAreaTop(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)'
  document.body.appendChild(probe)
  const px = Number.parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return px
}

/** 広げたシートの上の辺が来る位置（画面の上からの px） */
export function sheetCeilingTop(sheet: HTMLElement, ceiling: SheetCeiling): number {
  if (ceiling === 'header') {
    const page = sheet.closest<HTMLElement>('[data-sheet-page]')
    const band = page?.querySelector<HTMLElement>('[data-sheet-ceiling]')
    if (band) return band.getBoundingClientRect().bottom + CEILING_GAP_PX
    if (page) return page.getBoundingClientRect().top + CEILING_GAP_PX
  }
  return safeAreaTop() + CEILING_GAP_PX
}

/** 下の辺を動かさずに、上の辺を上の端まで上げたときの高さ（px） */
function ceilingHeight(sheet: HTMLElement, ceiling: SheetCeiling): number {
  return Math.max(0, sheet.getBoundingClientRect().bottom - sheetCeilingTop(sheet, ceiling))
}

/**
 * シートを広げた形にする部品。useSheetDrag に steps と measureGrow を渡し、シートの要素に ref を付け、
 * style（offset と returning は useSheetDrag の値）をシートの style に重ねる（sheetDragFullStyle より後ろに）。
 * active の間は、シートの要素に data-sheet-expanded を付ける（下の欄の高さの上限を外す。TripMapPage.module.css）
 */
export function useSheetExpand(ceiling: SheetCeiling = 'header') {
  const node = useRef<HTMLElement | null>(null)
  // 広げた形の高さ（px）。null なら広げていない
  const [height, setHeight] = useState<number | null>(null)
  // 広げる・戻す動きの途中か（この間も、下の欄の高さの上限を外したままにする）
  const [moving, setMoving] = useState(false)
  // 開いた形の高さ（つかんだときに測る）。上へ引いている間は、この高さに指の動きを足す
  const [restHeight, setRestHeight] = useState(0)
  // 戻すときの、動きの始まりの高さ。描き直したあとで、元の高さを測って動かす
  const shrinkFrom = useRef<number | null>(null)
  // いま動いている、広げる・戻す動き。次の動きを始める前に取り消す
  const running = useRef<Animation | null>(null)
  // いまの動きを取り消す。取り消した動きの終わりの知らせは数えない（次の動きの途中で moving を消さない）
  const stopRunning = useCallback(() => {
    const animation = running.current
    running.current = null
    animation?.cancel()
  }, [])

  const ref = useCallback((element: HTMLElement | null) => {
    node.current = element
  }, [])

  const animate = useCallback((element: HTMLElement, from: number, to: number, motion: typeof GROW_MOTION) => {
    stopRunning()
    if (Math.abs(from - to) < 1 || prefersReducedMotion() || typeof element.animate !== 'function') {
      setMoving(false)
      return
    }
    setMoving(true)
    const animation = element.animate(
      [
        { height: `${from}px`, maxHeight: 'none' },
        { height: `${to}px`, maxHeight: 'none' },
      ],
      motion,
    )
    running.current = animation
    // 自分がいまの動きのときだけ、動きの途中の印を消す
    const done = () => {
      if (running.current !== animation) return
      running.current = null
      setMoving(false)
    }
    animation.onfinish = done
    animation.oncancel = done
  }, [stopRunning])

  /** 開いた形のとき、上へ引いて伸ばせる量（px）。つかむたびに測る（useSheetDrag の measureGrow） */
  const measureGrow = useCallback(() => {
    const element = node.current
    if (!element) return 0
    setRestHeight(element.offsetHeight)
    return Math.max(0, element.getBoundingClientRect().top - sheetCeilingTop(element, ceiling))
  }, [ceiling])

  /** 上へ引いて離した。いまの高さ（指で伸ばした高さ）から、上の端まで広げる */
  const grow = useCallback(() => {
    const element = node.current
    if (!element) return
    const from = element.getBoundingClientRect().height
    const to = Math.max(from, ceilingHeight(element, ceiling))
    setHeight(to)
    animate(element, from, to, GROW_MOTION)
  }, [animate, ceiling])

  /**
   * 広げた形で下へ引いて離した。下げた位置から、元の高さへ戻す。lowered は、指で下げた量（translate で下げているシート）。
   * 高さを縮めて下げているシートは 0 を渡す（いまの高さが、もう下げた高さ）
   */
  const shrink = useCallback((lowered: number) => {
    const element = node.current
    shrinkFrom.current = element ? Math.max(0, element.getBoundingClientRect().height - lowered) : null
    // 広げる動きの途中なら、いまの高さを測ったあとで取り消す
    stopRunning()
    // 動きの途中の印（moving）は、ここでは立てない。描き直したあと、ふつうの形の上限（場所の情報の 52dvh、
    // 下の欄の 78%）が効いた状態で戻り先の高さを測ってから、animate が立てる（先に立てると、上限が外れたまま測り、
    // 動きの終わりに高さが跳ぶ）
    setMoving(false)
    setHeight(null)
  }, [stopRunning])

  /** 動きを付けずに、広げていない形に戻す（シートを閉じた形にしたときなど） */
  const reset = useCallback(() => {
    stopRunning()
    shrinkFrom.current = null
    setHeight(null)
    setMoving(false)
  }, [stopRunning])

  // 戻したあと（描く前）に、ふつうの形の上限が効いた元の高さを測って、下げた位置から動かす。
  // animate が moving を立てると、描く前にもう一度描き直し、動きの間は上限を外す（動きの高さはキーフレームが決める）
  useLayoutEffect(() => {
    const from = shrinkFrom.current
    shrinkFrom.current = null
    const element = node.current
    if (height !== null || from === null || !element) return
    animate(element, from, element.offsetHeight, SHRINK_MOTION)
  }, [height, animate])

  // 広げている間に画面の大きさが変わったら、上の端まで合わせ直す
  const expanded = height !== null
  useEffect(() => {
    if (!expanded) return
    const fit = () => {
      const element = node.current
      if (element) setHeight(ceilingHeight(element, ceiling))
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [expanded, ceiling])

  const steps: SheetSteps = expanded ? { shrink } : { grow }

  /**
   * シートの style に重ねる値。広げた形では、その高さ。上へ引いている間は、指についてシートを伸ばす
   * （下の辺は動かさない。translate は付けない）。少し引いただけで離したら、元の高さへ戻る動きを付ける
   */
  const style = (offset: number | null, returning: boolean): CSSProperties | undefined => {
    if (height !== null) return { height: `${height}px`, maxHeight: 'none' }
    if (offset !== null && offset < 0 && restHeight > 0) {
      return { height: `${restHeight - offset}px`, maxHeight: 'none', transform: 'none', transition: 'none', animation: 'none' }
    }
    if (returning && offset !== null && restHeight > 0) {
      return {
        height: `${restHeight}px`,
        maxHeight: 'none',
        transition: `transform ${SHEET_RETURN_MS}ms ease-out, height ${SHEET_RETURN_MS}ms ease-out`,
      }
    }
    return undefined
  }

  /** 広げた形か、広げる・戻す途中か、上へ引いている途中か */
  const active = (offset: number | null) => expanded || moving || (offset !== null && offset < 0)

  return {
    /** 広げた形か */
    expanded,
    /** 広げた形の高さ（px）。広げていなければ null（高さを自分で組み立てるシートが使う） */
    height,
    ref,
    measureGrow,
    /** useSheetDrag に渡す。広げていなければ grow、広げていれば shrink */
    steps,
    reset,
    style,
    active,
  }
}

export type SheetExpand = ReturnType<typeof useSheetExpand>
