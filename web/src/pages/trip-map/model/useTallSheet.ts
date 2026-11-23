import { type AnimationEvent, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { halfSheetHeight } from './tallSheet'

/**
 * 全面との行き来の動き。
 * rise：ふつうの高さから全面へ。全面の形にしてから、上の辺が元の高さにあった位置（px だけ下）から上げる。
 *        同時に、シートの白を、上の辺から画面の一番上まで（cover だけ）伸ばす。
 * lower：全面からふつうの高さへ。全面の形のまま、ふつうの高さの位置（to だけ下）まで下げてから、ふつうの形に切り替える。
 *        同時に、上へ伸ばしていた白（cover）を、シートの上の辺まで縮める
 */
export type TallMove = { kind: 'rise'; px: number; cover: number } | { kind: 'lower'; to: number; cover: number }

/** 下げる動きが終わった知らせ（animationend）が来なかったときに、ふつうの形へ切り替えるまでの時間（ms。動きの長さより少し長く） */
const LOWER_FALLBACK_MS = 420

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 全面の形のシートの上の辺から、画面（ページの枠の内側）の一番上までの高さ（px）。旅の名前の帯がある所。全面のあいだ、ここもシートの白で覆う */
function coverHeight(sheet: HTMLElement): number {
  const page = sheet.closest<HTMLElement>('[data-sheet-page]')
  if (!page) return 0
  return Math.max(0, sheet.getBoundingClientRect().top - (page.getBoundingClientRect().top + page.clientTop))
}

/**
 * しおり（S11）のシートを画面いっぱいに広げた形（全面。地図なしでしおりだけを見る）との行き来を、
 * 画面を移らずに、シートが伸び縮みする動きでつなぐ（かめの方針、2026-11-20）。
 * 全面では、シートの中身は上の帯（旅の名前の帯）のすぐ下から始まり、シートの白は帯の裏を通って画面の一番上まで届く。地図は見えない。
 * tall は、いま全面にしたいか（URL の値）。shown は、全面の形で描いているか。下げる動きのあいだは、tall が false でも shown は true のまま。
 * ページは shown で配置（下の欄を上の帯の下まで広げる）を決め、シートは shown と move で形と動きを決める。
 * 動きの前に、prepareGrow か prepareShrink を呼んでおく（いまの高さを測る）。呼ばずに tall が変わったとき
 * （端末の戻る操作、ホームから直接開いた）は、動きを付けずに切り替える
 */
export function useTallSheet(tall: boolean) {
  const element = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(tall)
  const [move, setMove] = useState<TallMove | null>(null)
  // ふつうの高さのシートを、指で上へ引いて伸ばしている途中か。ページは、この間、地図を合わせ直さない
  const [stretching, setStretching] = useState(false)
  // 上げる前の高さ（指で伸ばしたぶんを含む）。全面の形になったあとで、新しい高さとの差を出す
  const fromHeight = useRef<number | null>(null)

  // 描画の中で状態を書き換えず、tall と shown の食い違いから次の形を決める
  if (tall && !shown) {
    setShown(true)
    // 下げている途中でまた上げたときは、下げる動きを捨てる
    if (move?.kind === 'lower') setMove(null)
  }
  // 下げる動きを用意していないとき（戻る操作など）は、すぐ切り替える
  if (!tall && shown && move?.kind !== 'lower') setShown(false)

  // 全面の形になった直後（描く前）に、元の高さとの差を測って、上がる動きを始める
  useLayoutEffect(() => {
    const before = fromHeight.current
    fromHeight.current = null
    if (!shown || before === null || !element.current) return
    const px = Math.max(0, element.current.offsetHeight - before)
    const cover = coverHeight(element.current)
    if ((px > 1 || cover > 1) && !prefersReducedMotion()) setMove({ kind: 'rise', px, cover })
  }, [shown])

  // 下げる動きの終わりの知らせが来なくても、ふつうの形へ切り替える
  const lowering = !tall && shown && move?.kind === 'lower'
  useLayoutEffect(() => {
    if (!lowering) return
    const timer = setTimeout(() => {
      setShown(false)
      setMove(null)
    }, LOWER_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [lowering])

  const sheetRef = useCallback((node: HTMLElement | null) => {
    element.current = node
  }, [])

  /** 全面にする直前に呼ぶ。いまの高さ（指で伸ばしていれば、伸ばした高さ）を覚える */
  const prepareGrow = useCallback(() => {
    fromHeight.current = element.current?.offsetHeight ?? null
  }, [])

  /** ふつうの高さに戻す直前に呼ぶ（「地図で見る」、左上の戻るボタン） */
  const prepareShrink = useCallback(() => {
    const node = element.current
    if (!node || prefersReducedMotion()) return
    const to = Math.max(0, node.offsetHeight - halfSheetHeight(node))
    const cover = coverHeight(node)
    if (to <= 1 && cover <= 1) return
    setMove({ kind: 'lower', to, cover })
  }, [])

  // シート自身の動きが終わった（中の部品の動きの終わりは数えない）
  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || !move) return
      if (move.kind === 'lower') setShown(false)
      setMove(null)
    },
    [move],
  )

  return { shown, move, stretching, setStretching, sheetRef, prepareGrow, prepareShrink, onAnimationEnd }
}

export type TallSheet = ReturnType<typeof useTallSheet>
