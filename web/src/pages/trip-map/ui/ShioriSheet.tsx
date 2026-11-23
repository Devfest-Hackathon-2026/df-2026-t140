import { type AnimationEvent, type CSSProperties, type TransitionEvent, useEffect, useLayoutEffect, useState } from 'react'
import type { Member } from '@/entities/member'
import type { ModelJson } from '@/entities/model3d'
import { pinDisplayName, type Pin } from '@/entities/pin'
import { defaultLegMode, legKey, legModeOf, type LodgingNight, type MealState, ORIGIN_KEY, pinOfStop, planeAllowed, previousLodging, type Route, SHIORI_ROUTE_ID, shownSlacks, walkAllowed } from '@/entities/route'
import { type ShioriBook, type Trip, tripOriginLocation, travelModeOf } from '@/entities/trip'
import type { Wish } from '@/entities/wish'
import { ShioriCost } from '@/features/shiori-cost'
import { LegMove } from '@/features/change-leg-mode'
import { SlackSlot, useFillers } from '@/features/fill-slack'
import { StopTime } from '@/features/edit-stop-time'
import { LodgingSlot, useSkipLodging } from '@/features/pick-lodging'
import { MealSlot, useSkipMeal } from '@/features/pick-meal'
import { ConfirmShioriButton } from '@/features/confirm-shiori'
import { RepeatVisitButtons } from '@/features/repeat-visit'
import { useReorderShiori } from '@/features/reorder-shiori'
import type { WithId } from '@/shared/api'
import { dateRangeLabel, nights, translate, useSheetDrag, useSheetExpand, useSheetMotion } from '@/shared/lib'
import { Button, Icon, sheetDragFullStyle, sheetDragPeekStyle, sheetGripClass, sheetGripZoneClass, sheetMotionClass, sheetPeekGripClass } from '@/shared/ui'
import { RouteTimeline } from '@/widgets/route-timeline'
import { RailSource, ShioriHead, ShioriMode } from '@/widgets/shiori-head'
import { HeaderBadge } from '@/widgets/trip-header'
import type { TallSheet } from '../model/useTallSheet'
import { shioriLegAirports } from '../model/legAirports'
import styles from './ShioriSheet.module.css'

interface Props {
  tripId: string
  trip: Trip
  route: WithId<Route> | null
  /** しおりに並ぶ場所（旅の順） */
  pins: WithId<Pin>[]
  members: WithId<Member>[]
  wishes: WithId<Wish>[]
  /** 場所の行を押した。渡るのは行の ID（ふつうはピンの ID。同じ場所の 2 回目からの行は「ピンの ID~番号」） */
  onSelectPlace: (stopId: string) => void
  /** 集合場所の行を押した（集合場所の情報を開き、そこから旅の順に場所を見ていける。#226） */
  onSelectOrigin: () => void
  /** 上の部分だけを残した状態。地図に触れるとこうなる */
  peek: boolean
  /** 上の部分だけのときに、そこを押した（か、上へドラッグした）。しおりを元の高さに戻す */
  onExpand: () => void
  /** 取っ手を下へドラッグした（か、押した）。上の部分だけを残して下げる */
  onCollapse: () => void
  /** 再生ボタンを押した（旅を映像で見る）。建った場所がないときは出さない */
  onPlay: () => void
  /** 書き出すしおりの中身（保存してある時刻のもの）。建った場所がなければ undefined */
  book: ShioriBook | undefined
  /** 行の時刻と移動時間が、Routes API（Google）の時間で計算し直したものか。全面（地図なし）のときに、出どころを出す */
  routesTimes: boolean
  /** 全面（画面いっぱいに広げた形。地図なしでしおりだけを見る。S14）との行き来の形と動き（model/useTallSheet） */
  tall: TallSheet
  /** 取っ手をさらに上へ引いた（か、「しおりだけを見る」を押した）。全面にする */
  onGrow: () => void
  /** 全面で「地図で見る」を押した。ふつうの高さに戻す */
  onShrink: () => void
  /** 泊まる夜ごとの宿の状態。宿がまだ決まっていない夜には、その日の最後に宿の枠を出す（企画書「ユーザー体験」3-7） */
  lodging: readonly LodgingNight[]
  /** 宿の枠の「宿を探す」を押した（すぐ探しはじめ、みんなの地図に戻る。そこに宿の候補のピンが立つ） */
  onFindLodging: (night: number) => void
  /** 宿さがしを頼んでいる途中（枠のボタンを押せなくする） */
  findingLodging: boolean
  /** 日ごとの朝・昼・晩ごはんの枠の状態。決まっていない枠は、その時間ごろの行のあいだに出す（企画書「ユーザー体験」3-7 の 8） */
  meals: readonly MealState[]
  /** ごはんの枠の「お店を探す」を押した（すぐ探しはじめ、みんなの地図に戻る。そこにお店の候補のピンが立つ） */
  onFindMeal: (slot: MealState) => void
  /** お店さがしを頼んでいる途中（枠のボタンを押せなくする） */
  findingMeal: boolean
  /** 旅程が確定しているか（features/confirm-shiori）。確定の前は全面にできない。確定しているあいだは、行程を直せない */
  confirmed: boolean
  /** 建った場所の模型（ピンの ID ごと）。行の丸に模型の絵を出す（試験的） */
  models?: Readonly<Record<string, ModelJson>>
  /** 自分が発案者か。確定・取り消しのボタンと、確定中の時刻の直しは発案者だけ */
  isOwner: boolean
  /** しおりの空いた時間への提案（まだ「無視」も建築もされていないもの）。その日のゆとりの下に、薄い字で出す（#520） */
  fillers: readonly WithId<Pin>[]
}

/**
 * しおり（S11）の下のシート。上の部分（日程とメンバーの数、書き出しのボタン、おもな移動の切り替え）と、建った場所の行。
 * 行を押すと、場所の情報（S12）になる。場所の行を長押しで取り、ほかの場所の行に落とすと、2 つの行く順番が入れ替わり、しおりが作り直される（3-6）。先頭の集合場所の行を押すと、集合場所の情報になる（そこから旅の順に見ていける）。シートの外側の左上の再生ボタンで、旅を映像で見られる（車が道順をたどって場所を回る）。
 * 地図に触れると、日程の行だけを残して下がる（場所の情報のシートが閉じるのと同じ動き）。そこを押すと元の高さに上がる。
 * 取っ手をさらに上へ引くと、指についてシートが伸び、離すと上の帯（ホームボタンと旅の名前）のすぐ下まで広がって止まる。
 * 広げた形で下へ引くと、元の高さに戻る（どの下のシートも同じ動き。shared/lib の useSheetExpand。Takana の依頼、2026-11-22）。
 * つかめるのは、取っ手から上の部分（日程と書き出しのボタン、おもな移動）まで。ボタンは、押しただけならそのまま押せる。
 * 以下の全面（画面いっぱい。地図なしでしおりだけを見る。S14）は、前の URL で開いたときだけ出る。
 * 全面では、シートの白が上の帯（旅の名前の帯）の裏を通って画面の一番上まで届き、地図は見えない。帯はそのまま残り、中身は帯のすぐ下から始まる。
 * 画面は移らず、同じシートが伸びるだけなので、読み込みは挟まらない。行の一番下の「しおりだけを見る」でも広がる（企画書「ユーザー体験」3-6）。
 * 全面のときは、取っ手を出さない（白い画面で、シートではなくなる。かめの決定、2026-11-20）。ふつうの高さへは、一番下の「地図で見る」か、左上の戻るボタンで戻る。
 * 再生ボタンは、帯に重ならないよう、上の部分の中に入る。
 * 行の時刻の欄（枠つき）を押すと、その時刻を直せる。行の丸と時刻は場所の情報を開かず、地名から右を押すと開く。
 * 泊まりの旅では、泊まる夜ごとに宿の枠が入る。宿が決まっていない夜の枠は点線で、「宿を探す」か、宿を取らない夜の過ごし方を「自分で書く」かを選べる（3-7）。
 * 旅程の確定（2026-11-21、#502）：一番下に発案者だけ「この旅で決まり！」を出す。旅の名前を決めるポップアップを挟んで確定すると、決まったしおり（S14。別の画面 /t/<旅>/final）が開く。
 * 確定したあとは、一番下の「決まったしおりを見る」で開く。確定しているあいだは、入れ替え、区間の手段、おもな移動を直せず、時刻は発案者だけが直せる。
 * 書き出しは、ここでは Google マップの道順だけ（PDF と Google カレンダーは、決まったしおりで出す）。全面（tall）の形は、もう開かない
 */
export function ShioriSheet({ tripId, trip, route: savedRoute, pins, members, wishes, onSelectPlace, onSelectOrigin, peek, onExpand, onCollapse, onPlay, book, routesTimes, tall, onGrow, onShrink, confirmed, isOwner, models, lodging, onFindLodging, findingLodging, meals, onFindMeal, findingMeal, fillers }: Props) {
  // 全面から戻す（前の URL で全面のまま開いたときだけ。全面にはもうしない）。動きの始まりの高さを測ってから、ページに伝える
  const shrink = () => {
    tall.prepareShrink()
    onShrink()
  }
  // 入れ替えを頼んだら、保存を待たずに 2 つの行を入れ替えて出す
  const { route, move } = useReorderShiori(tripId, savedRoute)
  // 宿の枠で宿を取らない夜にすることと、その取り消し
  const skipLodging = useSkipLodging(tripId, savedRoute?.id ?? SHIORI_ROUTE_ID)
  // ごはんの枠でお店を建てずに決めることと、その取り消し
  const skipMeal = useSkipMeal(tripId, savedRoute?.id ?? SHIORI_ROUTE_ID)
  // 宿がまだ決まっていない、いちばん早い夜。残っているあいだは確定できない
  const openLodging = lodging.find((night) => night.state === 'open')
  // 開いている宿の枠（まだ決まっていない夜は、ふだんは 1 行にたたんである。UI/UX レビューの S-1）。
  // 一番下の「＋ ○ 日目の宿を決める」からも開けるよう、ここで持つ（S-4）
  const [unfoldedNights, setUnfoldedNights] = useState<readonly number[]>([])
  const [scrollToNight, setScrollToNight] = useState<number | null>(null)
  const unfoldNight = (night: number) => setUnfoldedNights((nights) => (nights.includes(night) ? nights : [...nights, night]))
  // 宿が決まった夜（建てた、過ごし方を書いた）は、開いた覚えを消す。あとで空の枠に戻したときは、たたんだ形から始める
  const openNights = lodging.filter((night) => night.state === 'open').map((night) => night.night)
  const staleUnfolded = unfoldedNights.filter((night) => !openNights.includes(night))
  if (staleUnfolded.length > 0) setUnfoldedNights(unfoldedNights.filter((night) => openNights.includes(night)))
  // 一番下のボタンから開いた宿の枠を、しおりの見える所まで送る（開いて描き終えてから）
  useEffect(() => {
    if (scrollToNight === null) return
    document.querySelector(`[data-lodging-night="${scrollToNight}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setScrollToNight(null)
  }, [scrollToNight])
  // 空いた時間への提案を「入れる」「無視」する（#520）
  const fill = useFillers(tripId)
  // 日ごとの空いた時間（ゆとり）。短い空きは出さない
  const slacks = route ? shownSlacks(route, nights(trip.startDate, trip.endDate) + 1) : []
  // 全面のときは、閉じた形（上の部分だけ）にしない
  const { phase, onAnimationEnd, peekRef, peekVisible } = useSheetMotion(peek && !tall.shown, 'open')
  // 上へ引いて、上の帯のすぐ下まで広げた形（shared/lib の useSheetExpand）。閉じた形にしたら、広げていない形に戻す
  const expand = useSheetExpand('header')
  if (phase === 'peek' && expand.expanded) expand.reset()
  // 取っ手から上の部分まで（閉じた形ではシート全体）をつかんで、上下にドラッグして開け閉めする。
  // ふつうの高さでは、上へ引くと指についてシートが伸び、離すと上の帯のすぐ下まで広がる。全面のときは取っ手を出さないので、ドラッグはしない
  const { offset, returning, launch, clearLaunch, onReturned: endReturn, fullRef, gripProps } = useSheetDrag(
    phase === 'peek' ? 'peek' : 'full',
    peekVisible,
    (to) => (to === 'peek' ? onCollapse() : onExpand()),
    expand.steps,
    { measureGrow: expand.measureGrow },
  )
  const dragView = { offset, returning, launch }
  const expanding = expand.active(offset) && !tall.shown
  const onSheetAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    onAnimationEnd(event)
    tall.onAnimationEnd(event)
    if (event.target === event.currentTarget) clearLaunch()
  }
  // 開いた形のシートの要素を、ドラッグの部品と、広げる部品と、全面の動きの部品に渡す
  const sheetRef = (node: HTMLElement | null) => {
    fullRef(node)
    expand.ref(node)
    tall.sheetRef(node)
  }
  // 上へ引いて伸ばしている間と、広げている間は、下の欄の高さも伸びる。ページがその高さで地図を合わせ直さないよう、伸ばしている途中だと伝える。
  // 高さの変わった知らせ（ResizeObserver）より先に届くよう、描く前に伝える
  const { setStretching } = tall
  useLayoutEffect(() => setStretching(expanding), [expanding, setStretching])
  const motionClass = tall.move ? (tall.move.kind === 'rise' ? styles.rise : styles.lower) : offset === null ? sheetMotionClass(phase) : ''
  const sheetStyle: CSSProperties = tall.move
    ? ({
        '--peek-visible': `${peekVisible}px`,
        '--tall-from': `${tall.move.kind === 'rise' ? tall.move.px : 0}px`,
        '--tall-to': `${tall.move.kind === 'lower' ? tall.move.to : 0}px`,
        // 上の辺より上の白：上がるときは 0 から cover まで伸ばし、下がるときは cover から 0 まで縮める
        '--tall-cover-from': `${tall.move.kind === 'lower' ? tall.move.cover : 0}px`,
        '--tall-cover-to': `${tall.move.kind === 'rise' ? tall.move.cover : 0}px`,
      } as CSSProperties)
    : tall.shown
      ? sheetDragFullStyle(peekVisible, dragView)
      : { ...sheetDragFullStyle(peekVisible, dragView), ...expand.style(offset, returning) }
  const onReturned = (event: TransitionEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && returning) endReturn()
  }
  const dates = dateRangeLabel(trip.startDate, trip.endDate)
  const mode = travelModeOf(trip)
  const badges = (
    <>
      <HeaderBadge tone="route" icon="calendar" label={translate(`日程 ${dates}`, `Dates: ${dates}`)}>
        {dates}
      </HeaderBadge>
      <HeaderBadge tone="go" icon="people" label={translate(`メンバー ${members.length} 人`, `Members: ${members.length}`)}>
        {members.length}
      </HeaderBadge>
    </>
  )

  // 旅を映像で見る再生ボタン：シートの外側の左上に浮かべ、シートといっしょに動く（閉じた形でも、その左上の外に残る）。
  // 車が道順をたどって、場所を順に回る（企画書「ユーザー体験」3-5）。押してもシートのドラッグは始めない。
  // 全面と、上の帯の下まで広げた形のときは、外に浮かべると上の帯に重なるので、上の部分の中（書き出しのボタンの左）に小さく入れる
  const playInside = tall.shown || expand.expanded
  const playButton =
    pins.length > 0 ? (
      <button
        type="button"
        className={playInside ? `${styles.play} ${styles.playInside}` : styles.play}
        aria-label={translate('旅を再生する', 'Play trip')}
        // しおりの中の案内（ShioriGuide）が、この印で探して指す
        data-guide="shiori-play"
        onClick={onPlay}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Icon name="play" size={playInside ? 22 : 26} />
      </button>
    ) : null

  if (phase === 'peek' && !tall.shown) {
    return (
      <section
        ref={peekRef}
        className={`${styles.sheet} ${styles.peek} ${sheetPeekGripClass}`}
        style={sheetDragPeekStyle(peekVisible, dragView)}
        aria-label={translate('しおり（閉じています）', "Itinerary (collapsed)")}
        onTransitionEnd={onReturned}
        {...gripProps}
      >
        {playButton}
        <span className={styles.handle} aria-hidden="true" />
        {/* 上の部分のどこを押しても、しおりが元の高さに戻る */}
        <button type="button" className={styles.expand} aria-label={translate('しおりを開く', "Open itinerary")} onClick={onExpand}>
          <span className={styles.badges}>{badges}</span>
          <span className={styles.up} aria-hidden="true">
            <Icon name="up" size={20} />
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      ref={sheetRef}
      className={[styles.sheet, tall.shown && styles.tall, motionClass].filter(Boolean).join(' ')}
      style={sheetStyle}
      aria-label={translate('しおり', 'Itinerary')}
      data-guide="shiori-sheet"
      // 広げている間は、下の欄の高さの上限を外す（TripMapPage.module.css）
      data-sheet-expanded={expanding || undefined}
      onAnimationEnd={onSheetAnimationEnd}
      onTransitionEnd={onReturned}
    >
      {!playInside && playButton}
      {/* 取っ手から上の部分まで、どこをつかんでも上下にドラッグできる（全面のときはドラッグしない） */}
      <div className={tall.shown ? styles.zone : `${styles.zone} ${sheetGripZoneClass}`} {...(tall.shown ? {} : gripProps)}>
        <span className={`${styles.handle} ${sheetGripClass}`} aria-hidden="true" data-sheet-handle />
        {/* 日程とメンバーの数、書き出しのボタン。全面と広げた形のときは、再生ボタンもここに入る */}
        <ShioriHead tripId={tripId} badges={badges} book={book} action={playInside ? playButton : undefined} allExports={false} />
      </div>
      {/*
        全面のときは Google の地図が見えないので、Routes API の時間を出している間は、出どころ（Google Maps）を字で出す
        （Maps Platform の表示の決まり：Google の地図の上でない所に出すときは、ロゴか「Google Maps」の字を添える）。
        ふつうの高さに戻すと消えるので、戻したときの高さの見積もり（model/tallSheet）には数えない（data-sheet-tall-only）
      */}
      {tall.shown && routesTimes && (
        <p className={styles.attribution} data-sheet-tall-only>
          {translate('車の移動時間のデータ：', 'Driving time data: ')}
          <span className={styles.attributionName} translate="no">
            Google Maps
          </span>
        </p>
      )}

      {route && pins.length > 0 ? (
        <div className={styles.timeline} data-sheet-scroll>
          {/*
            確定しているあいだの案内と、おもな移動（電車・バス、車）の切り替え。行の欄の先頭に置き、
            行といっしょに上下に送る（上に残すと、行を見られる高さが狭くなる。Takana の依頼、2026-11-22）
          */}
          <div className={styles.lead}>
            {confirmed && (
              <p className={styles.confirmedNote} role="status">
                <Icon name="bookmark" size={18} />
                {isOwner ? translate('旅程を確定しています。時刻だけは直せます', "The itinerary is finalized. You can still edit times.") : translate('発案者が旅程を確定しています。取り消されるまで、見るだけです', "The organizer has finalized the itinerary. It is read-only until they reopen it.")}
              </p>
            )}
            {/* 駅と線路のデータの出典は、料金の目安の下へ移す（UI/UX レビューの S-6。#708）。移動の切り替えの位置（#668）は変えない */}
            <ShioriMode tripId={tripId} mode={mode} locked={confirmed} withSource={false} />
          </div>
          <RouteTimeline
            route={route}
            startDate={trip.startDate}
            pins={pins}
            members={members}
            wishes={wishes}
            onSelectStop={onSelectPlace}
            models={models}
            origin={trip.origin}
            onSelectOrigin={onSelectOrigin}
            // 確定しているあいだは、行を動かさない
            onMoveStop={confirmed ? undefined : move}
            // 時刻の欄を押すと、その時刻を直せる（集合時間、出発時間、場所に着く時刻）。確定しているあいだは、発案者だけ
            renderTime={!confirmed || isOwner ? (slot) => <StopTime tripId={tripId} routeId={route.id} slot={slot} /> : undefined}
            // 泊まる夜ごとの宿の枠。宿が決まっていない夜は点線で、近くの宿を探すか、決めないかを選べる
            lodging={lodging}
            renderLodging={(night) => (
              <LodgingSlot
                night={night}
                locked={confirmed}
                finding={findingLodging}
                saving={skipLodging.saving !== null}
                onFind={() => onFindLodging(night.night)}
                onSkip={(skip, note) => skipLodging.setSkip(night.night, skip, note)}
                previous={route ? previousLodging(lodging, route.schedule, night.night) : null}
                onSame={() => skipLodging.setSame(night.night)}
                unfolded={unfoldedNights.includes(night.night)}
                onUnfold={() => unfoldNight(night.night)}
              />
            )}
            // 日ごとの朝・昼・晩ごはんの枠。決まっていない枠は点線で、近くのお店を探すか、「なし」などで決められる。
            // 確定しているあいだは、決まっていない枠を出さない（枠が多く、押せるボタンもないため）
            meals={confirmed ? meals.filter((slot) => slot.state !== 'open') : meals}
            renderMeal={(slot) => (
              <MealSlot
                slot={slot}
                locked={confirmed}
                finding={findingMeal}
                saving={skipMeal.saving !== null}
                onFind={() => onFindMeal(slot)}
                onSkip={(skip, note) => skipMeal.setSkip(slot.key, skip, note)}
              />
            )}
            // その日の最後に出す、ゆとりの行と、空いた時間への提案の欄（#520）。提案は「入れる」で建てると、しおりに入る
            slacks={slacks}
            renderSlack={(slack) => (
              <SlackSlot
                slack={slack}
                fillers={fillers.filter((pin) => pin.filler?.day === slack.day)}
                busyId={fill.busyId}
                locked={confirmed}
                onInclude={(pin) => void fill.include(pin.id, pinDisplayName(pin))}
                onDismiss={(pin) => void fill.dismiss(pin.id)}
              />
            )}
            // 行の下の複製ボタン。押すと、すぐ下に同じ場所の行が増える。同じ場所の行が 2 つ以上あれば、その行を消すボタンも出る（#528）。
            // 確定しているあいだは出さない（行を増やせない、消せない）
            renderActions={
              confirmed
                ? undefined
                : ({ stopId, name, repeated }) => (
                    <RepeatVisitButtons key={stopId} tripId={tripId} routeId={route.id} stopId={stopId} name={name} repeated={repeated} />
                  )
            }
            // 飛行機の区間で乗り降りする空港の行（地図の線・再生と同じ決め。flightLegPath と同じ空港）
            airportsOf={shioriLegAirports(trip, route, pins, mode)}
            // 行のあいだの移動の行。押すと、この区間だけ手段を選び直せる（#433）
            renderMove={({ from, to, minutes }) => {
              const chosen = route.legModes?.[legKey(from, to)]
              const at = (id: string) => (id === ORIGIN_KEY ? tripOriginLocation(trip) : pins.find((pin) => pin.id === pinOfStop(id))?.location)
              // 選んでいない区間は、区間の既定（遠い区間と島への区間は飛行機、ほかは旅全体の手段）
              const fallback = defaultLegMode(at(from), at(to), mode)
              return (
                <LegMove
                  tripId={tripId}
                  routeId={route.id}
                  from={from}
                  to={to}
                  minutes={minutes}
                  // 旅の再生で走る乗り物も、同じ決め（legModeOf）で選ぶ
                  mode={legModeOf(route.legModes, from, to, at, mode)}
                  chosen={Boolean(chosen)}
                  tripMode={fallback}
                  walkable={walkAllowed(at(from), at(to))}
                  planeable={planeAllowed(at(from), at(to))}
                  flight={route.legFlights?.[legKey(from, to)]}
                  locked={confirmed}
                />
              )
            }}
          />
          <ShioriCost trip={trip} route={route} pins={pins} memberCount={members.length} />
          <RailSource mode={mode} className={styles.railSource} />
          {/*
            全面にする・戻す。全面にするのは、取っ手を上へ引いてもできる（引く操作に気づかない人と、キーボードで使う人のため）。
            確定の前は全面にできないので、代わりに、発案者には確定のボタン、ほかの人には確定でしおりができることを出す
          */}
          {tall.shown ? (
            <>
              <Button variant="soft" block className={styles.final} onClick={() => shrink()}>
                <Icon name="map" />
                {translate('地図で見る', 'View on the map')}
              </Button>
            </>
          ) : confirmed ? (
            <Button variant="soft" block className={styles.final} onClick={onGrow}>
              <Icon name="bookmark" />
              {translate('決まったしおりを見る', "View final itinerary")}
            </Button>
          ) : isOwner ? (
            <ConfirmShioriButton tripId={tripId} onConfirmed={onGrow} blocked={openLodging ? translate(
              `${openLodging.night} 日目の宿が決まっていません。宿を建てるか、過ごし方を書くと、確定できます`,
              `Choose lodging or write an overnight plan for night ${openLodging.night} before finalizing.`,
            ) : null} blockedAction={openLodging ? (
              // 確定できない理由の下に、その夜の宿の枠を開きに行くボタン（UI/UX レビューの S-4。#708）
              <Button
                variant="dashed"
                block
                className={styles.blockedAction}
                onClick={() => {
                  unfoldNight(openLodging.night)
                  setScrollToNight(openLodging.night)
                }}
              >
                <Icon name="plus" />
                {translate(`${openLodging.night} 日目の宿を決める`, `Choose lodging for night ${openLodging.night}`)}
              </Button>
            ) : null} />
          ) : (
            <p className={styles.confirmHint}>{translate('発案者が旅程を確定すると、しおりができます。', "The itinerary is available after the organizer finalizes it.")}</p>
          )}
        </div>
      ) : (
        <>
          <ShioriMode tripId={tripId} mode={mode} locked={confirmed} />
          <p className={styles.empty}>
            {translate('まだ建った場所がありません。やりたいことを書いて、気になった場所で「建築する！」を押すと、ここに旅の順で並びます。', "No places have been built yet. Search for something to do, then select Build on a place to add it to the itinerary.")}
          </p>
        </>
      )}
    </section>
  )
}
