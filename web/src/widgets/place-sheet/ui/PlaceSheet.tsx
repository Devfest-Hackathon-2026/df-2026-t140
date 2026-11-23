import { type AnimationEvent, type CSSProperties, type ReactNode, type TransitionEvent } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { pinDisplayName, pinDisplayDescription, CATEGORY_LABELS, CategoryIcon, type Pin } from '@/entities/pin'
import { shortDurationLabel, STOP_TIME_TAGS, type StopTimeSlot } from '@/entities/route'
import { originDisplayName } from '@/entities/trip'
import { translate, type Neighbor, type SheetEntrance, useNeighborSwipe, useSheetDrag, useSheetExpand, useSheetMotion } from '@/shared/lib'
import { Icon, SideCards, sheetDragFullStyle, sheetDragPeekStyle, sheetGripClass, sheetGripZoneClass, sheetMotionClass, sheetPeekGripClass } from '@/shared/ui'
import { placeSearchUrl } from '../model/place'
import styles from './PlaceSheet.module.css'

/**
 * シートに出す地点。しおりの建物（place）か、集合場所（origin。#226）。
 * 集合場所は建物ではないので、番号・いる時間・場所の種類・希望は出さない
 */
export type PlaceSpot =
  | {
      kind: 'place'
      pin: Pin
      /** しおりで何番目か（1 から）と、場所の数（集合場所は数えない。地図の建物の番号と同じ） */
      order: number
      total: number
      /** いる時間（分） */
      stayMinutes: number
      /** 泊まる夜の宿に決まった建物か（いる時間の代わりに「宿泊」と出す） */
      lodging?: boolean
      /** 希望を書いた人。抜けた人なら undefined */
      wisher: Pick<Member, 'displayName' | 'color'> | undefined
      /** もとになった希望の文 */
      wishText: string | null
    }
  | {
      kind: 'origin'
      /** 出発地（集合場所）の名前 */
      name: string
      /** 地図の上の位置が分かるか。分からなければ、地図に印を出していないことを書く */
      located: boolean
    }

interface Props {
  spot: PlaceSpot
  /**
   * 右上に出す、しおりの時刻（entities/route の stopTimeSlots）。集合場所は集合時間と出発時間の 2 つ、建物は着く時刻の 1 つ。
   * 集合場所で、しおりに出発の行がないときは空
   */
  times: readonly StopTimeSlot[]
  /**
   * 時刻の欄（押して直せる時刻。features/edit-stop-time）。しおりのルートがあるときに、ページが渡す。
   * 閉じた状態（S13）では、上の部分全体が開くボタンなので、渡しても時刻は文字のまま
   */
  renderTime?: (slot: StopTimeSlot) => ReactNode
  /** 模型や候補についての断り書き（「用意した部品の模型です」など） */
  note?: string
  /** 断り書きの下に差し込む中身（Google マップの口コミなど）。ページが組み立てて渡す */
  extra?: ReactNode
  /** 印の並びの下に差し込む写真（Google マップの写真 1 枚）。出せないときは何も描かない部品をページが渡す */
  photo?: ReactNode
  /** 模型の見た目の参考にした説明の出典（Wikipedia の記事と CC BY-SA）。あれば断り書きの下に出す（ライセンスの表示） */
  credit?: { text: string; url: string; license: string }
  /** 上の部分だけを残した状態（S13）。地図を動かすとこうなる */
  peek: boolean
  /** 左上の「<」。しおり（S11）に戻る */
  onBack: () => void
  /** 上の部分だけのときに、そこを押した（か、上へドラッグした）。場所の情報（S12）に戻る */
  onExpand: () => void
  /** 取っ手を下へドラッグした（か、押した）。上の部分だけを残して下げる */
  onCollapse: () => void
  /** 表示中の場所から旅を再生する。再生できる場所がないときは渡さない */
  onPlay?: () => void
  /** 再生ボタンの読み上げ名。既定は「ここから再生」。一時停止した場所では、ページが「続きから再生」を渡す */
  playLabel?: string
  /**
   * しおりの前の場所・次の場所。端なら渡さない。
   * シートを左右にスワイプするか、シートの左右にのぞく、となりのカードを押すと go を呼ぶ
   */
  prev?: Neighbor
  next?: Neighbor
  /** シートが出てきた理由。前後の場所へ移ったときは 'switch'（小さく動くだけ）。既定は 'open'（下から上がる） */
  entrance?: SheetEntrance
}

/**
 * 場所の情報（S12）と、シートを閉じた状態（S13）。しおりで場所を押すと、下のシートがこれになる。
 * 場所の種類は、印の並びに小さく出す（前の大きな絵は場所を取りすぎたのでやめた、#200）。
 * 写真は、ページが渡す photo（口コミと同じ条件で出す Google マップの写真 1 枚）だけ。
 * Google マップのボタンは、場所の名前で Google マップを開くだけ（Maps の内容は取ってこない）。
 * シートを右から左へスワイプすると次の場所、左から右へスワイプすると前の場所（ボタンやリンクの上から始めた動きは数えない）。
 * 場所カード（S05）と同じく、左右にとなりのカードがのぞき、押しても移る（shared/ui の SideCards）。
 * しおりから開いたときは、シートが上がったあと、のぞくカードが後ろから左右へ出てくる。
 */
export function PlaceSheet({ spot, times, renderTime, note, credit, extra, photo, peek, onBack, onExpand, onCollapse, onPlay, playLabel = translate('ここから再生', "Play from here"), prev, next, entrance = 'open' }: Props) {
  const { phase, onAnimationEnd, peekRef, peekVisible } = useSheetMotion(peek, entrance)
  // 取っ手から名前の行まで（閉じた形ではシート全体）をつかんで、上下にドラッグして開け閉めする
  // 開いた形の高さ。ふつうは画面の半分ほどまで（地図が見える。中は縦にスクロール）。取っ手を上へ引くと上の帯のすぐ下まで広がり、
  // 広げたときに下へ引くとふつうに戻り、ふつうのときに下へ引くと上の部分だけになる（#204。口コミで地図が隠れるため）。
  // 広げる動きは、しおりのシートと同じ（shared/lib の useSheetExpand。Takana の依頼、2026-11-22）
  const expand = useSheetExpand('header')
  if (phase === 'peek' && expand.expanded) expand.reset()
  const { offset, returning, launch, clearLaunch, onReturned: endReturn, fullRef, gripProps } = useSheetDrag(
    phase === 'peek' ? 'peek' : 'full',
    peekVisible,
    (to) => (to === 'peek' ? onCollapse() : onExpand()),
    expand.steps,
    { measureGrow: expand.measureGrow },
  )
  const frameRef = (element: HTMLElement | null) => {
    fullRef(element)
    expand.ref(element)
  }
  const expanding = expand.active(offset)
  const dragView = { offset, returning, launch }
  const onSheetAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    onAnimationEnd(event)
    if (event.target === event.currentTarget) clearLaunch()
  }
  const onReturned = (event: TransitionEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && returning) endReturn()
  }
  // 左右のスワイプか、のぞくカードを押して、しおりの前後の場所へ
  const { goPrev, goNext, swipe } = useNeighborSwipe(prev, next)

  const name = spot.kind === 'place' ? pinDisplayName(spot.pin) : originDisplayName(spot.name)
  const dotStyle = { '--dot-color': 'var(--color-text)' } as CSSProperties
  // 左上の戻るボタンは「<」だけにし、場所の名前を広く出す（Takana の依頼、2026-11-20）
  const back = (
    <button type="button" className={styles.back} aria-label={translate('しおりに戻る', "Back to itinerary")} onClick={onBack}>
      <Icon name="back" size={20} />
    </button>
  )
  // 広げた形では、外に浮かべると上の帯に重なるので出さない（ふつうの高さに戻すと出る）
  const playButton = onPlay && !expand.expanded ? (
    <button type="button" className={styles.play} aria-label={playLabel} onClick={onPlay} onPointerDown={(event) => event.stopPropagation()}>
      <Icon name="play" size={26} />
    </button>
  ) : null
  // 右上の時刻。集合場所は「集合」「出発」の札つきで 2 段。editable なら押して直せる欄（しおりの行と同じ）
  const timeSlots = (editable: boolean) =>
    times.length > 0 && (
      // 集合場所の 2 つの時刻は、名前が詰まらないよう、名前の下の行に右寄せで横に並べる
      <span className={times.length > 1 ? `${styles.times} ${styles.timesRow}` : styles.times}>
        {times.map((slot) => (
          <span key={slot.key} className={styles.slot}>
            {STOP_TIME_TAGS[slot.kind] && <span className={styles.tag}>{STOP_TIME_TAGS[slot.kind]}</span>}
            {editable && renderTime ? renderTime(slot) : <time className={styles.time}>{slot.time}</time>}
          </span>
        ))}
      </span>
    )
  // 集合場所は、しおりの集合場所の行と同じ、濃い色の丸に電車の印。
  // 建物は丸を出さない（場所の種類は下の印の並びにある。名前を左から始めて、長い名前も出す。Takana の依頼、2026-11-20）
  const title = (editable: boolean) => (
    <>
      {spot.kind === 'origin' && (
        <span className={styles.dot} style={dotStyle} aria-hidden="true">
          <Icon name="train" size={18} />
        </span>
      )}
      <h2 className={styles.name}>{name}</h2>
      {timeSlots(editable)}
    </>
  )

  if (phase === 'peek') {
    // 閉じた状態（S13）では、となりのカードはのぞかせない
    return (
      <SideCards>
        <div
          ref={peekRef}
          className={`${styles.frame} ${sheetPeekGripClass}`}
          style={sheetDragPeekStyle(peekVisible, dragView)}
          onTransitionEnd={onReturned}
          {...gripProps}
        >
          {playButton}
          <section className={`${styles.sheet} ${styles.peek}`} aria-label={translate(`${name}（閉じています）`, `${name} (collapsed)`)}>
            <span className={styles.handle} aria-hidden="true" />
            <div className={styles.head}>
              {back}
              {/* 「<」ボタンのほか、上の部分のどこを触っても場所の情報に戻る（企画書「ユーザー体験」3-3） */}
              <button type="button" className={styles.expand} aria-label={translate(`${name}の情報を開く`, `Open details for ${name}`)} onClick={onExpand}>
                {title(false)}
                <span className={styles.up} aria-hidden="true">
                  <Icon name="up" size={20} />
                </span>
              </button>
            </div>
          </section>
        </div>
      </SideCards>
    )
  }

  // 位置が分からない出発地（「自宅」など）は、名前で探しても意味がないので、Google マップのボタンを出さない
  const mapsUrl = spot.kind === 'origin'
    ? (spot.located ? placeSearchUrl(spot.name, null) : null)
    : placeSearchUrl(spot.pin.name, spot.pin.area)
  return (
    <SideCards
      prev={prev && goPrev && { name: prev.name, go: goPrev }}
      next={next && goNext && { name: next.name, go: goNext }}
      // しおりから開いたとき・閉じた状態から開いたときは、のぞくカードが後ろから出てくる。前後へ移ったときは出たまま
      appear={phase === 'open' || phase === 'expand'}
      // 指で動かしている間と閉じる途中は、シートだけが動くので隠す
      hideSides={offset !== null || phase === 'closing'}
      // はじめての時の合図は、しおりから開いたときだけ
      hintable={entrance === 'open'}
    >
      <div
        ref={frameRef}
        className={`${styles.frame} ${offset === null ? sheetMotionClass(phase) : ''}`}
        style={{ ...sheetDragFullStyle(peekVisible, dragView), ...expand.style(offset, returning) }}
        // 広げている間は、下の欄の高さの上限を外す（TripMapPage.module.css）
        data-sheet-expanded={expanding || undefined}
        onAnimationEnd={onSheetAnimationEnd}
        onTransitionEnd={onReturned}
      >
        {playButton}
        <section
          className={`${styles.sheet} ${styles.swipeable} ${expanding ? '' : styles.compact}`}
          aria-label={translate(`${name}の情報`, `About ${name}`)}
          {...swipe}
        >
          {/* 取っ手から名前の行まで、どこをつかんでも上下にドラッグできる。中を送っても、上に残る */}
          <div className={`${styles.zone} ${sheetGripZoneClass}`} {...gripProps}>
            <span className={`${styles.handle} ${sheetGripClass}`} aria-hidden="true" data-sheet-handle />
            <div className={styles.head}>
              {back}
              {title(true)}
            </div>
          </div>

          {spot.kind === 'place' ? (
            <p className={styles.chips}>
              <span className={styles.chip} role="img" aria-label={translate(`しおりの ${spot.total} か所のうち ${spot.order} か所目`, `Stop ${spot.order} of ${spot.total}`)}>
                <Icon name="pin" size={16} />
                <span aria-hidden="true">
                  {spot.order} / {spot.total}
                </span>
              </span>
              {spot.lodging ? (
                // 宿は、翌朝までいる。時間の長さは出さず「宿泊」と出す
                <span className={styles.chip}>
                  <Icon name="clock" size={16} />
                  {translate('宿泊', 'Overnight stay')}
                </span>
              ) : (
                <span className={styles.chip} role="img" aria-label={translate(`いる時間の目安 ${spot.stayMinutes} 分`, `Estimated stay: ${spot.stayMinutes} minutes`)}>
                  <Icon name="clock" size={16} />
                  <span aria-hidden="true">{shortDurationLabel(spot.stayMinutes)}</span>
                </span>
              )}
              <span className={`${styles.chip} ${styles.category}`}>
                <CategoryIcon category={spot.pin.category} size={16} />
                {CATEGORY_LABELS[spot.pin.category] ?? CATEGORY_LABELS.town}
              </span>
              {spot.wishText && (
                <span className={`${styles.chip} ${styles.wish}`}>
                  {spot.wisher && <Avatar member={spot.wisher} size={20} />}
                  <span className={styles.srOnly}>{spot.wisher ? translate(`${spot.wisher.displayName}の希望：`, `${spot.wisher.displayName}'s wish: `) : translate('希望：', "Wish:")}</span>
                  <span className={styles.wishText}>{spot.wishText}</span>
                </span>
              )}
            </p>
          ) : (
            // 集合場所：建物ではないことが分かる札だけ（番号は付けない。建物の番号は、しおりと地図の番号のまま）
            <p className={styles.chips}>
              <span className={`${styles.chip} ${styles.origin}`}>
                <Icon name="train" size={16} />
                {translate('集合場所', "Meeting point")}
              </span>
            </p>
          )}

          {photo}

          {spot.kind === 'place' && pinDisplayDescription(spot.pin) && <p className={styles.description}>{pinDisplayDescription(spot.pin)}</p>}
          {spot.kind === 'origin' && (
            <p className={styles.description}>
              {translate('旅の出発地です。ここに集まって、しおりの順に回ります。', 'Meet here to start the trip, then follow the itinerary. ')}
              {/* スワイプの一言は、次の場所（しおりの 1 つ目）があるときだけ */}
              {next && translate('左へスワイプすると、1 つ目の場所へ進みます。', "Swipe left to see the first stop.")}
            </p>
          )}
          {spot.kind === 'origin' && !spot.located && <p className={styles.note}>{translate('この出発地は地図の上の位置が分からないため、地図には出していません。', "The meeting point is hidden because its location is unknown.")}</p>}
          {note && <p className={styles.note}>{note}</p>}
          {credit?.text && (
            <blockquote className={styles.wiki} cite={credit.url}>
              <p className={styles.wikiText}>{credit.text}</p>
            </blockquote>
          )}
          {credit && (
            <p className={styles.note}>
              {credit.text ? translate('上の文は、', 'The text above is from this ') : translate('建物の見た目は、', 'Gemini used this ')}
              <a href={credit.url} target="_blank" rel="noreferrer">
                {translate('Wikipedia の記事', "Wikipedia article")}
              </a>
              {translate('（', ' (')}
              <a href={credit.license} target="_blank" rel="noreferrer">
                CC BY-SA
              </a>
              {credit.text ? translate('）の冒頭です。建物の見た目も、この記事を参考に Gemini が作りました', '). Gemini also used the article to design this building.') : translate('）を参考に Gemini が作りました', ') to design this building.')}
            </p>
          )}
          {extra}

          {mapsUrl && (
            <a className={styles.maps} href={mapsUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={20} />
              {translate('Google マップ', "Google Maps")}
            </a>
          )}
        </section>
      </div>
    </SideCards>
  )
}
