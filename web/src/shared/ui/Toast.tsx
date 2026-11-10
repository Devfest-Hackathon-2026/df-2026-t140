import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import styles from './Toast.module.css'

interface Toast {
  id: number
  text: string
  /** 消える動きの途中。動きが終わったら一覧から外す */
  leaving?: boolean
}

const ToastContext = createContext<(text: string) => void>(() => {})

const SHOW_MS = 3200
/** 消える動きの長さ。Toast.module.css の leave と合わせる */
const LEAVE_MS = 220

/** 画面をふさがない短いお知らせ（「コピーしました」「みおが参加しました」など）を出す枠 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  // 消える動きの途中でないお知らせの id（古い順）。描画を待たずにその場で更新するので、
  // 同じ瞬間に続けて出しても、あふれる古いものを正しく選べる
  const active = useRef<number[]>([])

  // 消える動きを流してから一覧から外す。同じお知らせに 2 回呼んでもよい
  const dismiss = useCallback((id: number) => {
    active.current = active.current.filter((activeId) => activeId !== id)
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)))
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), LEAVE_MS)
  }, [])

  const show = useCallback(
    (text: string) => {
      const id = (nextId.current += 1)
      // 出ているのは 3 つまで。あふれた古いものも、いきなり消さずに消える動きを流す
      for (const oldId of active.current.slice(0, Math.max(0, active.current.length - 2))) dismiss(oldId)
      active.current = [...active.current, id]
      setToasts((current) => [...current, { id, text }])
      setTimeout(() => dismiss(id), SHOW_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext value={show}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={toast.leaving ? `${styles.toast} ${styles.leaving}` : styles.toast}>
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

/** お知らせを出す関数を返す */
// oxlint-disable-next-line react/only-export-components
export function useToast(): (text: string) => void {
  return useContext(ToastContext)
}
