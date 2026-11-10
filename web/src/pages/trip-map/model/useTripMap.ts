import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMembers } from '@/entities/member'
import { type ModelJson, useModels } from '@/entities/model3d'
import { adjacentBuildings, adjacentCandidates, candidatesExpireAt, candidatesOfWish, pinCounts, type PinStatus, usePins, visiblePins } from '@/entities/pin'
import { roadLinePoints, shioriRouteOf, useRoutes, useShioriTravel } from '@/entities/route'
import { originLocation, useTrip } from '@/entities/trip'
import { type MapBounds, useWishes, type WishStatus } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { playSound, useNow } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { latestActivity, shorten } from './activity'
import { ORIGIN_SPOT } from './spots'

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
          toast(`${member.displayName}が参加しました`)
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
  const onViewChange = useCallback((value: MapBounds, label: string) => {
    bounds.current = value
    setViewLabel(label)
  }, [])
  const getBounds = useCallback(() => bounds.current, [])

  // ---- 選んでいるピン（場所カード） ----
  const [selectedPinId, selectPin] = useState<string | null>(null)
  // いちばん新しい検索（自分の希望で、候補が出終わったもの）。次の検索の候補が出たら、前の候補は地図から消える
  const currentWishId = useMemo(() => {
    const done = (wishes.data ?? EMPTY).filter((wish) => wish.uid === session.uid && wish.status === 'done')
    return done.at(-1)?.id ?? null
  }, [wishes.data, session.uid])
  // その検索の候補は、立ってから 5 分で自分の地図からも消える（30 秒ごとに進む now で見る）
  const expireAt = useMemo(
    () => (currentWishId ? candidatesExpireAt(pins.data ?? EMPTY, currentWishId) : null),
    [pins.data, currentWishId],
  )
  const candidatesExpired = expireAt !== null && now.getTime() >= expireAt
  // 地図、場所カード、数の表示に出すのは、この人に見せるピンだけ
  // （候補は本人のいちばん新しい検索を 5 分だけ。見ている途中のカードは閉じるまで残す。建てたものは全員）
  const keepWishId = useMemo(
    () => (pins.data ?? EMPTY).find((pin) => pin.id === selectedPinId && pin.status === 'candidate')?.wishId ?? null,
    [pins.data, selectedPinId],
  )
  const pinList = useMemo(
    () => visiblePins(pins.data ?? EMPTY, { uid: session.uid, currentWishId, candidatesExpired, keepWishId }),
    [pins.data, session.uid, currentWishId, candidatesExpired, keepWishId],
  )
  const wishList = wishes.data ?? EMPTY
  const memberList = members.data ?? EMPTY
  const routeList = routes.data ?? EMPTY
  const selectedPin = pinList.find((pin) => pin.id === selectedPinId) ?? null
  const selectedGroup = selectedPin ? candidatesOfWish(pinList, selectedPin.wishId) : EMPTY

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
        // 地図に出すのは自分のいちばん新しい検索の候補だけ。それより前の検索があとから終わっても、知らせない（見えないので）
        const newest = wishes.data.filter((item) => item.uid === session.uid && item.status === 'done').at(-1)
        if (mine && newest?.id !== wish.id) continue
        const wishPins = candidatesOfWish(pins.data, wish.id)
        if (wishPins.length === 0) {
          // 希望とピンは別々に届く。ピンがまだなら、届いたときにもう一度見る
          next.set(wish.id, was ?? 'searching')
          continue
        }
        // ほかの人の候補は見せないので、ほかの人の希望にピンが立っても知らせない
        if (mine) {
          toast(`${quoted}に候補のピンが ${wishPins.length} つ立ちました`)
          playSound('discover', { channel: 'notification', key: `${tripId}:wish:${wish.id}:done` })
          showPins(wishPins.map((pin) => pin.id), 'notification')
        }
      } else if (wish.status === 'failed' && mine) {
        playSound('attention', { channel: 'notification', key: `${tripId}:wish:${wish.id}:failed` })
        toast(`${quoted}に合う場所が見つかりませんでした。言い方を変えて試してください`)
      }
    }
    seen.current = next
  }, [wishes.data, wishes.live, pins.data, session.uid, toast, showPins, tripId])

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
        if (!mine) toast(`${builder?.displayName ?? 'だれか'}が「${shorten(pin.name)}」の建築をはじめました`)
      } else if (pin.status === 'failed' && mine) {
        if (Date.now() - pin.updatedAt.toMillis() < 30_000) {
          playSound('error', { channel: 'notification', key: `${tripId}:${pin.id}:failed:${pin.updatedAt.toMillis()}` })
        }
        toast(`「${shorten(pin.name)}」の建築に失敗しました。ピンを押すと、もう一度建てられます`)
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
            stop,
            pin,
            wisher: memberList.find((member) => member.id === pin.uid),
            wishText: wishList.find((wish) => wish.id === pin.wishId)?.text ?? null,
          },
        ]
      }),
    [shioriRoute, pinList, memberList, wishList],
  )
  const shioriPins = useMemo(() => shioriStops.map((item) => item.pin), [shioriStops])
  // しおりの集合場所（#226）。場所の情報で、左右のスワイプで回る並びの先頭。建物ではないので、建物の数・番号・旅程には入れない。
  // 時刻は、しおりの 1 日目の「出発」の行から取る（その行は、出発地の位置が分かったときだけ Functions が入れる）。
  // 位置は、出発地の名前から引くおよその位置（Functions と同じ表）。分からなければ null（地図に印を出さず、地図も動かさない）
  const originName = trip.data?.origin ?? null
  const shioriOrigin = useMemo(() => {
    if (!originName) return null
    const row = shioriRoute?.schedule.find((stop) => stop.pinId === null && stop.day === 1)
    return { name: originName, time: row?.time ?? null, location: originLocation(originName) }
  }, [originName, shioriRoute])
  // しおりの線。しおりを開いていて Routes の道の形が返ってきた区間は道に沿わせ、ほかはまっすぐ結ぶ（#218。道の形は保存しない）。
  // しおりを閉じたら（みんなの地図）まっすぐに戻す。手元の見本の曲線のときは、画面に見本と出す（shioriLineSample。
  // 破線にするとベクター地図では線が描かれないため、線の見た目は変えない）
  const roadTravel = options.shioriOpen ? travel : null
  const shioriLines = useMemo(
    () =>
      shioriRoute && shioriStops.length >= 2
        ? [
            {
              id: shioriRoute.id,
              points: roadLinePoints(shioriStops.map((item) => ({ id: item.pin.id, location: item.pin.location })), roadTravel?.legPaths),
            },
          ]
        : EMPTY,
    [shioriRoute, shioriStops, roadTravel],
  )
  // しおりの再生で車が走る、区間ごとの道（i 番目は、i 番目の場所から次の場所まで）。線と同じく、道の形がなければまっすぐ
  const shioriLegs = useMemo(
    () =>
      shioriStops.slice(1).map((item, index) => {
        const from = shioriStops[index].pin
        return roadLinePoints(
          [
            { id: from.id, location: from.location },
            { id: item.pin.id, location: item.pin.location },
          ],
          roadTravel?.legPaths,
        )
      }),
    [shioriStops, roadTravel],
  )
  // 再生で車が走る、集合場所から 1 つ目の場所までの道。集合場所の位置が分からなければ null（1 つ目の場所から走り出す）
  const originPoint = shioriOrigin?.location ?? null
  const firstStopPin = shioriStops[0]?.pin ?? null
  const shioriOriginLeg = useMemo(
    () =>
      originPoint && firstStopPin
        ? roadLinePoints(
            [
              { id: ORIGIN_SPOT, location: originPoint },
              { id: firstStopPin.id, location: firstStopPin.location },
            ],
            roadTravel?.legPaths,
          )
        : null,
    [originPoint, firstStopPin, roadTravel],
  )
  const shioriOrders = useMemo(
    () => Object.fromEntries(shioriStops.map((item, order) => [item.pin.id, order + 1])),
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
        wishText: wishList.find((wish) => wish.id === selectedPin.wishId)?.text ?? null,
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
    toast('建築をはじめました。できたら、地図のその場所に建ちます')
  }, [toast])

  // 上の帯のできごとに出す希望は、自分の希望だけ（ほかの人の候補は見せない）。
  // 終わった検索は、いま地図に候補が出ているものだけ（前の検索や 5 分たった検索を「ピン 0」と出さない）
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
    wishes: wishList,
    counts: pinCounts(pinList),
    myUid: session.uid,
    now,
    viewLabel,
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
    shioriStops,
    shioriPins,
    shioriOrigin,
    shioriLines,
    shioriLegs,
    shioriOriginLeg,
    /** しおりの道の線が、手元（Emulator）の見本の曲線か（画面に見本と出す） */
    shioriLineSample: Boolean(roadTravel?.sample),
    shioriOrders,
    shioriHasNew,
    markShioriSeen: () => setShioriHasNew(false),
    onBuildRequested,
  }
}
