import { BUILD_LIMIT_PER_TRIP, pinDisplayName } from '@/entities/pin'
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { flushSync } from 'react-dom'
import { Avatar, ownerUidOf } from '@/entities/member'
import { type StopTimeSlot, stopTimeSlots } from '@/entities/route'
import { ModelTurntable } from '@/entities/model3d'
import { areaDisplayName, isConfirmed, originDisplayName } from '@/entities/trip'
import { WishBar } from '@/features/add-wish'
import { BuildButton } from '@/features/build-model'
import { RemoveBuildingButton } from '@/features/remove-building'
import { RestorePlaceButton } from '@/features/restore-place'
import { EditOriginForm } from '@/features/edit-origin'
import { StopTime } from '@/features/edit-stop-time'
import { LodgingHint, useFindLodging, useLodgingHint } from '@/features/pick-lodging'
import { useFindMeal } from '@/features/pick-meal'
import { playSound, type SheetEntrance, timeAgo, translate, useElementHeight } from '@/shared/lib'
import { Button, ButtonLink, Icon, Loading, Screen } from '@/shared/ui'
import { InviteSheet } from '@/widgets/invite-sheet'
import { PlaceCard } from '@/widgets/place-card'
import { PlaceSheet } from '@/widgets/place-sheet'
import { HeaderBadge, TripHeader } from '@/widgets/trip-header'
import { type MapFocus, type MapOrigin, type MapTour, TripMap } from '@/widgets/trip-map'
import { LodgingLinks, PlacePhoto, PlaceReviews, PlaceSnapshot, reviewsAsk } from '@/features/place-reviews'
import { builtState } from '../model/builtState'
import { tourEndView, tripMapView } from '../model/mapView'
import { placeNote, placeReviewsAsk } from '../model/shiori'
import { ORIGIN_SPOT, spotNeighbors, spotOrder } from '../model/spots'
import { FIELD_COACH_SEEN_KEY, useBandCoach } from '../model/useBandCoach'
import { useBuildCoach } from '../model/useBuildCoach'
import { useShioriOpened } from '../model/useShioriOpened'
import { useShioriCoach } from '../model/useShioriCoach'
import { useShioriGuide } from '../model/useShioriGuide'
import { tourVehicleOf } from '../model/tour'
import { useShioriTour } from '../model/useShioriTour'
import { usePageZoomLock } from '../model/usePageZoomLock'
import { useTallSheet } from '../model/useTallSheet'
import { useTripMap } from '../model/useTripMap'
import { ShioriCoachMark } from './ShioriCoachMark'
import { ShioriGuide } from './ShioriGuide'
import { ShioriSheet } from './ShioriSheet'
import { TourSpeedButton } from './TourSpeedButton'
import styles from './TripMapPage.module.css'

/** 旅を作った直後に、招待のシートを出すまでの間（ms）。着いた旅の地図を見せる */
const ARRIVE_MS = 1200

/** しおりのシートの外側に浮かぶ再生ボタンの高さと、シートとのすきま（px。ShioriSheet.module.css の .play） */
const PLAY_BUTTON_SPACE = 56 + 12 + 8

/**
 * みんなの地図（S02、S04、S05、S07）と、同じ地図の上のしおり（S11、S12、S13）。
 * 地図の上に、上の帯と下の操作欄が重なる。上の帯は、左上が戻るボタン（場所カードのときだけ。ふだんは何も置かず、旅の名前の帯を左へ伸ばす）、右上がホームボタン。
 * まん中の旅の名前の帯には、メンバーの顔が並ぶ。招待のシート（旅の設定）は、どの状態でも帯を押して開く
 * （#231。設定のマークは付けない。Youkin06 の決定、2026-11-22）。
 *
 * みんなの地図（ふだん）。下の操作欄は場面で切り替わる：
 *   ふだん（S04）        やりたいことを書く欄
 *   ピンを選んだ（S05）  場所カード。候補なら「建築する！」。押すと裏で建築が始まり、すぐ書く欄に戻る
 *   招待（S02）          友達を招待するシート。旅を作った直後に出す。上の旅の名前の帯からいつでも開ける
 * 建物が建つと、上の帯の下の行に「○○が建った・たった今」が出て、地図のその場所に青い輪郭線つきで建ち、しおりに入る（S07）。
 * 画面はふさがない。その旅のしおりに初めて場所が入ったときだけ、ルートボタンを指す案内を出す（ShioriCoachMark）。
 *
 * しおり（URL に ?view=shiori）。左上のしおりボタンで開き、同じ場所の戻るボタンで、やりたいことを書く画面に戻る。
 *   しおり（S11）          建った場所が旅の順に並び、地図に道順が出る
 *   場所の情報（S12）      行か地図の建物を押すと、その建物にズームし、シートが場所の情報になる（&place=ピンの ID）。
 *                          寄り具合は、まわりの建物の混み具合で地図が決める（#224）。先頭の集合場所の行を押すと、
 *                          集合場所の情報になる（&place=@origin。#226）。左右のスワイプで、集合場所 → しおりの順の建物と回る
 *   シートを閉じた状態（S13）場所の情報を見ているときに地図を動かすと、シートの上の部分だけが残る
 *   しおりでも、地図を動かすか何もない所を押すと、シートが日程の行だけ残して下がる。そこを押すと元に戻る
 *   全面のしおり（S14）    しおりのシートの取っ手をさらに上へ引くと、シートが上の帯のすぐ下まで広がる（&book=1）。
 *                          地図なしで、しおりだけを見る。画面は移らず、地図は裏に置いたまま。ホームの「しおり」からは、この形で直接開く
 *   旅の再生              しおりの再生ボタンで、車が道順をたどって場所を順に回る。下の欄は出さず、着いたら「パシャ」と鳴らして
 *                         その場所の写真を大きく出す。戻るボタン、地図に触れると止まる。最後まで行ったら、しおりに戻る。
 *                         左下の一時停止ボタンを押すと、車をその場に残して、着いている（か、向かっている）場所の情報（S12）に移る。
 *                         そこの再生ボタンで続きから走る。再生中は、一時停止のとなりの速さのボタンで ×1 → ×2 → ×4 と切り替える
 * 地図は 1 つのまま切り替えるので、しおりを開いても地図を読み込み直さない。
 *
 * 地図だけ（URL に ?view=map。確定した旅だけ）。決まったしおり（S14）の「地図で見る」で開く。旅程は決まったしおりで見ているので、
 * しおりのシートも上の帯も出さず、左上の戻るボタン（決まったしおりへ）と左下の再生ボタンだけを置く。地図の場所を押しても場所の情報は出さない。
 * 再生は、しおりの再生と同じ（着いたら写真を出す）。一時停止は、場所の情報へ移らず、その場で止めて左下を「続きから再生」にする
 * （Lazyturtle0852 の依頼、2026-11-22）。確定していない旅で開いたときは、地図のしおりへ送る。
 *
 * 旅程の確定（2026-11-21、#502）：発案者がしおりの一番下で確定すると、全面のしおり（S14）が開く。全面のしおりは、確定したあとだけ開ける。
 * 確定しているあいだは、地図は見るだけ（やりたいことの欄の代わりに確定中の案内、場所カードに建てる・消すのボタンを出さない、集合場所を変えられない）。
 */
export function TripMapPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  // ページ全体を指 2 本で拡大させない（拡大・縮小は地図だけが受け取る）
  usePageZoomLock()
  // 地図だけの画面（?view=map）も、しおりと同じ道順・再生を使うので、しおりを開いている扱いにする
  const map = useTripMap(tripId, { shioriOpen: params.get('view') === 'shiori' || params.get('view') === 'map' })
  const justCreated = Boolean((location.state as { invite?: boolean } | null)?.invite)
  // 招待のシート。'create' は旅を作った直後（「次へ：計画をはじめる」を出す）、
  // 'open' は上の旅の名前の帯から開いたとき（みんなの地図でも、しおりでも。#231）
  const [inviting, setInviting] = useState<'create' | 'open' | false>(false)
  // 旅を作った直後は、まず旅の地図（選んだ場所へ寄ってきた地図の続き）を見せてから、少し置いて招待のシートを出す
  const [arriving] = useState(justCreated)
  useEffect(() => {
    if (!arriving) return
    const timer = setTimeout(() => setInviting((now) => now || 'create'), ARRIVE_MS)
    return () => clearTimeout(timer)
  }, [arriving])
  // 下のシート（しおり、場所の情報）を、上の部分だけ残して下げているか。地図に触れると下がる
  const [peek, setPeek] = useState(false)
  // しおりを開いてから、地図に触れたか（指で動かした、何もない所を押した）。触れたあとは、
  // しおりのシートが下がる・上がるなどで高さが変わっても、地図を合わせ直さない
  const [mapTouched, setMapTouched] = useState(false)
  // 場所の情報のシートが出てきた理由（前後の場所へ移ったときは小さく動くだけ。それ以外は下から上がる）
  const [entrance, setEntrance] = useState<SheetEntrance>('open')
  // 場所カードをスワイプして前後の候補を選んだときの向き（カードが入ってくる向き）。地図でピンを押したときは null
  const [cardEnter, setCardEnter] = useState<'next' | 'prev' | null>(null)
  const [topRef, topHeight] = useElementHeight()
  const [bottomRef, bottomHeight] = useElementHeight()

  // 「作った直後」の目印は、一度使ったら消す。残っていると、読み込み直すたびに招待のシートがまた開く
  useEffect(() => {
    if (justCreated) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [justCreated, navigate, location.pathname, location.search])

  // 出す画面（model/mapView.ts）。地図だけの画面（?view=map）は確定した旅だけ（確定していなければ、下で地図のしおりへ送る）
  const view = tripMapView(params.get('view'), isConfirmed(map.trip), !map.loading)
  const mapOnly = view.screen === 'map-only'
  const shiori = view.screen !== 'map'
  const placeId = shiori && !mapOnly ? params.get('place') : null
  // URL の place は行の ID（ふつうはピンの ID。同じ場所の 2 回目からの行は「ピンの ID~番号」。#528）
  const placeIndex = placeId ? map.shioriStops.findIndex((item) => item.id === placeId) : -1
  const place = placeIndex >= 0 ? map.shioriStops[placeIndex] : null
  // 集合場所の情報を見ているか（#226）。集合場所は建物ではないので、建物の数・番号・旅程には入れない
  const origin = map.shioriOrigin
  // 場所の情報の右上の時刻を、しおりの行と同じく押して直せるようにする
  const stopRouteId = map.shioriRoute?.id
  const renderStopTime =
    stopRouteId ? (slot: StopTimeSlot) => <StopTime tripId={tripId} routeId={stopRouteId} slot={slot} /> : undefined
  const atOrigin = placeId === ORIGIN_SPOT && origin !== null
  // 場所の情報（S12）の写真と口コミを何で聞くか（model/shiori.ts の placeReviewsAsk）
  const placeAsk = place ? placeReviewsAsk(place.pin.placeId) : null
  // 場所の情報で、左右にのぞかせる前・次。並びは、集合場所 → しおりの順の建物（端なら null。一周しない）
  const spotIds = spotOrder(map.shioriStops.map((item) => item.id))
  const around = placeId && (place || atOrigin) ? spotNeighbors(spotIds, placeId) : null
  const spotName = (id: string) => {
    if (id === ORIGIN_SPOT) return originDisplayName(origin?.name ?? '')
    const pin = map.shioriStops.find((item) => item.id === id)?.pin
    return pin ? pinDisplayName(pin) : ''
  }

  // 画面（地図、しおり、場所の情報）が変わったら、下げたシートと「地図に触れた」を戻す。
  // ボタンで移るときも、端末の戻る・進む操作（URL だけが変わる）でも、ここで戻す
  const screen = mapOnly ? 'map-only' : shiori ? `shiori-${placeId ?? ''}` : 'map'
  const [shownScreen, setShownScreen] = useState(screen)
  if (shownScreen !== screen) {
    setShownScreen(screen)
    setPeek(false)
    setMapTouched(false)
    // メンバーと招待のシートも閉じる（開いたまま別の画面へ移ったとき。シートを閉じると、移った先の画面に戻る）
    setInviting(false)
  }

  // 履歴：画面を切り替えるたびに 1 つ積む（地図 → しおり → 場所の情報 → しおり → 地図）。端末の戻る操作で、
  // 見てきた画面を順に戻れる。history.back() は使わない（複数人シミュレーションの iframe では、ほかの画面の履歴まで戻すため）
  const openShiori = () => {
    playSound('open')
    map.selectPin(null)
    map.markShioriSeen()
    setInviting(false)
    setParams({ view: 'shiori' })
  }
  // 確定しているあいだ、地図の下の「しおりを見る」：決まったしおり（S14。別の画面）を開く
  const openBook = () => {
    playSound('open')
    map.selectPin(null)
    navigate(`/t/${tripId}/final`)
  }
  // 全面のしおり（前の S14）：しおりのシートを、上の帯のすぐ下まで広げた形（URL に &book=1）だった。
  // 2026-11-21 から全面にはしない（決まったしおりは別の画面。#502）。前の URL（&book=1）で開いたときは、決まったしおりへ送る
  const confirmed = isConfirmed(map.trip)
  const isOwner = ownerUidOf(map.members) === map.myUid
  // 全面のしおりはやめ、決まったしおりは別の画面（/t/<旅>/final）にした（2026-11-21、#502）。前の URL（&book=1）は、そこへ送る
  const book = false
  const bookUrl = params.get('book') === '1'
  useEffect(() => {
    if (bookUrl) navigate(`/t/${tripId}/final`, { replace: true })
  }, [bookUrl, navigate, tripId])
  // 地図だけの画面は、確定した旅だけ。読み込んだら確定していなかった（取り消された）ときは、地図のしおりへ送る
  const redirectTo = view.redirect
  useEffect(() => {
    if (redirectTo) setParams({ view: redirectTo }, { replace: true })
  }, [redirectTo, setParams])
  // 地図だけの画面の戻るボタン：決まったしおり（S14）へ戻る
  const backToBook = () => {
    playSound('close')
    navigate(`/t/${tripId}/final`)
  }
  const tallSheet = useTallSheet(book)
  // 全面で直接開いたときは、シートを下げるまで地図を立ち上げない（旅行中にしおりだけを見る人に、地図を読み込ませない）。
  // 一度立ち上げたら、全面に戻しても裏に置いたままにする（下げたときに読み込み直さない）
  const [mapMounted, setMapMounted] = useState(!book)
  if (!mapMounted && !book) setMapMounted(true)
  const shioriParams = (place?: string) => ({ view: 'shiori', ...(place ? { place } : {}) })
  const closeShiori = () => {
    playSound('close')
    setParams({})
  }
  // シートを全面にする・ふつうの高さに戻す。履歴に 1 つ積むので、端末の戻る操作でも戻れる
  // 確定したあとの「決まったしおりを見る」と、確定した直後：決まったしおり（S14。別の画面）を開く
  const growSheet = () => {
    playSound('open')
    navigate(`/t/${tripId}/final`)
  }
  const shrinkSheet = () => {
    playSound('close')
    setParams({ view: 'shiori' })
  }
  const openPlace = (pinId: string, how: SheetEntrance = 'open') => { // pinId は行の ID（集合場所は ORIGIN_SPOT）
    if (pinId !== placeId && how === 'open') playSound('select')
    setPeek(false)
    setEntrance(how)
    // 場所の情報から別の建物を押したときは、積まずに置き換える
    setParams(shioriParams(pinId), { replace: Boolean(placeId) })
  }
  // 下げたシートと「地図に触れた」は、画面が変わったときに上で戻す
  const backToShiori = () => { playSound('close'); setParams(shioriParams()) }
  // 地図に触れた：しおりでも場所の情報でも、シートを上の部分だけ残して下げる。地図はそのまま（合わせ直さない）
  const lowerSheet = () => {
    if (!peek) playSound('close')
    setMapTouched(true)
    setPeek(true)
  }
  // 取っ手を下へドラッグした（か、押した）：シートを下げる。地図には触れていないので mapTouched は立てない
  // （しおりでは、シートが下がって広くなった地図に、建った場所が全部見えるよう合わせ直す）
  const collapseSheet = () => { if (!peek) playSound('close'); setPeek(true) }
  const expandSheet = () => { if (peek) playSound('open'); setPeek(false) }

  // しおりを見ている間に入った場所は、もう見たことにする
  const { shioriHasNew, markShioriSeen } = map
  useEffect(() => {
    if (shiori && shioriHasNew) markShioriSeen()
  }, [shiori, shioriHasNew, markShioriSeen])

  // 宿さがし（企画書「ユーザー体験」2-5、3-7）。しおりの宿の枠か、検索欄の上の知らせの「宿を探す」を押すと、すぐその夜の宿を探す希望を書く。
  // 探している間は、上の帯の下の行に「1 日目の宿を探し中です」と出る。候補のピンが立つと、みんなの地図がその候補へ動く（useTripMap）
  const { pins: mapPins, shioriRoute: lodgingRoute } = map
  const findLodging = useFindLodging({
    tripId,
    schedule: lodgingRoute?.schedule ?? [],
    stayIds: map.shioriStayIds,
    locationOf: (pinId) => mapPins.find((pin) => pin.id === pinId)?.location,
    getBounds: map.getBounds,
  })
  const lodgingBusy = findLodging.finding || map.lodgingSearching
  // ごはんのお店さがし（企画書「ユーザー体験」3-7 の 8）。しおりのごはんの枠の「お店を探す」を押すと、すぐその枠のお店を探す希望を書く
  const findMeal = useFindMeal({
    tripId,
    schedule: lodgingRoute?.schedule ?? [],
    stayIds: map.shioriStayIds,
    locationOf: (pinId) => mapPins.find((pin) => pin.id === pinId)?.location,
    getBounds: map.getBounds,
  })
  // 検索欄の上の知らせ：しおりに場所があり、宿の決まっていない夜があるとき、いちばん早い夜の 1 つだけ（× で閉じた夜は出さない）。
  // 最初の建築の直後は出さず、その旅のしおりを一度開いたあとに出す（UI/UX レビューの M-4。#708）
  const shioriOpened = useShioriOpened(tripId, Boolean(shiori) && map.shioriStops.length > 0)
  const lodgingHint = useLodgingHint(
    tripId,
    map.shioriStops.length > 0 && shioriOpened ? map.shioriLodging.flatMap((night) => (night.state === 'open' ? [night.night] : [])) : [],
  )

  // しおりの入口の案内（ShioriCoachMark）。その旅のしおりに初めて場所が入ったとき、ルートボタンが見えていれば出す
  const routeSlot = useRef<HTMLSpanElement>(null)
  const hasStops = map.shioriStops.length > 0
  // 旅の設定の入口の案内（ShioriCoachMark の band の形）。旅を作った直後の招待のシートを閉じたとき、またはしおりから戻ったときに、旅の名前の帯を指す。
  // しおりの入口の案内とは同時に出さない（こちらを先にする）
  const band = useRef<HTMLDivElement>(null)
  const bandCoach = useBandCoach(!map.loading && !shiori && !inviting && map.selection === null)
  // しおりを見てみんなの地図に戻ってきたときも、帯を指して「もっと招待するときはここから」と案内する
  // （リンクで参加した人にも届くように。Lazyturtle0852 の依頼、2026-11-22）。端末で一度だけ
  // ただし、しおりの「宿を探す」「お店を探す」で地図に移ったときは出さない（探しはじめた候補を見る邪魔になる）。
  // 済んだことにはせず、次に左上の戻るボタンで地図に戻ったときに出す（UI/UX レビューの M-5。#708）
  const armBandCoach = bandCoach.arm
  const wasShiori = useRef(shiori)
  const leftShioriToFind = useRef(false)
  useEffect(() => {
    if (wasShiori.current && !shiori) {
      if (leftShioriToFind.current) leftShioriToFind.current = false
      else armBandCoach()
    }
    wasShiori.current = shiori
  }, [shiori, armBandCoach])
  // 「建築する！」の案内（ShioriCoachMark の button の形）。候補のピンを初めて選び、押せる建築ボタンの入った場所カードが出たときに、
  // ボタンを指して「この場所に行きたければ建築しよう！」と出す。端末で一度だけ（Takana の依頼、2026-11-22）
  const buildSlot = useRef<HTMLDivElement>(null)
  const buildable =
    map.selection !== null &&
    !confirmed &&
    (map.selection.pin.status === 'candidate' || map.selection.pin.status === 'failed') &&
    map.counts.buildings < BUILD_LIMIT_PER_TRIP
  const buildCoach = useBuildCoach(!map.loading && !shiori && !inviting && buildable)
  // 旅を作った直後の 2 段目の案内（UI/UX レビューの M-1。#708）。帯の案内が済んだあとに、下のやりたいことの欄を指す。端末で一度だけ。
  // 帯の案内を前に済ませた端末では、招待のシートを閉じたらすぐ出す
  const wishSlot = useRef<HTMLDivElement>(null)
  // 明るく残すのは、欄と探すボタンの行（例のボタンの行は含めない）
  const wishField = useMemo(() => ({ get current() { return wishSlot.current?.querySelector<HTMLElement>('[data-guide="wish-field"]') ?? wishSlot.current } }), [])
  const fieldCoach = useBandCoach(!map.loading && !shiori && !inviting && map.selection === null && bandCoach.seen && !bandCoach.show, FIELD_COACH_SEEN_KEY)
  const coach = useShioriCoach(tripId, hasStops, !map.loading && !shiori && !inviting && map.selection === null && !bandCoach.show && !fieldCoach.show)
  // しおりを開いた（ルートボタンでも、戻る・進む操作でも）ら、案内は済んだことにする
  const coachDone = coach.done
  useEffect(() => {
    if (shiori && hasStops) coachDone()
  }, [shiori, hasStops, coachDone])

  // しおりで地図を合わせるときの、下のシートの高さ。地図に触れたあとは止める。
  // そうしないと、シートが下がる・上がるたびに地図が全体へ戻り、指で動かしている地図と取り合う
  const [fitHeight, setFitHeight] = useState(bottomHeight)
  // 全面のとき（シートが地図を覆っている）と、全面へ向けて指で伸ばしている間も止める。ふつうの高さに戻したときに、元の見え方のままにする
  if (!mapTouched && !tallSheet.shown && !tallSheet.stretching && fitHeight !== bottomHeight) setFitHeight(bottomHeight)

  // 旅の再生（しおりの再生ボタン）。止まったら（最後まで行った、やめた）、しおりに戻って全体を見せ直す
  const [toursDone, setToursDone] = useState(0)
  const tourStops = useMemo(() => map.shioriStops.map((item) => item.pin.location), [map.shioriStops])
  const finishTour = () => {
    // 地図だけの画面では、地図だけのまま（しおりのシートは出さない）
    setParams(tourEndView(view.screen) === 'map' ? { view: 'map' } : shioriParams(), { replace: true })
    setPeek(false)
    setMapTouched(false)
    setToursDone((count) => count + 1)
  }
  const tour = useShioriTour(tourStops, map.shioriLegs, map.shioriOriginLeg, map.shioriLegModes, finishTour)
  const stopTour = () => {
    playSound('close')
    tour.stop()
    finishTour()
  }
  // ホームから全面で直接開いたときは、地図をまだ立ち上げていない。そこで再生を押したら、先に地図を出し、
  // 地図が見えている範囲を知らせてくる（動かせるようになった）のを待ってから再生を始める。待たないと、読み込みの間に再生の最初が過ぎる
  const [mapSeen, setMapSeen] = useState(false)
  const [playPending, setPlayPending] = useState(false)
  if (playPending && !shiori) setPlayPending(false)
  const { onViewChange: reportMapView } = map
  const { play: playTour } = tour
  const onShioriMapView = useCallback(
    (...view: Parameters<typeof reportMapView>) => {
      reportMapView(...view)
      setMapSeen(true)
      if (playPending) {
        setPlayPending(false)
        playTour()
      }
    },
    [reportMapView, playPending, playTour],
  )
  // 再生が続いているか（一時停止も含む）。touring は、そのうち流れているあいだだけ（一時停止のあいだは、場所の情報の画面）
  const tourLive = shiori && tour.playing && tour.now !== null
  const touring = tourLive && !tour.paused
  // しおりの再生ボタン。全面のときは、先にふつうの高さに戻す（再生は地図で見るもの）。地図がまだ出ていなければ、出るのを待って始める
  const playShiori = () => {
    if (book) setParams({ view: 'shiori' }, { replace: true })
    if (mapSeen) tour.play()
    else setPlayPending(true)
  }
  // しおりの中の案内（ShioriGuide）。場所の入ったしおりの画面を初めて開き、一覧のシートがふつうの高さで見えているときに出す
  // （入口の案内から開いても、とばしたあとで自分で開いても。旅ごとに一度）
  const guide = useShioriGuide(
    tripId,
    shiori && !mapOnly,
    shiori && !mapOnly && hasStops && !place && !atOrigin && !tourLive && !inviting && !peek && !book && !tallSheet.shown,
  )
  // 一時停止している場所（着いている、か、向かっている場所）
  // 行の ID（同じ場所を何度も訪れるしおりでは、何回目の行かまで見分ける）
  const pausedPinId = tourLive && tour.paused ? (map.shioriStops[tour.now!.index]?.id ?? null) : null
  // 一時停止：車をその場に残して、その場所の情報に移る。地図は、傾きを戻しながらその場所へ寄る（TripMap の tour.hold）
  const pausedPlaceSeen = useRef(false)
  const pauseTour = () => {
    const pinId = tour.now ? map.shioriStops[tour.now.index]?.id : undefined
    if (!pinId) return
    // 地図だけの画面では、場所の情報へ移らず、その場で止める（左下が「続きから再生」になる）
    if (mapOnly) {
      tour.pause()
      return
    }
    pausedPlaceSeen.current = false
    tour.pause()
    setPeek(false)
    setEntrance('open')
    setParams(shioriParams(pinId), { replace: Boolean(placeId) })
  }
  // 集合場所から 1 つ目の場所までの線も出す（再生の前から。出発地からの道が分かるように。Takana の依頼、2026-11-22）
  const { shioriLines, shioriOriginLeg } = map
  const mapLines = useMemo(
    () => (shioriOriginLeg ? [{ id: 'tour-origin', points: [...shioriOriginLeg.points] }, ...shioriLines] : shioriLines),
    [shioriOriginLeg, shioriLines],
  )
  // 再生中に地図（建物、集合場所の印も）を押した：移動を飛ばして、次に着く所へ一瞬で移る（Takana の依頼、2026-11-22）。
  // 地図を指で動かしたときは、今までどおり止める（onUserMove）
  const skipTour = tour.skip
  // 着いた場所の写真を押したときも飛ばす（写真は押した指を受け止め、地図まで届かないため）。撮った人のリンクを押したときは飛ばさない
  const skipFromPhoto = (event: ReactMouseEvent) => {
    if (event.target instanceof Element && event.target.closest('a')) return
    skipTour()
  }
  const tourStop = touring ? map.shioriStops[tour.now!.index] : null
  const tourPaused = tour.paused
  const mapTour = useMemo<MapTour | null>(() => {
    const now = tour.now
    if (!shiori || !now) return null
    // 寄り具合は、地図が区間の長さから決める（建物と建物のあいだが、画面の縦の長さの半分より長く見えるように）
    // 走る乗り物は、その区間の手段で変える（着いて止まっているあいだは、入ってきた区間の乗り物）。
    // 空港を経由する飛行機の区間は、空港で区切った道ごとに手段がある（空港の前後は地上の乗り物、空港どうしは飛行機）
    return { leg: now.leg, progress: now.progress, hold: tourPaused, vehicle: tourVehicleOf(now.leg.mode) }
  }, [shiori, tour.now, tourPaused])
  // しおりから離れたら止める（戻るボタン、端末の戻る操作）
  const { stop: haltTour, playing: tourPlaying } = tour
  useEffect(() => {
    if (!shiori && tourPlaying) haltTour()
  }, [shiori, tourPlaying, haltTour])
  // 一時停止した場所の情報から、ほかの画面（しおり、ほかの場所）へ移ったら、続きは捨てる（次の再生は、その画面のボタンから始まる）。
  // 一時停止の直後は、URL がまだその場所になっていないことがあるので、一度その場所になってから見る
  // 一時停止した場所がしおりからなくなったとき（ほかの人が建物を消した）も捨てる（車と線を地図に残さない）
  const pausedPlaceGone = tourLive && tour.paused && !pausedPinId
  useEffect(() => {
    if (pausedPlaceGone) haltTour()
    if (!pausedPinId) return
    if (placeId === pausedPinId) pausedPlaceSeen.current = true
    else if (pausedPlaceSeen.current) haltTour()
  }, [pausedPlaceGone, pausedPinId, placeId, haltTour])

  // しおりの地図の動き：場所の情報ではその場所を真ん中に（寄り具合は、まわりの建物の混み具合で地図が決める。#224）、
  // しおりでは建った場所が全部見えるように。集合場所の位置が分からないときは、地図を動かさない（#226）
  const shioriPinIds = map.shioriPins.map((pin) => pin.id).join('.')
  const placePinId = place?.pin.id
  const spotKey = place ? place.id : atOrigin ? ORIGIN_SPOT : null
  const spotPoint = place ? place.pin.location : atOrigin ? origin?.location : null
  const spotLat = spotPoint?.lat
  const spotLng = spotPoint?.lng
  const shioriFocus = useMemo<MapFocus | null>(() => {
    if (!shiori || fitHeight === 0) return null
    if (spotKey) {
      return spotLat !== undefined && spotLng !== undefined ? { key: `place-${spotKey}`, spot: { lat: spotLat, lng: spotLng }, pinId: placePinId } : null
    }
    return shioriPinIds ? { key: `shiori-${shioriPinIds}-${fitHeight}-${toursDone}`, pinIds: shioriPinIds.split('.') } : null
  }, [shiori, spotKey, spotLat, spotLng, placePinId, shioriPinIds, fitHeight, toursDone])
  // しおりの地図に出す集合場所の印（位置が分かるときだけ）
  const originName = origin ? originDisplayName(origin.name) : undefined
  const originLat = origin?.location?.lat
  const originLng = origin?.location?.lng
  const originMark = useMemo<MapOrigin | null>(
    () =>
      originName && originLat !== undefined && originLng !== undefined
        ? { name: originName, location: { lat: originLat, lng: originLng }, selected: atOrigin }
        : null,
    [originName, originLat, originLng, atOrigin],
  )

  // 地図でピンを押した：カードは下から出る（横から入る動きは付けない）
  const selectFromMap = (pinId: string | null) => {
    if (pinId !== map.selectedPinId) {
      if (pinId) playSound('select')
      else if (map.selectedPinId) playSound('close')
    }
    setCardEnter(null)
    map.selectPin(pinId)
  }
  // 場所カードをスワイプして（か、左右にのぞくカードを押して）、前後の場所を選んだ。
  // 候補どうしなら地図はそのまま（立ったときに全部見えるよう合わせてある）。建物どうしなら、離れていることが多いので地図をその建物へ寄せる
  const swipeToNeighbor = (pinId: string, direction: 'next' | 'prev', building: boolean) => {
    setCardEnter(direction)
    map.selectPin(pinId)
    if (building) map.showPins([pinId])
  }

  if (map.loading) return <Loading />

  const { trip, members, selection, activity } = map
  if (!trip || !members) {
    return (
      <Screen>
        <p>{translate('この旅を読み込めませんでした。もう一度開くか、ホームから選び直してください。', "Couldn't open this trip. Try again or select it from your trips.")}</p>
        <ButtonLink to="/" block>
          {translate('ホームへ', "Your trips")}
        </ButtonLink>
      </Screen>
    )
  }


  // 再生中に下に出す札。飛行機の区間の途中の空港に止まっているあいだは、空港の名前と発着の時刻の札を出す（写真はないので撮った形にしない）。
  // 場所に着いたら、その場所の写真を撮った写真のように大きく出す（向かっているあいだに聞いておく）。
  // しおりの画面と地図だけの画面で同じものを使う（地図だけの画面に空港の分岐がなく、空港で次の場所の写真が出ていた。#693）
  const tourVia = touring ? tour.now!.via : null
  const tourCard = tourVia ? (
    <p className={styles.viaCard} role="status">
      <span className={styles.viaIcon}>
        <Icon name="plane" size={22} />
      </span>
      <span className={styles.viaText}>
        <span className={styles.snapshotTime}>{tourVia.time ? `${translate('空港', 'Airport')}・${tourVia.time}` : translate('空港', 'Airport')}</span>
        <span className={styles.snapshotName}>{tourVia.name}</span>
      </span>
    </p>
  ) : tourStop ? (
    <div className={styles.snapshot} onClick={skipFromPhoto}>
      <PlaceSnapshot
        key={tourStop.pin.id}
        tripId={tripId}
        pinId={tourStop.pin.id}
        ask={placeReviewsAsk(tourStop.pin.placeId)}
        name={pinDisplayName(tourStop.pin)}
        shown={tour.now!.phase === 'arrive'}
        caption={
          <>
            <span className={styles.snapshotTime}>
              {tour.now!.index + 1} / {map.shioriStops.length}・{tourStop.stop.time}
            </span>
            <span className={styles.snapshotName}>{pinDisplayName(tourStop.pin)}</span>
            {(tourStop.wisher || tourStop.wishText) && (
              <span className={styles.snapshotWish}>
                {tourStop.wisher && <Avatar member={tourStop.wisher} size={18} />}
                {tourStop.wishText && <span>{translate(`「${tourStop.wishText}」`, `“${tourStop.wishText}”`)}</span>}
              </span>
            )}
          </>
        }
      />
    </div>
  ) : null

  // 上の旅の名前の帯を押した：招待のシートを下に開く（#231）。旅の再生は止める
  const openMembers = () => {
    if (touring) stopTour()
    if (!inviting) playSound('open')
    setInviting((now) => now || 'open')
  }
  const inviteSheet = (
    <InviteSheet
      tripId={tripId}
      tripTitle={trip.title}
      startDate={trip.startDate}
      endDate={trip.endDate}
      isOwner={isOwner}
      confirmed={confirmed}
      joinCode={trip.joinCode}
      showNext={inviting === 'create'}
      onClose={() => {
        // 旅を作った直後のシート（共有のボタンと「次へ」）を閉じたら、あとから開く入口（旅の名前の帯）を案内する
        if (inviting === 'create') {
          bandCoach.arm()
          fieldCoach.arm()
        }
        setInviting(false)
      }}
    />
  )

  if (mapOnly) {
    // 地図だけの画面（?view=map）。上は戻るボタンだけ、下は再生ボタンだけ（再生中は、写真と一時停止・速さのボタン）
    return (
      <div className={styles.page} data-sheet-page>
        <TripMap
          regions={trip.regions}
          prefectures={trip.prefectures}
          pins={map.shioriPins}
          members={members}
          models={map.models}
          celebratingPinId={null}
          selectedPinId={null}
          // 場所を押しても場所の情報は出さない（旅程は決まったしおりで見ている）。再生中なら、次に着く所へ飛ばす
          onSelectPin={() => {
            if (touring) skipTour()
          }}
          onViewChange={onShioriMapView}
          focus={shioriFocus}
          topInset={topHeight}
          bottomInset={bottomHeight}
          lines={mapLines}
          orders={map.shioriOrders}
          buildingSize={110}
          origin={originMark}
          onSelectOrigin={() => {
            if (touring) skipTour()
          }}
          // 指で地図を動かしたら、再生を止める。止まっているときは、そのあと全体へ合わせ直さない
          onUserMove={touring ? stopTour : () => setMapTouched(true)}
          tour={mapTour}
        />

        <div className={styles.top} ref={topRef}>
          <div className={styles.mapOnlyTop}>
            <Button
              iconOnly
              aria-label={touring ? translate('再生をやめる', 'Stop playback') : translate('決まったしおりに戻る', 'Back to the final itinerary')}
              onClick={touring ? stopTour : backToBook}
            >
              <Icon name="back" />
            </Button>
            {/* 再生中・一時停止中だけ、何番目の場所かを出す */}
            {tourLive && (
              <p className={styles.shioriChip}>
                <Icon name={touring ? 'play' : 'pause'} size={18} />
                {touring ? translate('旅を再生中', 'Playing trip') : translate('一時停止中', 'Paused')} {tour.now!.index + 1} / {map.shioriStops.length}
              </p>
            )}
          </div>
        </div>

        <div className={styles.spacer} />

        <div className={styles.bottom} ref={bottomRef}>
          <div className={styles.tour}>
            {tourCard}
            {hasStops && (
              <div className={styles.tourControls}>
                {touring ? (
                  <button type="button" className={styles.tourPause} aria-label={translate('一時停止', 'Pause')} onClick={pauseTour}>
                    <Icon name="pause" size={26} />
                  </button>
                ) : (
                  // 止まっているときは再生、一時停止しているときは続きから
                  <button
                    type="button"
                    className={styles.tourPause}
                    aria-label={tourLive ? translate('続きから再生', 'Resume playback') : translate('旅を再生する', 'Play trip')}
                    onClick={tourLive ? tour.resume : playShiori}
                  >
                    <Icon name="play" size={26} />
                  </button>
                )}
                {tourLive && <TourSpeedButton speed={tour.speed} onCycle={tour.cycleSpeed} />}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (shiori) {
    const inPlace = Boolean(place) || atOrigin
    return (
      // しおりのときは、画面の縁に細い緑の枠を付ける（みんなの地図とは別の画面にいると分かるように）。
      // しおりの中の案内を出している間は、明るく残した再生ボタン（案内の中の丸）しか押せないように、後ろの画面を inert にする
      <div className={`${styles.page} ${styles.shioriFrame}`} data-sheet-page inert={guide.show}>
        {guide.show && (
          <ShioriGuide
            onMissing={guide.done}
            onSkip={guide.done}
            onPlay={() => {
              guide.done()
              playShiori()
            }}
          />
        )}
        {mapMounted && <TripMap
          regions={trip.regions}
          prefectures={trip.prefectures}
          pins={map.shioriPins}
          members={members}
          models={map.models}
          celebratingPinId={null}
          selectedPinId={place?.pin.id ?? null}
          // 建物を押すとその場所の情報。場所の情報を見ているときに地図のほかのところを押すと、しおりに戻る（みんなの地図で場所カードが閉じるのと同じ）。
          // しおりを見ているときに地図のほかのところを押すと、しおりのシートが下がる。
          // 再生中は、どこを押しても次に着く所へ飛ばす（場所の情報へは、一時停止で移る）
          onSelectPin={(pinId) => {
            if (touring) skipTour()
            else if (pinId) openPlace(pinId)
            else if (inPlace) backToShiori()
            else lowerSheet()
          }}
          onViewChange={onShioriMapView}
          focus={shioriFocus}
          topInset={topHeight}
          // 一覧でも場所の情報でも、シート外側の再生ボタンにGoogleのロゴが隠れないよう余白を取る
          // 全面のときは、シートが地図を覆う前の高さのままにする（裏の地図を、見えない範囲に合わせ直さない）
          bottomInset={(tallSheet.shown ? fitHeight : bottomHeight) + (!touring && !inviting && hasStops ? PLAY_BUTTON_SPACE : 0)}
          lines={mapLines}
          orders={map.shioriOrders}
          buildingSize={inPlace ? 140 : 110}
          // 集合場所の印（位置が分かるときだけ）。押すと集合場所の情報
          origin={originMark}
          onSelectOrigin={() => {
            if (touring) skipTour()
            else openPlace(ORIGIN_SPOT)
          }}
          // 再生中に地図を指で動かしたら、再生を止める
          onUserMove={touring ? stopTour : lowerSheet}
          // 飛行機の区間で乗り降りする空港。建物と同じく、しおりの場所として地図に印を出す
          airports={map.shioriAirports}
          tour={mapTour}
        />}

        {/* 全面のしおりは、白い面を上の帯の裏まで伸ばして地図を隠す。帯は、その手前に残す */}
        <div className={tallSheet.shown ? `${styles.top} ${styles.topOver}` : styles.top} ref={topRef}>
          <TripHeader
            title={trip.title}
            left={
              // 戻るボタンは、左の緑の枠から生えたタブの形（大きさと位置は、ふだんのボタンと同じ）
              <Button
                iconOnly
                className={styles.backTab}
                aria-label={touring ? translate('再生をやめる', "Stop playback") : book ? translate('地図のしおりに戻る', "Back to the itinerary on the map") : translate('やりたいことを書く画面に戻る', "Back to place search")}
                // 全面のときは、まずふつうの高さ（地図が見える形）に戻す
                onClick={touring ? stopTour : book ? () => { tallSheet.prepareShrink(); shrinkSheet() } : closeShiori}
              >
                <Icon name="back" />
              </Button>
            }
            // みんなの地図の左上のしおりボタンと同じ、帯の高さの正方形にする（開く・閉じるを同じ場所と大きさにし、帯の長さを変えない）
            leftSquare
            // 建物とピンの数は出さず、名前と顔を 1 段に並べる（Lazyturtle0852 の決定、2026-11-22）
            oneRow
            members={members}
            onOpenMembers={openMembers}
            membersOpen={Boolean(inviting)}
          />
          {/* いまの画面の名前（しおり）と、再生中の印。押せないので、押せるボタンの形（塗り・縁・影）にしない（#227） */}
          {touring ? (
            // 再生中は、何番目の場所かを出す。やめるのは左上の戻るボタン、一時停止は左下のボタン
            <p className={styles.shioriChip}>
              <Icon name="play" size={18} />
              {translate('旅を再生中', 'Playing trip')} {tour.now!.index + 1} / {map.shioriStops.length}
            </p>
          ) : pausedPinId ? (
            <p className={styles.shioriChip}>
              <Icon name="pause" size={18} />
              {translate('一時停止中', 'Paused')} {tour.now!.index + 1} / {map.shioriStops.length}
            </p>
          ) : tallSheet.shown ? null : (
            // 全面のときは出さない（シートが上の帯のすぐ下まで来る。シートに「しおり」の名前が付いている）
            <h2 className={styles.shioriChip}>
              <Icon name="bookmark" size={18} />
              {translate('しおり', "Itinerary")}
            </h2>
          )}
          {/* 手元（Emulator）の見本の曲線のとき。本物の道の形と見分けられるように（#218）。全面のときは地図が見えないので出さない */}
          {map.shioriLineSample && !tallSheet.shown && <p className={styles.sampleNote}>{translate('道の線は開発用の見本です（本番では道に沿います）', "Sample route for development. Production routes follow actual roads.")}</p>}
        </div>

        {!tallSheet.shown && <div className={styles.spacer} />}

        <div className={tallSheet.shown ? `${styles.bottom} ${styles.bottomTall}` : styles.bottom} ref={bottomRef}>
          {inviting ? (
            inviteSheet
          ) : tourCard ? (
            // 再生中は下の欄を出さない。着いたら、その場所の写真を撮った写真のように大きく出す（地図は、その上の残りで建物を映す）。
            // 向かっているあいだに写真を聞いておき、着いたら出す。聞くのは場所ごとに 1 回（口コミと同じメモリーを使い回す）。
            // その下の左に、一時停止と速さのボタンを置く（場所の情報の再生ボタンと同じ左下。止めても指の位置が変わらない）
            <div className={styles.tour}>
              {tourCard}
              <div className={styles.tourControls}>
                <button type="button" className={styles.tourPause} aria-label={translate('一時停止', "Pause")} onClick={pauseTour}>
                  <Icon name="pause" size={26} />
                </button>
                <TourSpeedButton speed={tour.speed} onCycle={tour.cycleSpeed} />
              </div>
            </div>
          ) : atOrigin && origin ? (
            // 集合場所の情報（#226）。建物ではないので、写真・口コミ・番号は出さない
            <PlaceSheet
              key={ORIGIN_SPOT}
              spot={{ kind: 'origin', name: origin.name, located: origin.location !== null }}
              // 確定しているあいだは、集合場所を変えられず、時刻は発案者だけが直せる
              extra={confirmed ? undefined : <EditOriginForm tripId={tripId} origin={origin.name} />}
              times={origin.times}
              renderTime={confirmed && !isOwner ? undefined : renderStopTime}
              peek={peek}
              onBack={backToShiori}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              onPlay={hasStops ? () => tour.play() : undefined}
              next={around?.next ? { name: spotName(around.next), go: () => openPlace(around.next!, 'switch') } : undefined}
              entrance={entrance}
            />
          ) : place ? (
            <PlaceSheet
              // 場所が変わるたびに作り直す（シートが動いて、変わったことが分かる）
              key={place.id}
              spot={{
                kind: 'place',
                pin: place.pin,
                order: placeIndex + 1,
                total: map.shioriStops.length,
                stayMinutes: place.stop.stayMinutes,
                lodging: (map.shioriStayIds as readonly string[]).includes(place.stop.stopId ?? place.pin.id),
                wisher: place.wisher,
                wishText: place.wishText,
              }}
              times={stopTimeSlots(place.stop)}
              // 時刻が決まったイベントの時刻は、開催の時刻から変えられない（#581）
              renderTime={(confirmed && !isOwner) || place.pin.event ? undefined : renderStopTime}
              note={placeNote(map.loadedModels[place.pin.id]?.source)}
              photo={<PlacePhoto tripId={tripId} pinId={place.pin.id} ask={placeAsk} name={pinDisplayName(place.pin)} active={!peek} />}
              extra={
                <>
                  {/* 宿の種類の場所には、公式サイトと Booking.com の検索へのリンクを出す（#705） */}
                  {place.pin.category === 'lodging' && <LodgingLinks tripId={tripId} pinId={place.pin.id} name={place.pin.name} area={place.pin.area} ask={placeAsk} active={!peek} />}
                  <PlaceReviews tripId={tripId} pinId={place.pin.id} ask={placeAsk} active={!peek} />
                </>
              }
              credit={map.loadedModels[place.pin.id]?.reference}
              peek={peek}
              onBack={backToShiori}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              // 一時停止した場所では、続きから（止めた所から）走る。ほかの場所では、その場所に着いた所から始める
              onPlay={place.id === pausedPinId ? tour.resume : () => tour.play(placeIndex)}
              playLabel={place.id === pausedPinId ? translate('続きから再生', 'Resume playback') : undefined}
              prev={around?.prev ? { name: spotName(around.prev), go: () => openPlace(around.prev!, 'switch') } : undefined}
              next={around?.next ? { name: spotName(around.next), go: () => openPlace(around.next!, 'switch') } : undefined}
              entrance={entrance}
            />
          ) : (
            <ShioriSheet
              tripId={tripId}
              trip={trip}
              route={map.shioriRoute}
              pins={map.shioriPins}
              members={members}
              wishes={map.wishes}
              onSelectPlace={openPlace}
              onSelectOrigin={() => openPlace(ORIGIN_SPOT)}
              peek={peek}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              // 全面のときは、先にふつうの高さに戻す（再生は地図で見るもの）。地図がまだ出ていなければ、出るのを待って始める
              onPlay={playShiori}
              book={map.shioriBook}
              routesTimes={map.shioriTimesFromRoutes}
              tall={tallSheet}
              onGrow={growSheet}
              onShrink={shrinkSheet}
              lodging={map.shioriLodging}
              // 「宿を探す」：すぐ探しはじめ、みんなの地図に戻る（そこに宿の候補のピンが立つ）
              onFindLodging={(night) => {
                leftShioriToFind.current = true
                setParams({})
                void findLodging.find(night)
              }}
              findingLodging={lodgingBusy}
              meals={map.shioriMeals}
              // 「お店を探す」：すぐ探しはじめ、みんなの地図に戻る（そこにお店の候補のピンが立つ）
              onFindMeal={(slot) => {
                leftShioriToFind.current = true
                setParams({})
                void findMeal.find(slot.day, slot.meal)
              }}
              findingMeal={findMeal.finding || map.mealSearching}
              confirmed={confirmed}
              isOwner={isOwner}
              models={map.models}
              fillers={map.shioriFillers}
            />
          )}
        </div>
      </div>
    )
  }

  const showingPin = selection && !inviting
  return (
    // 案内を出している間は、明るく残したルートボタン（案内の中の丸）しか押せないように、後ろの画面を inert にする
    // data-sheet-page：場所カードを上へ引いて広げるとき、上の端（上の帯のすぐ下）をこの中から探す（shared/lib の useSheetExpand）
    <div className={styles.page} data-sheet-page inert={coach.show || bandCoach.show || fieldCoach.show || buildCoach.show}>
      {buildCoach.show && (
        <ShioriCoachMark
          target={buildSlot}
          shape="button"
          label={translate('この場所に行きたければ\n建築しよう！', 'Want to go here?\nBuild it!')}
          // 案内を出しているあいだ、建築ボタンは押せない（後ろの画面は inert）。明るく残したボタンを押しても建築は始めず、
          // 案内を閉じるだけにする。建てるかは、案内が消えてから本物のボタンで決めてもらう（Takana の依頼、2026-11-23）
          onOpen={buildCoach.done}
          onSkip={buildCoach.done}
        />
      )}
      {bandCoach.show && (
        <ShioriCoachMark
          target={band}
          shape="band"
          label={translate('もっと招待するときはここから', 'Tap here to invite more people')}
          onOpen={() => {
            bandCoach.done()
            openMembers()
          }}
          onSkip={bandCoach.done}
        />
      )}
      {fieldCoach.show && (
        <ShioriCoachMark
          target={wishField}
          shape="button"
          label={translate('まずは、この旅でやりたいことを書いてみよう！', 'Start by writing something you want to do on this trip!')}
          onOpen={() => {
            // 案内を閉じて後ろの画面の inert を外してから、欄にフォーカスを移す（inert の中の欄はフォーカスを受けない）。
            // iOS でキーボードを出すには、押した操作の中で focus を呼ぶ必要があるので、待たずに反映させる
            flushSync(() => fieldCoach.done())
            wishSlot.current?.querySelector('input')?.focus()
          }}
          onSkip={fieldCoach.done}
        />
      )}
      {coach.show && (
        <ShioriCoachMark
          target={routeSlot}
          onOpen={() => {
            coach.done()
            // しおりを開くと、続けてしおりの中を案内する（ShioriGuide。初めて開いたとき）
            openShiori()
          }}
          // とばしたときは、しおりを開かない。しおりの中の案内は、あとで自分で開いたときに出す
          onSkip={coach.done}
        />
      )}
      <TripMap
        regions={trip.regions}
        prefectures={trip.prefectures}
        pins={map.pins}
        currentWishId={map.currentWishId}
        members={members}
        models={map.models}
        celebratingPinId={map.builtPinId}
        selectedPinId={inviting ? null : map.selectedPinId}
        onSelectPin={selectFromMap}
        onViewChange={map.onViewChange}
        focus={map.focus}
        topInset={topHeight}
        bottomInset={bottomHeight}
        // しおりを開いていなくても、建てた場所をつなぐ道順と回る順番を出す
        lines={map.shioriLines}
        orders={map.shioriOrders}
      />

      <div className={styles.top} ref={topRef}>
        {/* 上の帯は 1 か所に置き、状態で中身だけを変える（帯を押したとき、帯が作り直されてフォーカスが外れないように） */}
        <TripHeader
          title={showingPin ? (selection.wishText ?? pinDisplayName(selection.pin)) : trip.title}
          left={
            showingPin ? (
              <Button sound="close" iconOnly aria-label={translate('みんなの地図に戻る', "Back to the shared map")} onClick={() => map.selectPin(null)}>
                <Icon name="back" />
              </Button>
            ) : (
              // 左上のしおりボタン：しおり（S11）を開く。右のホームボタンと同じ、帯の高さの正方形。しおりでは同じ場所が戻るボタンになる。
              // 招待のシートを開いているあいだも出す（帯の長さを変えない。押すとシートを閉じてしおりへ移る）。
              // まだ見ていない場所が入ったら「NEW」（チームの合意、かめの決定、2026-11-22。開く・閉じるを同じ場所にし、帯の長さを変えないため）
              <span className={styles.routeSlot} ref={routeSlot}>
                <Button
                  variant="route"
                  iconOnly
                  aria-label={map.shioriHasNew
                    ? translate('しおりを開く（新しい場所が入りました）', 'Open itinerary (new place added)')
                    : translate('しおりを開く', 'Open itinerary')}
                  className={styles.routeButton}
                  onClick={openShiori}
                >
                  <Icon name="route" />
                </Button>
                {map.shioriHasNew && (
                  <span className={styles.newBadge} aria-hidden="true">
                    NEW
                  </span>
                )}
              </span>
            )
          }
          // しおりボタンは、右のホームボタンと同じ形（帯の高さの角の丸い正方形）にする
          leftSquare={!showingPin}
          badges={
            showingPin ? (
              <HeaderBadge tone="go" icon="pin" label={translate(`候補 ${selection.total}`, `Suggestions: ${selection.total}`)}>
                {selection.total}
              </HeaderBadge>
            ) : undefined
          }
          // 招待のシートを開いたときも、日程と大まかな場所の印は出さない（Takana の依頼、2026-11-22）
          // みんなの地図では建物とピンの数は出さず、名前と顔を 1 段に並べる（Lazyturtle0852 の決定、2026-11-22）
          oneRow={!showingPin}
          right={showingPin ? null : undefined}
          members={members}
          // 旅の設定（メンバーと招待）は、どの状態でも帯を押して開く。設定のマークは付けない（Youkin06 の決定、2026-11-22）
          onOpenMembers={openMembers}
          membersOpen={Boolean(inviting)}
          bandRef={band}
        />
        {!showingPin && !inviting && (activity || map.viewLabel) && (
          // 上の帯の下の行：左にいま見ているあたり、右にいちばん新しいできごと（メンバーの顔は、上の旅の名前の帯に入れた。#231）。
          // 建物が建ったお知らせ（S07）も、右に「○○が建った・たった今」と出る（大きなお知らせは出さない）
          <div className={styles.row}>
            {map.viewLabel && (
              <p className={styles.view}>
                <Icon name="eye" size={18} />
                <span className={styles.viewText}>{
                  map.viewLabel === '日本全体'
                    ? translate('日本全体', 'All Japan')
                    : map.viewLabel.split('・').map(areaDisplayName).join(translate('・', ' / '))
                }</span>
                <span className={styles.srOnly}>{translate('のあたりから探します', "Search near this area")}</span>
              </p>
            )}
            {activity && (
              <button
                type="button"
                className={styles.activity}
                onClick={() => { playSound('select'); map.showPins(activity.pinIds) }}
                aria-label={`${activity.shared ? '' : `${activity.member?.displayName ?? translate('だれか', 'Someone')}${translate('：', ': ')}`}${activity.text}${translate(`（${timeAgo(activity.at, map.now)}）`, ` (${timeAgo(activity.at, map.now)})`)}`}
              >
                {activity.member && <Avatar member={activity.member} size={26} />}
                <span className={styles.activityText}>{activity.text}</span>
                {activity.busy ? (
                  <span className={styles.busy} aria-hidden="true" />
                ) : (
                  <span className={styles.ago}>・{timeAgo(activity.at, map.now)}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.spacer} />

      <div className={styles.bottom} ref={bottomRef}>
        {inviting ? (
          inviteSheet
        ) : selection ? (
          <PlaceCard
            // ピンごとに作り直す（スワイプで選び直したとき、入ってくる動きで変わったことが分かる）
            key={selection.pin.id}
            pin={selection.pin}
            index={selection.index}
            total={selection.total}
            wisher={selection.wisher}
            wishText={selection.wishText}
            showcase={
              selection.pin.status === 'done' && map.models[selection.pin.id] ? <ModelTurntable model={map.models[selection.pin.id]} /> : undefined
            }
            state={
              selection.pin.status === 'building'
                ? translate(`${selection.builder ? `${selection.builder.displayName}が` : ''}建築中です。できたら、地図に建ちます`, `${selection.builder ? `${selection.builder.displayName} is building this place.` : 'Building this place.'} It will appear on the map when ready.`)
                : selection.pin.status === 'done'
                  ? builtState(
                      selection.builder?.displayName ?? null,
                      selection.pin.builtBy === selection.pin.uid,
                      map.loadedModels[selection.pin.id]?.source === 'argon',
                    )
                  : selection.pin.status === 'failed'
                    ? translate('前の建築は失敗しました。もう一度建てられます', "The last build failed. You can build again.")
                    : undefined
            }
            prev={selection.prev ? { name: pinDisplayName(selection.prev), go: () => swipeToNeighbor(selection.prev!.id, 'prev', selection.amongBuildings) } : undefined}
            next={selection.next ? { name: pinDisplayName(selection.next), go: () => swipeToNeighbor(selection.next!.id, 'next', selection.amongBuildings) } : undefined}
            enter={cardEnter ?? undefined}
            // 口コミ：候補（と建築に失敗したピン）のカードだけで出す（#203。建てる前に選ぶため）。建った建物の口コミは
            // しおりの場所の情報（S12）で出す（カードを払うたびに口コミの 1 日の回数を使わないように）。
            // 出せるかは Functions が決める（本番、合言葉）。出せないときは何も出ない
            extra={
              <>
                {/* 宿の候補には、建てる前に宿を調べられるよう、公式サイトと Booking.com の検索へのリンクを出す（#705） */}
                {selection.pin.category === 'lodging' && (
                  <LodgingLinks
                    tripId={tripId}
                    pinId={selection.pin.id}
                    name={selection.pin.name}
                    area={selection.pin.area}
                    ask={selection.pin.status === 'candidate' || selection.pin.status === 'failed' ? reviewsAsk(selection.pin) : null}
                    active
                  />
                )}
                <PlaceReviews
                  tripId={tripId}
                  pinId={selection.pin.id}
                  ask={selection.pin.status === 'candidate' || selection.pin.status === 'failed' ? reviewsAsk(selection.pin) : null}
                  active
                />
              </>
            }
            // 確定しているあいだは、建てない・消さない（地図は見るだけ）
            action={
              !confirmed && (selection.pin.status === 'candidate' || selection.pin.status === 'failed') ? (
                // 「建築する！」の案内（buildCoach）が、この入れ物を測って指す。
                // 案内が出る前に自分でボタンを押したら、押した時点で済んだことにする（頼むのに時間がかかっても、送信中のボタンに案内を出さない）。
                // 押せないボタン（送信中、上限）の click は届かない
                <div ref={buildSlot} onClickCapture={buildCoach.done}>
                  <BuildButton
                    // ピンごとに作り直す（前のピンの「断られた理由」を残さない）
                    key={selection.pin.id}
                    tripId={tripId}
                    pinId={selection.pin.id}
                    builtCount={map.counts.buildings}
                    retry={selection.pin.status === 'failed'}
                    onRequested={map.onBuildRequested}
                  />
                </div>
              ) : undefined
            }
            // 建った建物だけ、一番下に「建物を消す」。消すと全員の地図から消え、しおりが組み直される（企画書「ユーザー体験」3-6）。
            // 工事中は、模型を作る処理と重なるので出さない
            // しおりから外れた建物（日程や時間に入りきらなかった）には、その上に「しおりに戻す」も出す（Takana の決定、2026-11-23、バグ30）
            footer={
              !confirmed && selection.pin.status === 'done' ? (
                <>
                  {map.shioriRoute?.leftOutPinIds?.includes(selection.pin.id) && (
                    <RestorePlaceButton key={`restore-${selection.pin.id}`} tripId={tripId} pinId={selection.pin.id} />
                  )}
                  <RemoveBuildingButton key={selection.pin.id} tripId={tripId} pinId={selection.pin.id} />
                </>
              ) : undefined
            }
          />
        ) : confirmed ? (
          // 確定しているあいだは、やりたいことを書けない。代わりに確定していることと、しおりへの入口を出す
          <div className={styles.confirmedBar} role="status">
            <p className={styles.confirmedText}>
              <Icon name="bookmark" size={20} />
              {isOwner ? translate('旅程を確定しています。取り消すと、また全員で計画できます', "The itinerary is finalized. Reopen it to let everyone plan again.") : translate('発案者が旅程を確定しています。地図は見るだけです', "The organizer has finalized the itinerary. The map is read-only.")}
            </p>
            <Button variant="route" block onClick={openBook}>
              {translate('しおりを見る', "View itinerary")}
            </Button>
          </div>
        ) : (
          // 旅を作った直後の 2 段目の案内（M-1）が、この中の欄を指す
          <div ref={wishSlot} className={styles.wishSlot}>
            <WishBar
              tripId={tripId}
              getBounds={map.getBounds}
              area={map.focusArea}
              onAdded={() => {}}
              hint={
                lodgingHint.night !== null ? (
                  <LodgingHint
                    night={lodgingHint.night}
                    busy={lodgingBusy}
                    onFind={() => void findLodging.find(lodgingHint.night!)}
                    onClose={() => lodgingHint.close(lodgingHint.night!)}
                  />
                ) : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
