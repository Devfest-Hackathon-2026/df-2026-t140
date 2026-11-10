import type { InputHTMLAttributes, ReactNode } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  label: string
  /** ラベルの右に出す短い文字（「1泊2日」など） */
  aside?: ReactNode
  hint?: ReactNode
  /** 小さいラベル（「開始日」など、項目の中の項目） */
  small?: boolean
  children: ReactNode
}

/** ラベル付きの入力欄。label で包むので、ラベルを押しても入力できる */
export function Field({ label, aside, hint, small, children }: FieldProps) {
  return (
    <label className={small ? `${styles.field} ${styles.small}` : styles.field}>
      <span className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {aside && <span className={styles.aside}>{aside}</span>}
      </span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

export function TextInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return <input className={styles.input} {...props} />
}
