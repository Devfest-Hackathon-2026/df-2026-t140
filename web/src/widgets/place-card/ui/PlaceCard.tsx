import { type CSSProperties, type PointerEvent, type ReactNode, type TransitionEvent, useRef, useState } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { pinDisplayName, pinDisplayArea, pinDisplayDescription, CATEGORY_LABELS, CategoryIcon, eventTimeLabel, type Pin, pinOriginNote } from '@/entities/pin'
import { translate, foldOpenness, geminiName, type Neighbor, playSound, SHEET_RETURN_MS, type SheetRest, useNeighborSwipe, useSheetDrag, useSheetExpand } from '@/shared/lib'
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
  /**
   * 建った建物の模型（回して見せるもの）。渡すと、左上の場所の種類の絵の代わりに、カードの右側に大きく出す。
   * 正方形で、種類のチップの行の高さから始まる。文は左に寄せる
   */
  showcase?: ReactNode
  /** いまの状態の一言（「建築中です」「みおが建てました」など）。候補のときは渡さない */
  state?: ReactNode
  /** 右下に置く、決める操作（「建築する！」）。features/build-model が渡す */
  action?: ReactNode
  /** 操作の下に差し込む中身（Google マップの口コミ）。ページが組み立てて渡す。取っ手で閉じると一緒に隠れる */
  extra?: ReactNode
  /** カードの一番下に置く操作（建った建物の「建物を消す」）。features/remove-building が渡す */
  footer?: ReactNode
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
 * 開いた形で上へ引くと、上の帯のすぐ下まで広がる。広げた形で下へ引くと、元の高さに戻る（しおりのシートと同じ。shared/lib の useSheetExpand）。
 * そこから左右に払ったときは、上げ下げせずに前後の場所へ移る（動かし始めの向きで決める。shared/lib の useSheetDrag）。
 */
export function PlaceCard({ pin, index, total, wisher, wishText, showcase, state, action, extra, footer, prev, next, enter }: Props) {
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
  // 上へ引いて、上の帯のすぐ下まで広げた形。閉じたら、広げていない形に戻す
  const expand = useSheetExpand('header')
  if (collapsed && expand.expanded) expand.reset()
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
    // 広げた形で下へ引いている間は、カードの高さを縮めて下げる（いまの高さが、もう下げた高さ）
    collapsed ? {} : expand.expanded ? { shrink: () => expand.steps.shrink?.(0) } : expand.steps,
    // 押しただけのときは、取っ手のボタンが切り替える（名前の行を押しただけでは閉じない）
    { tap: false, measureRange, measureGrow: collapsed ? undefined : expand.measureGrow },
  )
  // カードの高さ。広げた形では、その高さ（下へ引いている間は、引いたぶん縮める）。上へ引いている間は、指について伸ばす
  const expanding = expand.active(offset)
  const cardStyle: CSSProperties | undefined =
    expand.height !== null
      ? {
          height: `${expand.height - Math.max(0, offset ?? 0)}px`,
          maxHeight: 'none',
          alignContent: 'start',
          transition: returning ? `height ${SHEET_RETURN_MS}ms ease-out` : undefined,
        }
      : expanding
        ? { ...expand.style(offset, returning), alignContent: 'start' }
        : undefined
  // ドラッグ中と、足りずに元へ戻る間だけ、枠の高さを指に合わせる（1 未満の fr は、高さの決まらない枠で二重にかかり、
  // 中身より枠が高くなって下に空白が出るので、px で決める）
  // 広げた形で下へ引いている間は、枠でなくカードの高さを縮める
  const openness = offset === null || expand.expanded ? null : foldOpenness(from, offset, reach.range, reach.shown)
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
  // 模型の欄も、ドラッグの間は指に合わせた開き具合で、高さを変える（CSS の .showcaseModel）
  const showcaseStyle =
    openness === null
      ? undefined
      : ({
          '--fold-open': openness,
          transition: returning ? `min-height ${SHEET_RETURN_MS}ms ease-out` : 'none',
        } as CSSProperties)
  const onFoldTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && returning) onReturned()
  }
  return (
    <SideCards
      prev={prev && goPrev && { name: pinDisplayName(prev), go: goPrev }}
      next={next && goNext && { name: pinDisplayName(next), go: goNext }}
      // はじめての時の合図は、地図でピンを押して開いたときだけ（スワイプで移ってきたときは出さない）
      hintable={!enter}
    >
      <section
        ref={(element) => {
          cardRef.current = element
          expand.ref(element)
        }}
        style={cardStyle}
        // 広げている間は、下の欄の高さの上限を外す（TripMapPage.module.css）
        data-sheet-expanded={expanding || undefined}
        className={`${styles.card} ${showcase ? styles.showcase : ''} ${enter === 'next' ? styles.fromRight : enter === 'prev' ? styles.fromLeft : ''}`}
        aria-label={translate(`${pinDisplayName(pin)}の説明`, `About ${pinDisplayName(pin)}`)}
        {...swipe}
      >
        {/* 上の部分。上下にドラッグすると閉じる・開く（ブラウザのスクロールに取られないよう、ここだけ touch-action: none） */}
        <div className={styles.top} {...gripProps}>
        <button
          type="button"
          className={styles.grip}
          aria-label={collapsed ? translate(`${pinDisplayName(pin)}の説明を開く`, `Open details for ${pinDisplayName(pin)}`) : translate(`${pinDisplayName(pin)}の説明を閉じる`, `Close details for ${pinDisplayName(pin)}`)}
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
          {!showcase && <div className={styles.tile}><CategoryIcon category={pin.category} size={40} /></div>}
          <div className={styles.title}>
            <p className={styles.chips}>
              <span className={styles.category}>{CATEGORY_LABELS[pin.category] ?? CATEGORY_LABELS.town}</span>
              {showCount && (
                <span className={styles.count} aria-label={translate(`候補 ${total} 件中 ${index} 件目`, `Suggestion ${index} of ${total}`)}>
                  {index} / {total}
                </span>
              )}
            </p>
            <h2 className={styles.name}>{pinDisplayName(pin)}</h2>
            {pinDisplayArea(pin) && (
              <p className={styles.area}>
                <Icon name="pin" size={16} />
                {pinDisplayArea(pin)}
              </p>
            )}
            {/* 時刻が決まったイベントの開催の日時と出典（#581）。しおりでは、この時刻に固定される */}
            {pin.event && (
              <p className={styles.area}>
                <Icon name="calendar" size={16} />
                {translate('開催 ', 'Event: ')}{eventTimeLabel(pin.event)}
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
            {pinDisplayDescription(pin) && <p className={styles.description}>{pinDisplayDescription(pin)}</p>}
            {pin.event && <p className={styles.note}>{translate('出典：', 'Source: ')}{pin.event.source}</p>}

            {wishText && (
              <p className={styles.wish}>
                {wisher && <Avatar member={wisher} size={26} />}
                <span className={styles.wishText}>
                  <span className={styles.srOnly}>{wisher ? translate(`${wisher.displayName}の希望：`, `${wisher.displayName}'s wish: `) : translate('希望：', "Wish:")}</span>{translate(`「${wishText}」`, `“${wishText}”`)}
                </span>
              </p>
            )}

            {state && <p className={styles.state}>{state}</p>}

            {/*
              誰が出した候補か（見本か Gemini か）と、Google マップ（Places）で場所を確かめたか。建てるかを選ぶ候補のカードだけで出す。
              建った建物のカード（模型を右に出す形）では出さない（かめの判断、2026-11-19）
            */}
            {!showcase && <p className={styles.note}>{pinOriginNote(geminiName(pin.suggestedBy), Boolean(pin.placeId))}</p>}

            {action && <div className={styles.actions}>{action}</div>}

            {extra}

            {!showcase && footer}
          </div>
        </div>

        {/* 建った建物の模型。右側に正方形で出す（閉じると、名前の行の高さに縮む） */}
        {showcase && (
          <div className={styles.showcaseModel} style={showcaseStyle}>
            {showcase}
          </div>
        )}

        {/* 模型を右に出すときは、一番下の操作を、模型の下に横いっぱいで置く。閉じている間は隠す */}
        {showcase && footer && (
          <div className={styles.below} hidden={collapsed}>
            {footer}
          </div>
        )}
      </section>
    </SideCards>
  )
}
