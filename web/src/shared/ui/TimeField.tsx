import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { clockFromDigits, clockLabel, formatClockDigits, nextClockDigits, type PageZoom, pageZoom, restorePageZoom, translate } from '@/shared/lib'
import styles from './TimeField.module.css'

interface Props {
  /** いまの時刻（HH:MM） */
  value: string
  /** 欄の名前（「集合時間」など）。読み上げに使う */
  label: string
  /** 時刻が決まったとき（0 時からの分）。今と同じ時刻なら呼ばない */
  onCommit: (minutes: number) => void
  /** 保存を待っているあいだ。少し薄く出し、押せなくする */
  busy?: boolean
}

/**
 * 押して直せる時刻の欄。枠で囲み、直せることが分かるようにする。押すと数字だけの入力欄になり、24 時間制で 4 けた打つと決まる。
 * 欄の外を押す、Enter でも決まる（4 けたに足りなければ、「9」は 9 時ちょうど、「093」は 9 時 30 分）。Esc か、何も打たずに離れると、元のまま。
 * 時刻にならない数字（25 時、70 分）は受け付けない（決まりは shared/lib の clock.ts）。
 * iPhone の Safari が入力欄に合わせて画面を拡大したときは、決めたとき・やめたときに、押す前の拡大率と位置に戻す（Takana の依頼、2026-11-19）。
 * まわりの行の長押し（しおりの入れ替え）とスワイプは、この欄からは始めない
 */
export function TimeField({ value, label, onCommit, busy = false }: Props) {
  const [editing, setEditing] = useState(false)
  const [digits, setDigits] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  // 決めたあとの blur で、もう一度決めないように
  const settled = useRef(false)
  // 押す前の画面の拡大率と位置。直し終えたら、ここへ戻す
  const zoom = useRef<PageZoom | null>(null)

  const finish = (typed: string) => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    restorePageZoom(zoom.current)
    const minutes = clockFromDigits(typed)
    if (minutes !== null && clockLabel(minutes) !== value) onCommit(minutes)
  }
  const cancel = () => {
    settled.current = true
    setEditing(false)
    restorePageZoom(zoom.current)
  }

  // 欄の外を押したら決める。iPhone の Safari は、押せないところを押しても入力欄から離れない（blur しない）ので、自分で離す
  useEffect(() => {
    if (!editing) return
    const onOutside = (event: PointerEvent) => {
      if (input.current && !input.current.contains(event.target as Node)) input.current.blur()
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
  }, [editing])

  // 直している途中で欄が消えたとき（しおりの行が入れ替わった、画面を移った）も、拡大を戻す
  useEffect(() => {
    if (!editing) return
    const settledNow = settled
    const zoomNow = zoom
    return () => {
      // 画面を移った先かもしれないので、スクロールの位置は戻さない
      if (!settledNow.current) restorePageZoom(zoomNow.current, false)
    }
  }, [editing])

  const start = () => {
    settled.current = false
    zoom.current = pageZoom()
    setDigits('')
    setEditing(true)
  }
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = nextClockDigits(digits, event.target.value)
    setDigits(next)
    if (next.length === 4) finish(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finish(digits)
    if (event.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <input
        ref={input}
        className={`${styles.field} ${styles.editing}`}
        // 開いたらすぐ打てるように
        autoFocus
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        autoComplete="off"
        maxLength={5}
        aria-label={translate(`${label}。数字 4 けたで入れます`, `${label}. Enter four digits.`)}
        placeholder={value}
        value={formatClockDigits(digits)}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => finish(digits)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      />
    )
  }
  return (
    <button
      type="button"
      className={busy ? `${styles.field} ${styles.busy}` : styles.field}
      aria-label={translate(`${label} ${value}。押すと直せます`, `${label} ${value}. Press to edit.`)}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation()
        start()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <time>{value}</time>
    </button>
  )
}
