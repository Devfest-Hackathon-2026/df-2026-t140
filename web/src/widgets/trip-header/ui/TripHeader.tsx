import type { ReactNode } from 'react'
import { AvatarStack, type Member } from '@/entities/member'
import { HomeButton, Icon, type IconName } from '@/shared/ui'
import { useElementHeight } from '@/shared/lib'
import styles from './TripHeader.module.css'

interface Props {
  /** 旅の名前。ピンを選んでいるときは、もとになった希望の文 */
  title: string
  /** 左端のボタン（ルートボタン、戻るボタン） */
  left?: ReactNode
  /** 名前の下に並べる小さな数（建物の数、ピンの数、日程など）。HeaderBadge を渡す */
  badges?: ReactNode
  /** 右端のボタン。渡さなければホームボタン。null なら置かない */
  right?: ReactNode | null
  /** 旅のメンバー。名前の下の右に、顔を少し重ねて並べる（Google の共同編集の顔の並びのように。#231） */
  members?: readonly Pick<Member, 'displayName' | 'color'>[]
  /** 帯を押したとき（メンバーと招待のシートを開く）。渡すと、帯のどこを押しても（名前でも顔でも）呼ぶ */
  onOpenMembers?: () => void
  /** メンバーと招待のシートが開いているか（読み上げで、開いていることを伝える） */
  membersOpen?: boolean
}

/** 帯に並べる顔の数。これより多いときは、1 つ少なく並べて「+N」にする */
const MAX_FACES = 4

/**
 * 旅の画面の上の帯（A＋C）。左上はルートボタンか戻るボタン、右上はホームボタン（企画書「ユーザー体験」1、3-1）。
 * まん中の帯は、旅の名前と、その下に数の印とメンバーの顔。onOpenMembers を渡すと帯ごと押せるボタンになり、
 * メンバーと招待のシートを開く（旅の中のどの状態でも同じ入口。#231）。
 * 押せる範囲は帯の全体。帯の中の名前のボタンの範囲を、帯いっぱいに広げている（見出しの中にボタンを置くため）
 */
export function TripHeader({ title, left, badges, right, members, onOpenMembers, membersOpen }: Props) {
  const faces = members && members.length > 0 ? members : null
  const [titleRef, titleHeight] = useElementHeight()
  return (
    <header className={styles.header}>
      {left}
      <div ref={titleRef} className={onOpenMembers ? `${styles.title} ${styles.tappable}` : styles.title}>
        <h1 className={styles.heading}>
          {onOpenMembers ? (
            <button type="button" className={styles.open} aria-expanded={membersOpen} onClick={onOpenMembers}>
              <span className={styles.name}>{title}</span>
              <span className={styles.srOnly}>{faces ? `（メンバーと招待を開く。メンバーは ${faces.length} 人）` : '（メンバーと招待を開く）'}</span>
            </button>
          ) : (
            <span className={styles.name}>{title}</span>
          )}
        </h1>
        {(badges || faces) && (
          <div className={styles.meta}>
            {badges && <div className={styles.badges}>{badges}</div>}
            {faces && (
              <span className={styles.faces}>
                <AvatarStack members={[...faces]} size={26} max={MAX_FACES} />
              </span>
            )}
          </div>
        )}
      </div>
      {right === undefined ? (
        <span className={styles.home} style={titleHeight ? { width: titleHeight, height: titleHeight } : undefined}>
          <HomeButton />
        </span>
      ) : right}
    </header>
  )
}

interface BadgeProps {
  /** 色の意味は全画面で同じ。go：ピン・探す、build：建物、route：ルート・日程 */
  tone: 'go' | 'build' | 'route'
  icon: IconName
  /** 読み上げ用の説明（「建物 2」） */
  label: string
  children: ReactNode
}

/** 上の帯に並べる、マークと数字の小さな印（A＋C：件数はマークと数字で出す） */
export function HeaderBadge({ tone, icon, label, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} role="img" aria-label={label}>
      <Icon name={icon} size={16} />
      <span aria-hidden="true">{children}</span>
    </span>
  )
}
