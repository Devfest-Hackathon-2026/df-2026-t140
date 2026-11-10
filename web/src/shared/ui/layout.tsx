import type { ReactNode } from 'react'
import styles from './layout.module.css'

/** 地図のない画面の枠 */
export function Screen({ children }: { children: ReactNode }) {
  return <main className={styles.screen}>{children}</main>
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `${styles.card} ${className}` : styles.card}>{children}</section>
}

interface SheetProps {
  title: string
  lead?: ReactNode
  /** 見出しの右に置くもの（閉じるボタンなど） */
  action?: ReactNode
  children: ReactNode
}

/** 画面の下から出るシート */
export function Sheet({ title, lead, action, children }: SheetProps) {
  return (
    <section className={styles.sheet} aria-label={title}>
      <div className={styles.sheetHeader}>
        <div>
          <h2 className={styles.sheetTitle}>{title}</h2>
          {lead && <p className={styles.sheetLead}>{lead}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** 読み込み中 */
export function Loading({ label = '読み込んでいます…' }: { label?: string }) {
  return (
    <div className={styles.center} role="status">
      <div className={styles.spinner} />
      <p>{label}</p>
    </div>
  )
}

/** 入力や通信の失敗を、その場に出す */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  )
}
