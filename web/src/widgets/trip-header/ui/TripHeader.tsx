import { type ReactNode, type RefObject, useCallback } from 'react'
import { AvatarStack, type Member } from '@/entities/member'
import { HomeButton, Icon, type IconName } from '@/shared/ui'
import { useElementHeight, useFitText } from '@/shared/lib'
import styles from './TripHeader.module.css'

interface Props {
  /** 旅の名前。ピンを選んでいるときは、もとになった希望の文 */
  title: string
  /** 左端のボタン（戻るボタン） */
  left?: ReactNode
  /** 左端のボタンを、右のホームボタンと同じ、帯の高さの正方形にする（しおりボタン） */
  leftSquare?: boolean
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
  /** 数の印がないときに、名前と顔を 1 段に並べ、名前を大きくして上下の中央に置く（みんなの地図としおり） */
  oneRow?: boolean
  /** 旅の名前の帯の要素を受け取る（帯を指す案内で、位置を測るため） */
  bandRef?: RefObject<HTMLDivElement | null>
}

/** 帯に並べる顔の数。これより多いときは、1 つ少なく並べて「+N」にする */
const MAX_FACES = 4
/** 名前と顔を 1 段に並べるとき（みんなの地図、しおり）は、顔を小さくして多く並べる（Lazyturtle0852 の決定、2026-11-22） */
const MAX_FACES_ONE_ROW = 5
/** 1 段のときの名前の大きさ（px）。1 行に入らなければ、NAME_MIN まで小さくする */
const NAME_MAX = 20
const NAME_MIN = 14

/**
 * 旅の画面の上の帯（A＋C）。左上は戻るボタン（ふだんは置かず、帯を左へ伸ばす）、右上はホームボタン（企画書「ユーザー体験」1、3-1）。
 * まん中の帯は、旅の名前と、その下に数の印とメンバーの顔。onOpenMembers を渡すと帯ごと押せるボタンになり、
 * メンバーと招待のシートを開く（#231。どの状態でも渡す）。
 * 押せる範囲は帯の全体。帯の中の名前のボタンの範囲を、帯いっぱいに広げている（見出しの中にボタンを置くため）
 */
export function TripHeader({ title, left, leftSquare, badges, right, members, onOpenMembers, membersOpen, oneRow: wantOneRow, bandRef }: Props) {
  const faces = members && members.length > 0 ? members : null
  const [titleRef, titleHeight] = useElementHeight()
  // 数の印がないときだけ、名前と顔を 1 段に並べる
  const oneRow = Boolean(wantOneRow && !badges)
  // 1 段のときの名前は、1 行に入るまで 20px から小さくする（14px まで。それでも入らなければ 2 行に折り返す）。
  // 左上にしおりボタンがあると、390px の幅では 20px の名前が 7 文字ほどで折り返すため（Lazyturtle0852 の指摘、2026-11-23）
  // 顔の数が変わると名前に使える幅も変わるので、顔の数も測り直す目印に入れる（帯の幅は変わらないため、幅では気づけない）
  const [fitName, fitBox] = useFitText(`${title}\n${faces?.length ?? 0}`, NAME_MAX, NAME_MIN, oneRow)
  // 帯の高さを測る ref と、名前の幅を測る ref と、外へ帯を渡す ref を 1 つにまとめる
  const setBand = useCallback(
    (element: HTMLDivElement | null) => {
      titleRef(element)
      fitBox(element)
      if (bandRef) bandRef.current = element
    },
    [titleRef, fitBox, bandRef],
  )
  const square = titleHeight ? { width: titleHeight, height: titleHeight } : undefined
  return (
    // 下のシートを上へ引いて広げたとき、このすぐ下まで来る（shared/lib の useSheetExpand）
    <header className={styles.header} data-sheet-ceiling>
      {leftSquare && left ? (
        <span className={styles.home} style={square}>
          {left}
        </span>
      ) : left}
      <div
        ref={setBand}
        className={[styles.title, onOpenMembers && styles.tappable, oneRow && styles.row].filter(Boolean).join(' ')}
      >
        <h1 className={oneRow ? `${styles.heading} ${styles.oneRowHeading}` : styles.heading}>
          {onOpenMembers ? (
            <button type="button" className={styles.open} aria-expanded={membersOpen} onClick={onOpenMembers}>
              <span ref={fitName} className={styles.name}>{title}</span>
              <span className={styles.srOnly}>{faces
                ? translate(`（メンバーと招待を開く。メンバーは ${faces.length} 人）`, ` (Open members and invitations, ${faces.length} ${faces.length === 1 ? 'member' : 'members'})`)
                : translate('（メンバーと招待を開く）', ' (Open members and invitations)')}</span>
            </button>
          ) : (
            <span ref={fitName} className={styles.name}>{title}</span>
          )}
        </h1>
        {(badges || faces) && (
          <div className={styles.meta}>
            {badges && <div className={styles.badges}>{badges}</div>}
            {faces && (
              <span className={styles.faces}>
                <AvatarStack members={[...faces]} size={oneRow ? 24 : 26} max={oneRow ? MAX_FACES_ONE_ROW : MAX_FACES} />
              </span>
            )}
          </div>
        )}
      </div>
      {right === undefined ? (
        <span className={styles.home} style={square}>
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
import { translate } from '@/shared/lib'
