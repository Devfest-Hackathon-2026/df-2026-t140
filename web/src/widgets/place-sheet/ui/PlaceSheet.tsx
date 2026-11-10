import { type AnimationEvent, type CSSProperties, type ReactNode, type TransitionEvent, useRef, useState } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { CATEGORY_LABELS, CategoryIcon, type Pin } from '@/entities/pin'
import { shortDurationLabel } from '@/entities/route'
import { type Neighbor, type SheetEntrance, useNeighborSwipe, useSheetDrag, useSheetMotion } from '@/shared/lib'
import { Icon, SideCards, sheetDragFullStyle, sheetDragPeekStyle, sheetGripClass, sheetMotionClass, sheetPeekGripClass } from '@/shared/ui'
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
  /** しおりの時刻（HH:MM）。集合場所で、しおりに出発の行がないときは null */
  time: string | null
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
  /** 左上の「しおり」。しおり（S11）に戻る */
  onBack: () => void
  /** 上の部分だけのときに、そこを押した（か、上へドラッグした）。場所の情報（S12）に戻る */
  onExpand: () => void
  /** 取っ手を下へドラッグした（か、押した）。上の部分だけを残して下げる */
  onCollapse: () => void
  /** 表示中の場所から旅を再生する。再生できる場所がないときは渡さない */
  onPlay?: () => void
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
export function PlaceSheet({ spot, time, note, credit, extra, photo, peek, onBack, onExpand, onCollapse, onPlay, prev, next, entrance = 'open' }: Props) {
  const { phase, onAnimationEnd, peekRef, peekVisible } = useSheetMotion(peek, entrance)
  // 取っ手（閉じた形ではシート全体）をつかんで、上下にドラッグして開け閉めする
  // 開いた形の高さ。ふつうは画面の半分ほどまで（地図が見える。中は縦にスクロール）。取っ手を上へ引くと大きく、
  // 大きいときに下へ引くとふつうに戻り、ふつうのときに下へ引くと上の部分だけになる（#204。口コミで地図が隠れるため）
  const [tall, setTall] = useState(false)
  // 開いた形のシート。中身がふつうの高さで切れているときだけ、大きくする（切れていなければ大きくしても見た目が変わらず、
  // 次に下へ引いても閉じなくなるため）
  const sheetElement = useRef<HTMLElement | null>(null)
  const clipped = () => {
    const element = sheetElement.current
    return element !== null && element.scrollHeight > element.clientHeight + 1
  }
  const { offset, returning, launch, clearLaunch, onReturned: endReturn, fullRef, gripProps } = useSheetDrag(
    phase === 'peek' ? 'peek' : 'full',
    peekVisible,
    (to) => (to === 'peek' ? onCollapse() : onExpand()),
    tall ? { shrink: () => setTall(false) } : { grow: () => clipped() && setTall(true) },
  )
  const sheetRef = (element: HTMLElement | null) => {
    sheetElement.current = element
  }
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

  const name = spot.kind === 'place' ? spot.pin.name : spot.name
  const dotStyle = { '--dot-color': spot.kind === 'place' ? (spot.wisher?.color ?? 'var(--color-build)') : 'var(--color-text)' } as CSSProperties
  const back = (
    <button type="button" className={styles.back} onClick={onBack}>
      <Icon name="back" size={20} />
      しおり
    </button>
  )
  const playButton = onPlay ? (
    <button type="button" className={styles.play} aria-label="ここから再生" onClick={onPlay} onPointerDown={(event) => event.stopPropagation()}>
      <Icon name="play" size={26} />
    </button>
  ) : null
  // 集合場所は、しおりの集合場所の行と同じ、濃い色の丸に電車の印（建物は、希望した人の色の丸に場所の種類の絵）
  const title = (
    <>
      <span className={styles.dot} style={dotStyle} aria-hidden="true">
        {spot.kind === 'place' ? <CategoryIcon category={spot.pin.category} size={18} /> : <Icon name="train" size={18} />}
      </span>
      <h2 className={styles.name}>{name}</h2>
      {time && <time className={styles.time}>{time}</time>}
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
          <section className={`${styles.sheet} ${styles.peek}`} aria-label={`${name}（閉じています）`}>
            <span className={styles.handle} aria-hidden="true" />
            <div className={styles.head}>
              {back}
              {/* 「しおり」ボタンのほか、上の部分のどこを触っても場所の情報に戻る（企画書「ユーザー体験」3-3） */}
              <button type="button" className={styles.expand} aria-label={`${name}の情報を開く`} onClick={onExpand}>
                {title}
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
  const mapsUrl = spot.kind === 'origin' && !spot.located ? null : placeSearchUrl(name, spot.kind === 'place' ? spot.pin.area : null)
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
        ref={fullRef}
        className={`${styles.frame} ${offset === null ? sheetMotionClass(phase) : ''}`}
        style={sheetDragFullStyle(peekVisible, dragView)}
        onAnimationEnd={onSheetAnimationEnd}
        onTransitionEnd={onReturned}
      >
        {playButton}
        <section
          ref={sheetRef}
          className={`${styles.sheet} ${styles.swipeable} ${tall ? '' : styles.compact}`}
          aria-label={`${name}の情報`}
          {...swipe}
        >
          <span className={`${styles.handle} ${sheetGripClass}`} aria-hidden="true" {...gripProps} />
          <div className={styles.head}>
            {back}
            {title}
          </div>

          {spot.kind === 'place' ? (
            <p className={styles.chips}>
              <span className={styles.chip} role="img" aria-label={`しおりの ${spot.total} か所のうち ${spot.order} か所目`}>
                <Icon name="pin" size={16} />
                <span aria-hidden="true">
                  {spot.order} / {spot.total}
                </span>
              </span>
              <span className={styles.chip} role="img" aria-label={`いる時間の目安 ${spot.stayMinutes} 分`}>
                <Icon name="clock" size={16} />
                <span aria-hidden="true">{shortDurationLabel(spot.stayMinutes)}</span>
              </span>
              <span className={`${styles.chip} ${styles.category}`}>
                <CategoryIcon category={spot.pin.category} size={16} />
                {CATEGORY_LABELS[spot.pin.category] ?? CATEGORY_LABELS.town}
              </span>
              {spot.wishText && (
                <span className={`${styles.chip} ${styles.wish}`}>
                  {spot.wisher && <Avatar member={spot.wisher} size={20} />}
                  <span className={styles.srOnly}>{spot.wisher ? `${spot.wisher.displayName}の希望：` : '希望：'}</span>
                  <span className={styles.wishText}>{spot.wishText}</span>
                </span>
              )}
            </p>
          ) : (
            // 集合場所：建物ではないことが分かる札だけ（番号は付けない。建物の番号は、しおりと地図の番号のまま）
            <p className={styles.chips}>
              <span className={`${styles.chip} ${styles.origin}`}>
                <Icon name="train" size={16} />
                集合場所
              </span>
            </p>
          )}

          {photo}

          {spot.kind === 'place' && spot.pin.description && <p className={styles.description}>{spot.pin.description}</p>}
          {spot.kind === 'origin' && (
            <p className={styles.description}>
              旅の出発地です。ここに集まって、しおりの順に回ります。
              {/* スワイプの一言は、次の場所（しおりの 1 つ目）があるときだけ */}
              {next && '左へスワイプすると、1 つ目の場所へ進みます。'}
            </p>
          )}
          {spot.kind === 'origin' && !spot.located && <p className={styles.note}>この出発地は地図の上の位置が分からないため、地図には出していません。</p>}
          {note && <p className={styles.note}>{note}</p>}
          {credit?.text && (
            <blockquote className={styles.wiki} cite={credit.url}>
              <p className={styles.wikiText}>{credit.text}</p>
            </blockquote>
          )}
          {credit && (
            <p className={styles.note}>
              {credit.text ? '上の文は、' : '建物の見た目は、'}
              <a href={credit.url} target="_blank" rel="noreferrer">
                Wikipedia の記事
              </a>
              （
              <a href={credit.license} target="_blank" rel="noreferrer">
                CC BY-SA
              </a>
              {credit.text ? '）の冒頭です。建物の見た目も、この記事を参考に Gemini が作りました' : '）を参考に Gemini が作りました'}
            </p>
          )}
          {extra}

          {mapsUrl && (
            <a className={styles.maps} href={mapsUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={20} />
              Google マップ
            </a>
          )}
        </section>
      </div>
    </SideCards>
  )
}
