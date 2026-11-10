import { type CSSProperties, type PointerEvent, type ReactNode, type TransitionEvent, useRef, useState } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { CATEGORY_LABELS, CategoryIcon, type Pin, pinOriginNote } from '@/entities/pin'
import { foldOpenness, geminiName, type Neighbor, playSound, SHEET_RETURN_MS, type SheetRest, useNeighborSwipe, useSheetDrag } from '@/shared/lib'
import { Icon, SideCards } from '@/shared/ui'
import styles from './PlaceCard.module.css'

/** 取っ手を押してから離すまでに、これより動いたら押したのではなく払ったとみなす（px） */
const GRIP_TAP_SLOP_PX = 10
/** 開いたときのカードの高さの上限（画面の高さに対する割合）。TripMapPage の下の欄（.bottom）の max-height と同じ */
const OPEN_MAX_RATIO = 0.78

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  pin: Pin
  /** 同じ希望の候補の中で何番目か（1 から）と、候補の数。候補のピンのときだけ「1 / 3」と出す（建築中・建った建物には出さない） */
  index: number
  total: number
  /** 希望を書いた人。抜けた人なら undefined */
  wisher: Pick<Member, 'displayName' | 'color'> | undefined
  /** もとになった希望の文（「わさび農園に行きたい」） */
  wishText: string | null
  /** 左上の絵。建った建物なら、模型の絵を渡す。渡さなければ、場所の種類の絵 */
  thumbnail?: ReactNode
  /** いまの状態の一言（「建築中です」「みおが建てました」など）。候補のときは渡さない */
  state?: ReactNode
  /** 右下に置く、決める操作（「建築する！」）。features/build-model が渡す */
  action?: ReactNode
  /** 操作の下に差し込む中身（Google マップの口コミ）。ページが組み立てて渡す。取っ手で閉じると一緒に隠れる */
  extra?: ReactNode
  /**
   * 前・次の場所（候補のカードなら同じ希望の候補、建物のカードなら旅のほかの建物）。端なら渡さない。
   * カードを左右にスワイプするか、カードの左右にのぞく、となりのカードを押すと go を呼ぶ
   */
  prev?: Neighbor
  next?: Neighbor
  /** スワイプで選び直したときの、カードが入ってくる向き（'next' は右から、'prev' は左から） */
  enter?: 'next' | 'prev'
}

/**
 * 場所カード（S05）。候補のピンや、建った建物を押すと、下から出る。
 * 右から左へスワイプすると次の場所、左から右へスワイプすると前の場所（ボタンの上から始めた動きは数えない）。
 * 候補のカードなら同じ希望の候補のあいだ、建物のカードなら旅の建物のあいだで移る。左右にのぞくカードを押しても移る。
 * 写真は出さない（Places の写真は使わない）。代わりに、場所の種類の絵を出す。
 * 取っ手から名前の行までをつかんで上下にドラッグすると、名前の行だけを残して閉じる・開く（取っ手を押しても切り替わる）。
 * そこから左右に払ったときは、上げ下げせずに前後の場所へ移る（動かし始めの向きで決める。shared/lib の useSheetDrag）。
 */
export function PlaceCard({ pin, index, total, wisher, wishText, thumbnail, state, action, extra, prev, next, enter }: Props) {
  // 左右のスワイプか、のぞくカードを押して、前後の場所へ（場所の情報と同じ向き。のぞくカードと合図は shared/ui の SideCards）
  const { goPrev, goNext, swipe } = useNeighborSwipe(prev, next)
  // 上の横棒（取っ手）を押すと、名前の行だけを残して閉じる。もう一度押すと開く（ほかのピンへ移ると、作り直して開いた形に戻る）
  const [collapsed, setCollapsed] = useState(false)
  // 取っ手の上から左右に払ったときは前後の場所へ移るだけにし、閉じる・開くはしない。押し始めの位置を覚えて、
  // 離したときの click で、指が大きく動いていたら切り替えない（キーボードで押したときは押し始めがないので切り替える）
  const gripStart = useRef<{ x: number; y: number } | null>(null)
  const onGripDown = (event: PointerEvent<HTMLElement>) => {
    gripStart.current = { x: event.clientX, y: event.clientY }
  }
  const onGripClick = (event: { clientX: number; clientY: number; detail: number }) => {
    const from = gripStart.current
    gripStart.current = null
    // キーボードで押した click（detail が 0）は、前に残った押し始めの位置と比べずに切り替える
    if (event.detail !== 0 && from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > GRIP_TAP_SLOP_PX) return
    playSound(collapsed ? 'open' : 'close')
    setCollapsed((value) => !value)
  }
  // 何番目かは、同じ希望の候補から選ぶときだけ出す（ヨウキンが 2026-11-07 に決めた）
  const showCount = pin.status === 'candidate' || pin.status === 'failed'

  // 上の部分（取っ手から名前の行まで）を上下にドラッグして、閉じる・開く。指の動きに合わせて、名前の行より下の枠を伸び縮みさせる
  const cardRef = useRef<HTMLElement | null>(null)
  const foldRef = useRef<HTMLDivElement | null>(null)
  const restRef = useRef<HTMLDivElement | null>(null)
  // つかんだときに測った、動ける範囲（px）と、開いた形で見える枠の高さの、中身全体に対する割合と、中身全体の高さ（px）
  const [reach, setReach] = useState({ range: 0, shown: 1, content: 0 })
  const measureRange = (from: SheetRest) => {
    const card = cardRef.current
    const content = restRef.current?.scrollHeight ?? 0
    if (!card || content <= 0) {
      setReach({ range: 0, shown: 1, content: 0 })
      return 0
    }
    // 開いた形では、カードの上限で中身が切れている分は見えていない。閉じた形からは、開いたときの上限までしか伸びない
    const visible =
      from === 'full'
        ? content - Math.max(0, card.scrollHeight - card.clientHeight)
        : Math.min(content, window.innerHeight * OPEN_MAX_RATIO - card.offsetHeight)
    const range = Math.max(0, visible)
    setReach({ range, shown: range / content, content })
    return range
  }
  const from: SheetRest = collapsed ? 'peek' : 'full'
  /** ずれ（offset）のときの、名前の行より下の枠の高さ（px） */
  const foldPx = (offset: number) => foldOpenness(from, offset, reach.range, reach.shown) * reach.content
  const { offset, returning, onReturned, gripProps } = useSheetDrag(
    from,
    0,
    (to, moved) => {
      if (to === from) return
      // 指を離した高さから、閉じた形（0）か開いた形（カードの上限までで見える高さ。その先はカードの中のスクロール）まで動かす。
      // 枠の高さは CSS では 0fr・1fr で切り替えるが、ドラッグ中の px からは CSS の transition でつながらないため、ここで動かす
      const fold = foldRef.current
      if (fold && !prefersReducedMotion()) {
        const opening = to === 'full'
        fold.animate([{ gridTemplateRows: `${foldPx(moved)}px` }, { gridTemplateRows: `${opening ? reach.range : 0}px` }], {
          duration: opening ? 340 : 300,
          easing: opening ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
        })
      }
      playSound(to === 'peek' ? 'close' : 'open')
      setCollapsed(to === 'peek')
    },
    {},
    // 押しただけのときは、取っ手のボタンが切り替える（名前の行を押しただけでは閉じない）
    { tap: false, measureRange },
  )
  // ドラッグ中と、足りずに元へ戻る間だけ、枠の高さを指に合わせる（1 未満の fr は、高さの決まらない枠で二重にかかり、
  // 中身より枠が高くなって下に空白が出るので、px で決める）
  const openness = offset === null ? null : foldOpenness(from, offset, reach.range, reach.shown)
  const foldStyle =
    openness === null || offset === null
      ? undefined
      : ({
          gridTemplateRows: `${foldPx(offset)}px`,
          marginTop: `calc(${openness - 1} * var(--space-3))`,
          opacity: openness,
          transition: returning
            ? `grid-template-rows ${SHEET_RETURN_MS}ms ease-out, margin-top ${SHEET_RETURN_MS}ms ease-out, opacity ${SHEET_RETURN_MS}ms ease-out`
            : 'none',
        } satisfies CSSProperties)
  const onFoldTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && returning) onReturned()
  }
  return (
    <SideCards
      prev={prev && goPrev && { name: prev.name, go: goPrev }}
      next={next && goNext && { name: next.name, go: goNext }}
      // はじめての時の合図は、地図でピンを押して開いたときだけ（スワイプで移ってきたときは出さない）
      hintable={!enter}
    >
      <section
        ref={cardRef}
        className={`${styles.card} ${enter === 'next' ? styles.fromRight : enter === 'prev' ? styles.fromLeft : ''}`}
        aria-label={`${pin.name}の説明`}
        {...swipe}
      >
        {/* 上の部分。上下にドラッグすると閉じる・開く（ブラウザのスクロールに取られないよう、ここだけ touch-action: none） */}
        <div className={styles.top} {...gripProps}>
        <button
          type="button"
          className={styles.grip}
          aria-label={collapsed ? `${pin.name}の説明を開く` : `${pin.name}の説明を閉じる`}
          aria-expanded={!collapsed}
          // 上から払っても、カードのスワイプとして数える（shared/lib の useSwipe）
          data-swipe-through=""
          onPointerDown={onGripDown}
          onClick={onGripClick}
          onPointerCancel={() => (gripStart.current = null)}
        >
          <span className={styles.handle} aria-hidden="true" />
        </button>
        <div className={styles.head}>
          <div className={styles.tile}>{thumbnail ?? <CategoryIcon category={pin.category} size={40} />}</div>
          <div className={styles.title}>
            <p className={styles.chips}>
              <span className={styles.category}>{CATEGORY_LABELS[pin.category] ?? CATEGORY_LABELS.town}</span>
              {showCount && (
                <span className={styles.count} aria-label={`候補 ${total} 件中 ${index} 件目`}>
                  {index} / {total}
                </span>
              )}
            </p>
            <h2 className={styles.name}>{pin.name}</h2>
            {pin.area && (
              <p className={styles.area}>
                <Icon name="pin" size={16} />
                {pin.area}
              </p>
            )}
          </div>
        </div>
        </div>

        {/*
          閉じている間は隠すだけ（「建築する！」の途中の状態や、断られた理由を消さない）。
          閉じる・開くときは、しおりのシートと同じように、下がる・上がる動きを付ける（#205）。閉じている間は押せない・読み上げない（inert）
        */}
        <div ref={foldRef} className={`${styles.fold} ${collapsed ? styles.folded : ''}`} style={foldStyle} inert={collapsed} onTransitionEnd={onFoldTransitionEnd}>
          <div ref={restRef} className={styles.rest}>
            {pin.description && <p className={styles.description}>{pin.description}</p>}

            {wishText && (
              <p className={styles.wish}>
                {wisher && <Avatar member={wisher} size={26} />}
                <span className={styles.wishText}>
                  <span className={styles.srOnly}>{wisher ? `${wisher.displayName}の希望：` : '希望：'}</span>「{wishText}」
                </span>
              </p>
            )}

            {state && <p className={styles.state}>{state}</p>}

            {/* 誰が出した候補か（見本か Gemini か）と、Google マップ（Places）で場所を確かめたか */}
            <p className={styles.note}>{pinOriginNote(geminiName(pin.suggestedBy), Boolean(pin.placeId))}</p>

            {action && <div className={styles.actions}>{action}</div>}

            {extra}
          </div>
        </div>
      </section>
    </SideCards>
  )
}
