import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMembers } from '@/entities/member'
import { type ModelJson, useModels } from '@/entities/model3d'
import { adjacentBuildings, adjacentCandidates, candidatesOfWish, isOpenFiller, type LatLng, pinCounts, pinDisplayName, type PinStatus, staleBuildIds, usePins, visiblePins } from '@/entities/pin'
import { type AirportStop, flightLegPath, legKey, legModeOf, lodgingNights, lodgingStopIds, mealSlots, ORIGIN_KEY, roadLinePoints, shioriRouteOf, stopIdOf, stopTimeSlots, useRoutes, useShioriTravel } from '@/entities/route'
import { groundMode, isConfirmed, shioriBookHasPlaces, shioriBookOf, travelModeOf, tripOriginLocation, useTrip } from '@/entities/trip'
import { type MapBounds, useWishes, type WishStatus } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { nights, playSound, translate, useNow } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { EVENT_NOT_FOUND, latestActivity, shorten, wishDisplayText } from './activity'
import { isWishSearching } from './searching'
import { ORIGIN_SPOT } from './spots'
import type { TourPath } from './useShioriTour'
import { focusAreaName } from '@/widgets/trip-map'

const EMPTY: never[] = []

/** 建ったばかりの建物に、青い輪郭線と「建築完了」を出しておく時間 */
const BUILT_NOTICE_MS = 9000

/**
 * みんなの地図（S02、S04、S05、S07）と、同じ地図の上のしおり（S11〜S13）に出すもの：
 * 旅、メンバー、希望、ピン、選んでいるピン、いちばん新しいできごと、しおりのルート。
 * 誰かが参加した、希望にピンが立った、建築が始まった、を、画面をふさがないお知らせで知らせる。
 * 建物が建ったことは、上の帯の下の行（いちばん新しいできごと、activity.ts）と、建物の青い輪郭線で知らせる（S07）。
 */
export function useTripMap(tripId: string, options: { shioriOpen?: boolean } = {}) {
  const session = useSession()
  const toast = useToast()
  const trip = useTrip(tripId)
  const members = useMembers(tripId)
  const pins = usePins(tripId)
  const wishes = useWishes(tripId)
  const routes = useRoutes(tripId)
  const now = useNow()
  const known = useRef<Set<string> | null>(null)
  const seen = useRef<Map<string, WishStatus> | null>(null)
  const seenPins = useRef<Map<string, PinStatus> | null>(null)

  // 旅を切り替えたときも、その旅の最初の購読は無音。
  useEffect(() => {
    known.current = null
    seen.current = null
    seenPins.current = null
  }, [tripId])

  // 自分より前からいる人は知らせない（参加した直後は、先にいた人が後から届くことがあるため）
  useEffect(() => {
    if (!members.data) return
    const me = members.data.find((member) => member.id === session.uid)
    if (known.current && me && members.live) {
      for (const member of members.data) {
        const isNew = !known.current.has(member.id) && member.joinedAt.toMillis() > me.joinedAt.toMillis()
        if (isNew) {
          toast(translate(`${member.displayName}が参加しました`, `${member.displayName} joined the trip.`))
          if (Date.now() - member.joinedAt.toMillis() < 30_000) {
            playSound('confirm', { channel: 'notification', volume: 0.5, key: `${tripId}:join:${member.id}:${member.joinedAt.toMillis()}` })
          }
        }
      }
      if ([...known.current].some((id) => id !== session.uid && !members.data!.some((member) => member.id === id))) {
        playSound('close', { channel: 'notification', volume: 0.5 })
      }
    }
    known.current = new Set(members.data.map((member) => member.id))
  }, [members.data, members.live, session.uid, toast, tripId])

  // ---- 地図で映している範囲（希望と一緒に保存する）と、そのあたりの名前 ----
  const bounds = useRef<MapBounds | null>(null)
  const [viewLabel, setViewLabel] = useState<string | null>(null)
  // いま見ている地域（都道府県か地方。日本全体なら null）。入力欄の例文をこの地域に合わせる
  const [focusArea, setFocusArea] = useState<string | null>(null)
  const onViewChange = useCallback((value: MapBounds, label: string) => {
    bounds.current = value
    setViewLabel(label)
    setFocusArea(focusAreaName(value))
  }, [])
  const getBounds = useCallback(() => bounds.current, [])

  // ---- 選んでいるピン（場所カード） ----
  const [selectedPinId, selectPin] = useState<string | null>(null)
  // いちばん新しい検索（自分の希望。書いた時点で移る）。その候補だけを目立たせ、前の検索の候補は灰色の小さいピンで残す（Takana の依頼、2026-11-22）
  const currentWishId = useMemo(
    () => (wishes.data ?? EMPTY).filter((wish) => wish.uid === session.uid).at(-1)?.id ?? null,
    [wishes.data, session.uid],
  )
  // 地図、場所カード、数の表示に出すのは、この人に見せるピンだけ（候補は本人の全部の検索。建てたものは全員）
  // 旅程が確定しているあいだは、しおりの空いた時間への提案（まだ建てていないもの）を出さない（企画書。#520）
  const tripConfirmed = isConfirmed(trip.data)
  // 工事中のまま止まったピン（#727）は、失敗したものとして見せる（「前の建築は失敗しました」と出て、もう一度建てられる）。
  // 時刻で変わるので、ID の並びを文字にして、変わったときだけ作り直す
  const staleKey = staleBuildIds(pins.data ?? EMPTY, now).join(',')
  const pinList = useMemo(() => {
    const stale = new Set(staleKey ? staleKey.split(',') : [])
    return visiblePins(pins.data ?? EMPTY, { uid: session.uid })
      .filter((pin) => !(tripConfirmed && isOpenFiller(pin)))
      .map((pin) => (stale.has(pin.id) ? { ...pin, status: 'failed' as const } : pin))
  }, [pins.data, session.uid, tripConfirmed, staleKey])
  const wishList = wishes.data ?? EMPTY
  const memberList = members.data ?? EMPTY
  const routeList = routes.data ?? EMPTY
  const selectedPin = pinList.find((pin) => pin.id === selectedPinId) ?? null
  // しおりの空いた時間への提案（#520）は、どれも同じ wishId なので、まだ無視も建築もされていない提案だけで組にする
  // （無視した提案へスワイプで移って、建てられないように）
  const selectedGroup = selectedPin
    ? candidatesOfWish(pinList, selectedPin.wishId).filter((pin) => !selectedPin.filler || pin.id === selectedPin.id || isOpenFiller(pin))
    : EMPTY

  // ---- 地図を動かす合図 ----
  const [focus, setFocus] = useState<{ key: string; pinIds: string[] } | null>(null)
  const focusCount = useRef(0)
  const showPins = useCallback((pinIds: string[], channel: 'interaction' | 'notification' = 'interaction') => {
    if (pinIds.length === 0) return
    playSound('move', { channel })
    focusCount.current += 1
    setFocus({ key: `focus-${focusCount.current}`, pinIds })
  }, [])

  // ---- 希望にピンが立った、見つからなかった、を知らせる ----
  // 画面を開いたときにもう終わっていた希望は知らせない。見ている間に変わったものだけ
  useEffect(() => {
    if (!wishes.data || !pins.data) return
    const before = seen.current
    const next = new Map<string, WishStatus>()
    for (const wish of wishes.data) {
      const was = before?.get(wish.id)
      next.set(wish.id, wish.status)
      if (!before || !wishes.live || was === wish.status) continue
      const mine = wish.uid === session.uid
      const quoted = `「${shorten(wish.text)}」`
      if (wish.status === 'done') {
        // 地図で目立たせるのは、自分のいちばん新しい検索（currentWishId）の候補だけ。それより前の検索があとから終わっても、
        // 灰色の小さいピンで出るだけなので、知らせない（地図もそこへ動かさない）
        if (mine && currentWishId !== wish.id) continue
        const wishPins = candidatesOfWish(pins.data, wish.id)
        if (wishPins.length === 0) {
          // 希望とピンは別々に届く。ピンがまだなら、届いたときにもう一度見る
          next.set(wish.id, was ?? 'searching')
          continue
        }
        // ほかの人の候補は見せないので、ほかの人の希望にピンが立っても知らせない
        if (mine) {
          toast(translate(
            `${quoted}に候補のピンが ${wishPins.length} つ立ちました`,
            `Found ${wishPins.length} ${wishPins.length === 1 ? 'suggestion' : 'suggestions'} for “${shorten(wish.text)}”.`,
          ))
          playSound('discover', { channel: 'notification', key: `${tripId}:wish:${wish.id}:done` })
          showPins(wishPins.map((pin) => pin.id), 'notification')
        }
      } else if (wish.status === 'failed' && mine) {
        playSound('attention', { channel: 'notification', key: `${tripId}:wish:${wish.id}:failed` })
        // 時刻が決まったイベントが、旅の日程のあいだに見つからなかったときは、それだけを伝える（ほかの場所は出さない。Takana の決定、2026-11-21、#581）
        toast(wish.notFound === 'event' ? EVENT_NOT_FOUND : translate(
          `${quoted}に合う場所が見つかりませんでした。言い方を変えて試してください`,
          `No places found for “${shorten(wish.text)}”. Try a different search.`,
        ))
      }
    }
    seen.current = next
  }, [wishes.data, wishes.live, pins.data, session.uid, currentWishId, toast, showPins, tripId])

  // ---- 建物の模型（完成したピンのぶんだけ読む） ----
  const doneIds = useMemo(() => pinList.filter((pin) => pin.status === 'done').map((pin) => pin.id), [pinList])
  const loadedModels = useModels(tripId, doneIds)
  const models = useMemo(() => {
    const jsons: Record<string, ModelJson> = {}
    for (const [pinId, model] of Object.entries(loadedModels)) jsons[pinId] = model.json
    return jsons
  }, [loadedModels])

  // ---- 建築が始まった、建った、失敗した、を知らせる（見ている間に変わったものだけ） ----
  // 建ったばかりの建物（青い輪郭線と「建築完了」を出す）
  const [builtPinId, setBuiltPinId] = useState<string | null>(null)
  // しおりに、まだ見ていない場所が入った（左上のルートボタンに「NEW」を出す。しおりを開くと消える）
  const [shioriHasNew, setShioriHasNew] = useState(false)
  useEffect(() => {
    if (!pins.data) return
    const before = seenPins.current
    seenPins.current = new Map(pins.data.map((pin) => [pin.id, pin.status]))
    if (!before || !pins.live) return
    for (const pin of pins.data) {
      const was = before.get(pin.id)
      if (was === pin.status) continue
      const builder = members.data?.find((member) => member.id === pin.builtBy)
      const mine = pin.builtBy === session.uid
      if (pin.status === 'done') {
        // 購読で届いた変化（ほかの人の操作や Functions の結果）を、印の状態にする。描画からは導けない
        // oxlint-disable-next-line react/set-state-in-effect
        setBuiltPinId(pin.id)
        setShioriHasNew(true)
        if (Date.now() - pin.updatedAt.toMillis() < 30_000) {
          playSound('build-complete', { channel: 'notification', volume: mine ? 1 : 0.5, key: `${tripId}:${pin.id}:done:${pin.updatedAt.toMillis()}` })
        }
      } else if (pin.status === 'building') {
        if (!mine) toast(translate(`${builder?.displayName ?? 'だれか'}が「${shorten(pin.name)}」の建築をはじめました`, `${builder?.displayName ?? 'Someone'} started building “${shorten(pinDisplayName(pin))}”.`))
      } else if (pin.status === 'failed' && mine) {
        if (Date.now() - pin.updatedAt.toMillis() < 30_000) {
          playSound('error', { channel: 'notification', key: `${tripId}:${pin.id}:failed:${pin.updatedAt.toMillis()}` })
        }
        toast(translate(
          `「${shorten(pin.name)}」の建築に失敗しました。ピンを押すと、もう一度建てられます`,
          `Couldn't build “${shorten(pinDisplayName(pin))}”. Select the pin to try again.`,
        ))
      }
    }
  }, [pins.data, pins.live, members.data, session.uid, toast, tripId])

  useEffect(() => {
    if (trip.error || members.error || pins.error || wishes.error || routes.error) {
      playSound('error', { channel: 'notification', key: `${tripId}:load-error` })
    }
  }, [trip.error, members.error, pins.error, wishes.error, routes.error, tripId])

  useEffect(() => {
    if (!builtPinId) return
    const timer = setTimeout(() => setBuiltPinId(null), BUILT_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [builtPinId])

  // ---- しおり（S11〜S13）：建った場所が旅の順に並ぶ。Functions が、建物が建つたびに順番を保って足す ----
  const decidedRouteId = trip.data?.status === 'decided' ? trip.data.decidedRouteId : null
  const savedShioriRoute = useMemo(() => shioriRouteOf(routeList, decidedRouteId), [routeList, decidedRouteId])
  // しおりを開いている間だけ、Routes API（車）の移動時間を聞き、聞けたら時刻と移動時間をそれに差し替えて出す。
  // 保存してあるのは直線距離の目安（規約で Routes の時間は保存できないため、画面のメモリーにだけ持つ）
  const travel = useShioriTravel(tripId, savedShioriRoute, Boolean(options.shioriOpen))
  const shioriRoute = useMemo(
    () => (savedShioriRoute && travel ? { ...savedShioriRoute, schedule: travel.schedule, totalMoveMinutes: travel.totalMoveMinutes } : savedShioriRoute),
    [savedShioriRoute, travel],
  )
  const shioriStops = useMemo(
    () =>
      (shioriRoute?.schedule ?? []).flatMap((stop) => {
        const pin = pinList.find((item) => item.id === stop.pinId)
        if (!pin) return []
        return [
          {
            // 行の ID。同じ場所を何度も訪れるしおりでは、同じピンの行が 2 つ以上あるので、行はこれで見分ける
            id: stopIdOf(stop) ?? pin.id,
            stop,
            pin,
            wisher: memberList.find((member) => member.id === pin.uid),
            wishText: wishDisplayText(wishList.find((wish) => wish.id === pin.wishId)),
          },
        ]
      }),
    [shioriRoute, pinList, memberList, wishList],
  )
  // 書き出し（PDF、Google カレンダー、Google マップ）に渡すしおりの中身。保存してある時刻で作る
  // （Routes の時間で差し替えた行は使わない。Maps の内容は外へ持ち出せないため）。建った場所がなければ undefined
  const tripData = trip.data
  const shioriBook = useMemo(() => {
    if (!tripData || !savedShioriRoute) return undefined
    // 宿を取らない夜も渡す（PDF のその日の最後に、書いた過ごし方を出す。#553）
    const nightsOff = lodgingNights(savedShioriRoute, nights(tripData.startDate, tripData.endDate)).flatMap((item) => (item.state === 'skip' ? [{ night: item.night, note: item.note }] : []))
    const book = shioriBookOf(tripData, savedShioriRoute.schedule, pinList, memberList, wishList, lodgingStopIds(savedShioriRoute), nightsOff)
    return shioriBookHasPlaces(book) ? book : undefined
  }, [tripData, savedShioriRoute, pinList, memberList, wishList])
  // しおりに並ぶ場所（同じ場所を何度も訪れるしおりでも、場所ごとに 1 つ）
  const shioriPins = useMemo(() => [...new Set(shioriStops.map((item) => item.pin))], [shioriStops])
  // 泊まる夜ごとの宿の状態（決まっていない、決めない、建物で決まっている）。しおりの宿の枠と、検索欄の上の知らせに使う（企画書 2-5、3-7）
  const tripNights = tripData ? nights(tripData.startDate, tripData.endDate) : 0
  const shioriLodging = useMemo(() => (savedShioriRoute ? lodgingNights(savedShioriRoute, tripNights) : EMPTY), [savedShioriRoute, tripNights])
  // 日ごとの朝・昼・晩ごはんの枠の状態（決まっていない、お店を建てずに決めた、お店で決まっている）。しおりのごはんの枠に使う（企画書 3-7 の 8）。
  // 旅の日数は泊まる夜の数 + 1。Functions が枠の日を確かめるときの日数（domain/routePlan.ts の tripDays）と同じ数になる
  const shioriMeals = useMemo(() => (savedShioriRoute ? mealSlots(savedShioriRoute, tripNights + 1) : EMPTY), [savedShioriRoute, tripNights])
  // しおりの空いた時間への提案のうち、まだ「無視」も建築もされていないもの（Functions の features/suggest-fillers が立てる。#520）
  const shioriFillers = useMemo(() => pinList.filter(isOpenFiller), [pinList])
  // 自分が頼んだ宿さがしが、まだ終わっていないか（その間は、宿を探すボタンを押せなくする）。
  // 関数が時間切れで止まったものは、帯の「さがし中」と同じ時間で終わったとみなし、ボタンを戻す（#729）
  const lodgingSearching = wishList.some(
    (wish) => wish.uid === session.uid && wish.lodgingNight !== undefined && isWishSearching(wish, now),
  )
  // 自分が頼んだお店さがしが、まだ終わっていないか（その間は、お店を探すボタンを押せなくする。止まったものは上と同じく戻す）
  const mealSearching = wishList.some(
    (wish) => wish.uid === session.uid && wish.mealSlot !== undefined && isWishSearching(wish, now),
  )
  // しおりの集合場所（#226）。場所の情報で、左右のスワイプで回る並びの先頭。建物ではないので、建物の数・番号・旅程には入れない。
  // 時刻（集合時間と出発時間）は、しおりの 1 日目の「出発」の行から取る（その行は、出発地の位置が分かったときだけ Functions が入れる）。
  // 位置は、出発地の名前から引くおよその位置（Functions と同じ表）。分からなければ null（地図に印を出さず、地図も動かさない）
  const originName = trip.data?.origin ?? null
  const shioriOrigin = useMemo(() => {
    if (!originName) return null
    const row = shioriRoute?.schedule.find((stop) => stop.pinId === null && stop.day === 1)
    return { name: originName, times: row ? stopTimeSlots(row) : [], location: trip.data ? tripOriginLocation(trip.data) : null }
  }, [originName, trip.data, shioriRoute])
  // 再生で走る乗り物を決める、区間ごとの手段（shioriLegs と同じ並び）と、集合場所から 1 つ目の場所までの手段。しおりの移動の行と同じ決め
  const originPoint = shioriOrigin?.location ?? null
  const firstStopPin = shioriStops[0]?.pin ?? null
  const firstStopId = shioriStops[0]?.id ?? null
  const legModes = shioriRoute?.legModes
  const tripMode = trip.data ? travelModeOf(trip.data) : 'car'
  const shioriLegModes = useMemo(() => {
    // 区間のキーは行の ID（同じ場所を何度も訪れるしおりでは、複製した行をまたぐ区間がある）
    const locate = (id: string) => (id === ORIGIN_KEY ? originPoint : shioriStops.find((item) => item.id === id)?.pin.location)
    return {
      legs: shioriStops.slice(1).map((item, index) => legModeOf(legModes, shioriStops[index].id, item.id, locate, tripMode)),
      origin: firstStopId ? legModeOf(legModes, ORIGIN_KEY, firstStopId, locate, tripMode) : tripMode,
      ground: groundMode(tripMode),
    }
  }, [shioriStops, legModes, originPoint, firstStopId, tripMode])
  // 飛行機の区間の線（キーは区間のキー）。出発地 → 乗る空港 → 降りる空港 → 行き先。空の移動は air（点の番号）の間。
  // 空港は Routes に聞かずに決まるので、しおりを閉じていても空港を経由させる。空港が分からない区間は入れない（まっすぐ結ぶ）
  const legFlights = shioriRoute?.legFlights
  const flightPaths = useMemo(() => {
    const paths = new Map<string, { key: string; points: LatLng[]; air: [number, number]; airports: { from: AirportStop; to: AirportStop } }>()
    const add = (from: string, to: string, fromPoint: LatLng, toPoint: LatLng) => {
      const key = legKey(from, to)
      const path = flightLegPath(legFlights?.[key], fromPoint, toPoint)
      if (path) paths.set(key, { key, ...path })
    }
    if (originPoint && firstStopPin && firstStopId && shioriLegModes.origin === 'plane') add(ORIGIN_KEY, firstStopId, originPoint, firstStopPin.location)
    shioriStops.slice(1).forEach((item, index) => {
      const from = shioriStops[index]
      if (shioriLegModes.legs[index] === 'plane') add(from.id, item.id, from.pin.location, item.pin.location)
    })
    return paths
  }, [legFlights, originPoint, firstStopPin, firstStopId, shioriStops, shioriLegModes])
  // しおりの地図に出す空港の印。飛行機の区間で乗り降りする空港を、建物と同じく場所として出す（同じ空港は 1 つにまとめる）
  const shioriAirports = useMemo(() => {
    const airports = new Map<string, AirportStop>()
    for (const path of flightPaths.values()) {
      for (const airport of [path.airports.from, path.airports.to]) if (!airports.has(airport.code)) airports.set(airport.code, airport)
    }
    return [...airports.values()]
  }, [flightPaths])
  // しおりの線。しおりを開いていて Routes の道の形が返ってきた区間は道に沿わせ、ほかはまっすぐ結ぶ（#218。道の形は保存しない）。
  // しおりを閉じたら（みんなの地図）まっすぐに戻す。手元の見本の曲線のときは、画面に見本と出す（shioriLineSample。
  // 破線にするとベクター地図では線が描かれないため、線の見た目は変えない）。飛行機の区間は、Routes の道ではなく空港を経由させる
  const roadTravel = options.shioriOpen ? travel : null
  const linePaths = useMemo(
    () => [...(roadTravel?.legPaths ?? []).filter((leg) => !flightPaths.has(leg.key)), ...flightPaths.values()],
    [roadTravel, flightPaths],
  )
  const shioriLines = useMemo(
    () =>
      shioriRoute && shioriStops.length >= 2
        ? [
            {
              id: shioriRoute.id,
              points: roadLinePoints(shioriStops.map((item) => ({ id: item.id, location: item.pin.location })), linePaths),
            },
          ]
        : EMPTY,
    [shioriRoute, shioriStops, linePaths],
  )
  // しおりの再生で車が走る、区間ごとの道（i 番目は、i 番目の場所から次の場所まで）。線と同じく、道の形がなければまっすぐ。
  // 飛行機の区間は、空の移動が道のどこからどこまでか（air。点の番号）と、乗り降りする空港を添える
  // （再生で、区間を空港で区切り、空港に止まる。空港の前後は地上の乗り物にする）
  const shioriLegs = useMemo(
    () =>
      shioriStops.slice(1).map((item, index): TourPath => {
        // 区間の道の形は、行の ID で引く（同じ場所を何度も訪れるしおりでは、複製した行をまたぐ区間がある）
        const from = shioriStops[index]
        const flight = flightPaths.get(legKey(from.id, item.id))
        return {
          points: roadLinePoints(
            [
              { id: from.id, location: from.pin.location },
              { id: item.id, location: item.pin.location },
            ],
            linePaths,
          ),
          air: flight?.air ?? null,
          airports: flight?.airports ?? null,
        }
      }),
    [shioriStops, linePaths, flightPaths],
  )
  // 再生で車が走る、集合場所から 1 つ目の場所までの道。集合場所の位置が分からなければ null（1 つ目の場所から走り出す）
  const originFlight = firstStopId ? flightPaths.get(legKey(ORIGIN_KEY, firstStopId)) : undefined
  const shioriOriginLeg = useMemo(
    (): TourPath | null =>
      originPoint && firstStopPin && firstStopId
        ? {
            points: roadLinePoints(
              [
                { id: ORIGIN_SPOT, location: originPoint },
                { id: firstStopId, location: firstStopPin.location },
              ],
              linePaths,
            ),
            air: originFlight?.air ?? null,
            airports: originFlight?.airports ?? null,
          }
        : null,
    [originPoint, firstStopPin, firstStopId, linePaths, originFlight],
  )
  const shioriOrders = useMemo(
    // 同じ場所を何度も訪れるしおりでは、地図の建物の番号は、最初に訪れる行の番号
    () => Object.fromEntries(shioriStops.map((item, order) => [item.pin.id, order + 1] as const).reverse()),
    [shioriStops],
  )

  // 場所カードに出すもの。左右にスワイプして移る前後は、候補のカードなら同じ希望の候補、
  // 建物のカードなら旅の建物（しおりの順）。端では null
  const isBuilding = selectedPin?.status === 'building' || selectedPin?.status === 'done'
  const selection = selectedPin
    ? {
        pin: selectedPin,
        index: selectedGroup.findIndex((pin) => pin.id === selectedPin.id) + 1,
        total: selectedGroup.length,
        wisher: memberList.find((member) => member.id === selectedPin.uid),
        wishText: wishDisplayText(wishList.find((wish) => wish.id === selectedPin.wishId)),
        builder: memberList.find((member) => member.id === selectedPin.builtBy),
        // 前後が建物どうしか（建物どうしなら、移ったときに地図をその建物へ寄せる）
        amongBuildings: isBuilding,
        ...(isBuilding
          ? adjacentBuildings(pinList, selectedPin.id, shioriOrders)
          : adjacentCandidates(selectedGroup, selectedPin.id)),
      }
    : null

  /** 「建築する！」を頼めたとき。待たずに、書く欄へ戻る */
  const onBuildRequested = useCallback(() => {
    selectPin(null)
    toast(translate('建築をはじめました。できたら、地図のその場所に建ちます', 'Building started. It will appear on the map when ready.'))
  }, [toast])

  // 上の帯のできごとに出す希望は、自分の希望だけ（ほかの人の候補は見せない）。
  // 終わった検索は、いま地図に候補が出ているものだけ（候補がみな建った検索などを「ピン 0」と出さない）
  const activityWishes = useMemo(
    () =>
      wishList.filter(
        (wish) =>
          wish.uid === session.uid &&
          (wish.status !== 'done' || pinList.some((pin) => pin.wishId === wish.id && pin.status === 'candidate')),
      ),
    [wishList, pinList, session.uid],
  )
  const activity = latestActivity(activityWishes, pinList, memberList, now)

  return {
    loading: trip.loading || members.loading || pins.loading || wishes.loading || routes.loading,
    trip: trip.data ?? null,
    members: members.data ?? null,
    pins: pinList,
    /** いちばん新しい自分の検索。ほかの検索の候補は、地図で灰色の小さいピンにする */
    currentWishId,
    wishes: wishList,
    counts: pinCounts(pinList),
    myUid: session.uid,
    now,
    viewLabel,
    focusArea,
    onViewChange,
    getBounds,
    selection,
    selectedPinId: selectedPin ? selectedPinId : null,
    selectPin,
    focus,
    showPins,
    activity,
    models,
    loadedModels,
    builtPinId,
    shioriRoute,
    // しおりの時刻と移動時間が、Routes API（Google）の時間で計算し直したものか。地図のない全面のしおりで、出どころを出すのに使う
    shioriTimesFromRoutes: Boolean(travel),
    shioriStops,
    shioriPins,
    shioriBook,
    shioriLodging,
    shioriMeals,
    /** しおりの空いた時間への提案（しおりのその日のゆとりの下に、薄い字で出す） */
    shioriFillers,
    /** 泊まる夜の宿に決まった建物のピンの ID */
    shioriStayIds: savedShioriRoute ? lodgingStopIds(savedShioriRoute) : EMPTY,
    lodgingSearching,
    mealSearching,
    shioriOrigin,
    shioriLines,
    shioriLegs,
    shioriOriginLeg,
    shioriLegModes,
    shioriAirports,
    /** しおりの道の線が、手元（Emulator）の見本の曲線か（画面に見本と出す） */
    shioriLineSample: Boolean(roadTravel?.sample),
    shioriOrders,
    shioriHasNew,
    markShioriSeen: () => setShioriHasNew(false),
    onBuildRequested,
  }
}
