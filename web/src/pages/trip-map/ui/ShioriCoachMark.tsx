import { translate } from '@/shared/lib'
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSkipKey } from '../model/useSkipKey'
import styles from './ShioriCoachMark.module.css'

interface Props {
  /** 明るく残して指すもの（左上のしおりボタンの入れ物、旅の名前の帯、場所カードの建築ボタンの入れ物） */
  target: RefObject<HTMLElement | null>
  /** 明るく残した所を押した */
  onOpen: () => void
  /** 暗い所を押した（か Esc キー）。案内をとばす */
  onSkip: () => void
  /**
   * 明るく残す形。round は丸（しおりボタン）、band は角の丸い横長（旅の名前の帯。一言は下）、
   * button は角の丸い横長のボタン（場所カードの「建築する！」と、旅を作った直後の下のやりたいことの欄。一言は上）。既定は round
   */
  shape?: 'round' | 'band' | 'button'
  /** 矢印の先に出す一言。明るく残した所の読み上げ名にもする。既定は「しおりを開く」 */
  label?: string
}

/** 明るく残す丸の、ボタンの外へのはみ出し（px） */
const HOLE_PAD = 8

interface Rect {
  left: number
  top: number
  width: number
  height: number
  /** 測ったときの画面の高さ。建築ボタンの上の一言は画面の下から置くので、高さだけが変わったときも描き直す */
  viewportHeight: number
}

/**
 * 押す所の案内。画面全体をうすく暗くして、指すもののまわりだけ明るく残し、そこへ向けた矢印と一言を出す。
 * 明るく残した所を押すと、そこを開いて消える。暗い所を押すか Esc キーで、開かずに案内だけ消える（とばす）。
 * 後ろの画面は押せない（inert にする）。
 * しおりの入口の案内（S07。その旅のしおりに初めて場所が入ったとき、左上のしおりボタン）と、
 * 旅の設定の入口の案内（旅を作った直後の招待のシートを閉じたとき、旅の名前の帯）と、
 * 「建築する！」の案内（S05。候補のピンを初めて選んだとき、場所カードの建築ボタン）に使う。
 */
export function ShioriCoachMark({ target, onOpen, onSkip, shape = 'round', label = translate('しおりを開く', 'Open itinerary') }: Props) {
  const [rect, setRect] = useState<Rect | null>(null)
  const hole = useRef<HTMLButtonElement>(null)
  const labelId = useId()

  // 指すものの位置を、案内を出しているあいだ毎フレーム測り、変わったときだけ描き直す。
  // 一度だけ測ると、場所カードが横から入る動き（transform）の途中の位置で止まり、枠が建築ボタンからずれる（UI バグ 3）。
  // transform の動きやスクロールは resize や ResizeObserver では拾えないので、まとめてフレームごとに追う
  // （画面の大きさの変化、旅の名前が折り返して帯の高さが変わったときも、これで追える）
  useLayoutEffect(() => {
    // 下のカードの中のボタンは、カードの中で隠れていることがあるので、先に見える所まで送る
    if (shape === 'button') target.current?.scrollIntoView({ block: 'nearest' })
    let last: Rect | null = null
    let frame = 0
    const measure = () => {
      const box = target.current?.getBoundingClientRect()
      if (!box) return
      const next = { left: box.left, top: box.top, width: box.width, height: box.height, viewportHeight: window.innerHeight }
      if (!last || (Object.keys(next) as (keyof Rect)[]).some((key) => last?.[key] !== next[key])) {
        last = next
        setRect(next)
      }
    }
    const tick = () => {
      measure()
      frame = requestAnimationFrame(tick)
    }
    measure()
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, shape])

  // 押してほしい所へ、フォーカスを移しておく（キーボードでもすぐ開ける）。位置は毎フレーム変わりうるので、出たときに一度だけ
  const placed = rect !== null
  useEffect(() => {
    if (placed) hole.current?.focus({ preventScroll: true })
  }, [placed])

  useSkipKey(onSkip)

  if (!rect) return null
  if (shape === 'band') return createPortal(<BandMark rect={rect} hole={hole} labelId={labelId} label={label} onOpen={onOpen} onSkip={onSkip} />, document.body)
  if (shape === 'button') return createPortal(<ButtonMark rect={rect} hole={hole} labelId={labelId} label={label} onOpen={onOpen} onSkip={onSkip} />, document.body)
  const radius = Math.max(rect.width, rect.height) / 2 + HOLE_PAD
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // 矢印：右下の文字の上から、ボタンの右下へ曲がりながら向かう
  const start = { x: cx + 84, y: cy + radius + 92 }
  const end = { x: cx + radius * 0.62, y: cy + radius * 0.9 + 6 }
  const control = { x: start.x + 4, y: end.y + 8 }

  return createPortal(
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <SkipArea onSkip={onSkip} />
      <button
        ref={hole}
        type="button"
        className={styles.hole}
        style={{ left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 }}
        aria-label={label}
        onClick={onOpen}
      />
      <div className={styles.guide} aria-hidden="true">
        <svg className={styles.arrow} width="100%" height="100%">
          <defs>
            <marker id={`${labelId}-head`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          <path
            d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            markerEnd={`url(#${labelId}-head)`}
          />
        </svg>
      </div>
      <p id={labelId} className={styles.label} style={{ left: start.x - 48, top: start.y + 10 }}>
        {label}
      </p>
    </div>,
    document.body,
  )
}

interface BandProps {
  rect: Rect
  hole: RefObject<HTMLButtonElement | null>
  labelId: string
  label: string
  onOpen: () => void
  onSkip: () => void
}

/** 横長の帯を明るく残す形。矢印は、帯の下の一言から、帯の下の縁へまっすぐ上に向かう */
function BandMark({ rect, hole, labelId, label, onOpen, onSkip }: BandProps) {
  const cx = rect.left + rect.width / 2
  const bottom = rect.top + rect.height + HOLE_PAD
  const start = { x: cx - 24, y: bottom + 96 }
  const end = { x: cx, y: bottom + 10 }
  const control = { x: start.x - 28, y: (start.y + end.y) / 2 }

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <SkipArea onSkip={onSkip} />
      <button
        ref={hole}
        type="button"
        className={`${styles.hole} ${styles.band}`}
        style={{ left: rect.left - HOLE_PAD, top: rect.top - HOLE_PAD, width: rect.width + HOLE_PAD * 2, height: rect.height + HOLE_PAD * 2 }}
        aria-label={label}
        onClick={onOpen}
      />
      <div className={`${styles.guide} ${styles.up}`} aria-hidden="true">
        <svg className={styles.arrow} width="100%" height="100%">
          <defs>
            <marker id={`${labelId}-head`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          <path
            d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            markerEnd={`url(#${labelId}-head)`}
          />
        </svg>
      </div>
      {/* 文は画面の中央にそろえる（帯が左端まで伸びて矢印の根元が左に寄ったので、根元にそろえると長い文が画面の左で切れる） */}
      <p id={labelId} className={`${styles.label} ${styles.center}`} style={{ left: '50%', top: start.y + 10 }}>
        {label}
      </p>
    </div>
  )
}

/** 下のカードの中の横長のボタンを明るく残す形。矢印は、ボタンの上の一言から、ボタンの上の縁へまっすぐ下に向かう */
function ButtonMark({ rect, hole, labelId, label, onOpen, onSkip }: BandProps) {
  const cx = rect.left + rect.width / 2
  const top = rect.top - HOLE_PAD
  const start = { x: cx + 24, y: top - 96 }
  const end = { x: cx, y: top - 10 }
  const control = { x: start.x + 28, y: (start.y + end.y) / 2 }

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <SkipArea onSkip={onSkip} />
      <button
        ref={hole}
        type="button"
        className={`${styles.hole} ${styles.button}`}
        style={{ left: rect.left - HOLE_PAD, top: rect.top - HOLE_PAD, width: rect.width + HOLE_PAD * 2, height: rect.height + HOLE_PAD * 2 }}
        aria-label={label}
        onClick={onOpen}
      />
      <div className={`${styles.guide} ${styles.down}`} aria-hidden="true">
        <svg className={styles.arrow} width="100%" height="100%">
          <defs>
            <marker id={`${labelId}-head`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          <path
            d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            markerEnd={`url(#${labelId}-head)`}
          />
        </svg>
      </div>
      {/* 一言は矢印の根元の上に、画面の中央にそろえて置く（長い文は折り返す） */}
      <p id={labelId} className={`${styles.label} ${styles.center} ${styles.wrap}`} style={{ left: '50%', bottom: rect.viewportHeight - start.y + 10 }}>
        {label}
      </p>
    </div>
  )
}

/** 暗い所の全体を覆う、見えないボタン。明るく残した所の後ろに置き、押すと案内をとばす（明るく残した所は、上に重ねたボタンが受ける） */
function SkipArea({ onSkip }: { onSkip: () => void }) {
  // キーボードでは Esc でとばす（見えないボタンに Tab で移っても、どこにいるか分からないため）
  return <button type="button" className={styles.skip} aria-label={translate('案内をとばす', 'Skip the guide')} tabIndex={-1} onClick={onSkip} />
}
