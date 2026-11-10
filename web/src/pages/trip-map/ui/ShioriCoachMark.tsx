import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ShioriCoachMark.module.css'

interface Props {
  /** 明るく残して指す、左上のルートボタン（の入れ物） */
  target: RefObject<HTMLElement | null>
  /** 明るく残した所を押した（しおりを開く） */
  onOpen: () => void
}

/** 明るく残す丸の、ボタンの外へのはみ出し（px） */
const HOLE_PAD = 8

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * しおりの入口の案内（S07）。その旅のしおりに初めて場所が入ったときに出す。
 * 画面全体をうすく暗くして、左上のルートボタンのまわりだけ明るく残し、そこへ向けた矢印と「しおりを開く」を出す。
 * 明るく残した所（ルートボタン）だけが押せ、押すとしおりが開いて消える。ほかは押せない（後ろの画面は inert にする）。
 */
export function ShioriCoachMark({ target, onOpen }: Props) {
  const [rect, setRect] = useState<Rect | null>(null)
  const hole = useRef<HTMLButtonElement>(null)
  const labelId = useId()

  // ボタンの位置を測る。画面の大きさが変わったら測り直す
  useLayoutEffect(() => {
    const measure = () => {
      const box = target.current?.getBoundingClientRect()
      if (box) setRect({ left: box.left, top: box.top, width: box.width, height: box.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [target])

  // 押せるのはここだけなので、フォーカスを移しておく（キーボードでもすぐ開ける）
  useEffect(() => {
    if (rect) hole.current?.focus({ preventScroll: true })
  }, [rect])

  if (!rect) return null
  const radius = Math.max(rect.width, rect.height) / 2 + HOLE_PAD
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // 矢印：右下の文字の上から、ボタンの右下へ曲がりながら向かう
  const start = { x: cx + 84, y: cy + radius + 92 }
  const end = { x: cx + radius * 0.62, y: cy + radius * 0.9 + 6 }
  const control = { x: start.x + 4, y: end.y + 8 }

  return createPortal(
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <button
        ref={hole}
        type="button"
        className={styles.hole}
        style={{ left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 }}
        aria-label="しおりを開く"
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
        しおりを開く
      </p>
    </div>,
    document.body,
  )
}
