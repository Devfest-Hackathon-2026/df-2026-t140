import type { CSSProperties } from 'react'
import { translate as t } from '@/shared/lib'
import { initialOf } from '../model/member'
import type { Member } from '../model/types'
import styles from './Avatar.module.css'

type Person = Pick<Member, 'displayName' | 'color'>

function style(size: number, color?: string): CSSProperties {
  return { '--avatar-size': `${size}px`, ...(color ? { '--avatar-color': color } : {}) } as CSSProperties
}

/** 個人の色の丸に、名前の 1 文字目 */
export function Avatar({ member, size = 40 }: { member: Person; size?: number }) {
  return (
    <span className={styles.avatar} style={style(size, member.color)} title={member.displayName} aria-hidden="true">
      {initialOf(member.displayName)}
    </span>
  )
}

/** アバターを少し重ねて並べる。多いときは「+2」とまとめる */
export function AvatarStack({ members, size = 36, max = 5 }: { members: Person[]; size?: number; max?: number }) {
  const shown = members.length > max ? members.slice(0, max - 1) : members
  const rest = members.length - shown.length
  return (
    <span className={styles.stack} role="img" aria-label={`${t('メンバー：', 'Members: ')}${members.map((m) => m.displayName).join(t('、', ', '))}`}>
      {shown.map((member, index) => (
        <Avatar key={index} member={member} size={size} />
      ))}
      {rest > 0 && (
        <span className={`${styles.avatar} ${styles.more}`} style={style(size)} aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  )
}
