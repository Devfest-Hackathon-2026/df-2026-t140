import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { playSound, type SoundName } from '@/shared/lib'
import styles from './Button.module.css'

/** 色の意味は全画面で同じ。go：進む・探す、build：建てる、route：ルート、destroy：消す（赤い地。取り消せない操作） */
type Variant = 'plain' | 'go' | 'build' | 'route' | 'soft' | 'text' | 'danger' | 'destroy' | 'dashed'

interface Look {
  sound?: SoundName | false
  variant?: Variant
  size?: 'small' | 'medium' | 'large'
  /** 横幅いっぱいに広げる */
  block?: boolean
  /** 正方形のアイコンだけのボタン。aria-label を必ず付ける */
  iconOnly?: boolean
  className?: string
}

function classNames({ variant = 'plain', size = 'medium', block, iconOnly, className }: Look): string {
  return [
    styles.button,
    variant !== 'plain' && styles[variant],
    size !== 'medium' && styles[size],
    block && styles.block,
    iconOnly && styles.icon,
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

type ButtonProps = Look & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export function Button({ variant, size, block, iconOnly, className, sound, onClick, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={classNames({ variant, size, block, iconOnly, className })} {...rest} onClick={(event) => {
    if (sound) playSound(sound)
    onClick?.(event)
  }} />
}

interface ButtonLinkProps extends Look {
  to: string
  state?: unknown
  children: ReactNode
  'aria-label'?: string
}

/** 見た目はボタンで、押すと画面を移るもの */
export function ButtonLink({ variant, size, block, iconOnly, className, sound = 'open', ...rest }: ButtonLinkProps) {
  return <Link className={classNames({ variant, size, block, iconOnly, className })} {...rest} onClick={(event) => {
    if (sound && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) playSound(sound)
  }} />
}
