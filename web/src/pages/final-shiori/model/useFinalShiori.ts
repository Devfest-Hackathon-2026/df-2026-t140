import { translate } from '@/shared/lib'
import { useMemo } from 'react'
import { ownerUidOf, useMembers } from '@/entities/member'
import { type ModelJson, useModels } from '@/entities/model3d'
import { usePins } from '@/entities/pin'
import { lodgingNights, lodgingStopIds, ORIGIN_KEY, shioriRouteOf, useRoutes } from '@/entities/route'
import { isConfirmed, type NightOff, type ShioriDay, type ShioriRow, shioriBookDateText, shioriBookDays, shioriBookHasPlaces, shioriBookOf, useTrip } from '@/entities/trip'
import { useWishes } from '@/entities/wish'
import { useShioriWeather } from '@/features/shiori-weather'
import { useSession } from '@/shared/api'
import { nights } from '@/shared/lib'
import { type FinalLeg, finalLeg } from './legs'

/** 画面に出す 1 行。次の場所までの移動の行に出す区間（なければ null）を付ける */
export type FinalRowView = ShioriRow & { leg: FinalLeg | null }

const EMPTY: never[] = []

/**
 * 決まったしおり（S14）に出すもの。発案者が旅程を確定した旅の、今のしおり（保存してある時刻）から作る（2026-11-21、#502）。
 * 2026-11-20 までは、確定したときに Functions が写したもの（finalShiori）を読んでいた。
 * 確定していない旅（取り消された旅を含む）では confirmed が false になり、画面は地図のしおりへの案内だけを出す
 */
export function useFinalShiori(tripId: string) {
  const session = useSession()
  const trip = useTrip(tripId)
  const members = useMembers(tripId)
  const pins = usePins(tripId)
  const routes = useRoutes(tripId)
  const wishes = useWishes(tripId)
  const tripData = trip.data
  const memberList = members.data ?? EMPTY
  const decidedRouteId = tripData?.status === 'decided' ? tripData.decidedRouteId : null
  const route = useMemo(() => shioriRouteOf(routes.data ?? EMPTY, decidedRouteId), [routes.data, decidedRouteId])
  const book = useMemo(() => {
    if (!tripData || !route) return undefined
    const built = (pins.data ?? EMPTY).filter((pin) => pin.status === 'done')
    const made = shioriBookOf(tripData, route.schedule, built, memberList, wishes.data ?? EMPTY, lodgingStopIds(route), nightsOffOf(route, nights(tripData.startDate, tripData.endDate)))
    return shioriBookHasPlaces(made) ? made : undefined
  }, [tripData, route, pins.data, memberList, wishes.data])
  // 行の丸に出す模型（試験的。2026-11-21）。建った場所のぶんだけ読む
  const doneIds = useMemo(() => (pins.data ?? EMPTY).filter((pin) => pin.status === 'done').map((pin) => pin.id), [pins.data])
  const loadedModels = useModels(tripId, doneIds)
  const models = useMemo(() => {
    const jsons: Record<string, ModelJson> = {}
    for (const [pinId, model] of Object.entries(loadedModels)) jsons[pinId] = model.json
    return jsons
  }, [loadedModels])
  // 天気予報（場所の行の右端のアイコン）。確定しているあいだだけ取る。過ぎた日は、この端末に積んだ予報を出す
  const weather = useShioriWeather(
    tripId,
    tripData?.startDate ?? '',
    tripData?.endDate ?? null,
    isConfirmed(tripData) && route ? route.schedule : EMPTY,
    pins.data ?? EMPTY,
  )
  const days: (Omit<ShioriDay, 'rows'> & { rows: FinalRowView[] })[] = book
    ? withLegs(shioriBookDays(book), (from, to) => (tripData && route ? finalLeg(tripData, route, pins.data ?? EMPTY, from, to) : null))
    : []
  // 行の ID（集合場所は @origin）→ 次の場所までの手段。PDF の移動の行に、画面と同じ手段を書く
  const moveModes = Object.fromEntries(days.flatMap((day) => day.rows).flatMap((row) => (row.leg ? [[row.leg.from, row.leg.mode]] : [])))
  return {
    moveModes,
    loading: trip.loading || members.loading || pins.loading || routes.loading || wishes.loading,
    failed: Boolean(trip.error) || (!trip.loading && !tripData),
    title: tripData?.title ?? translate('しおり', "Itinerary"),
    confirmed: isConfirmed(tripData),
    isOwner: ownerUidOf(members.data) === session.uid,
    book,
    days,
    models,
    trip: tripData,
    route,
    pins: pins.data ?? EMPTY,
    weather,
    dateText: book ? shioriBookDateText(book) : '',
  }
}

/**
 * 日ごとの行に、次の場所までの区間を付ける（地図のしおり S11 の移動の行と同じ。行き先は、日をまたいでもしおりの順で次に建った場所）。
 * 移動の時間がない行と、ピンのないほかの行には付けない
 */
function withLegs(days: ShioriDay[], legOf: (from: string, to: string) => FinalLeg | null): (Omit<ShioriDay, 'rows'> & { rows: FinalRowView[] })[] {
  // 区間の両端は行の ID（同じ場所を何度も訪れるしおりでは、2 回目からの行は「ピンの ID~番号」。区間の手段と便は行の ID で引く）
  const placeIds = days.flatMap((day) => day.rows).map((row) => row.stopId ?? row.pinId)
  let order = -1
  return days.map((day) => ({
    ...day,
    rows: day.rows.map((row) => {
      order += 1
      const to = row.kind !== 'other' && row.moveMinutesToNext !== null ? (placeIds.slice(order + 1).find((id) => id !== null) ?? null) : null
      return { ...row, leg: to ? legOf(row.stopId ?? row.pinId ?? ORIGIN_KEY, to) : null }
    }),
  }))
}

/** 宿を取らない夜（しおりの中身に渡す）。泊まる夜ごとの宿の状態のうち、宿を取らないと決めたもの */
function nightsOffOf(route: Parameters<typeof lodgingNights>[0], nightCount: number): NightOff[] {
  return lodgingNights(route, nightCount).flatMap((item) => (item.state === 'skip' ? [{ night: item.night, note: item.note }] : []))
}
