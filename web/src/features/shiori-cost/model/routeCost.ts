import type { Pin } from '@/entities/pin'
import { distanceKm, legModeOf, ORIGIN_KEY, pinOfStop, type Route } from '@/entities/route'
import { type Trip, travelModeOf, tripOriginLocation } from '@/entities/trip'
import type { WithId } from '@/shared/api'
import { nights } from '@/shared/lib'
import { costLegPairs, estimateShioriCost } from './estimate'

export function routeCost(trip: Trip, route: Route, pins: readonly WithId<Pin>[], memberCount: number) {
  const places = new Map(pins.map((pin) => [pin.id, pin.location]))
  const at = (id: string) => id === ORIGIN_KEY ? tripOriginLocation(trip) : places.get(pinOfStop(id))
  const mode = travelModeOf(trip)
  // 帰る場所（出発地と違うときだけある）。最後の帰りの区間は、そこまでで見る（しおりの帰りの移動の目安と同じ。Functions の tripOrigin）
  const goal = trip.returnTo && trip.returnTo !== trip.origin && trip.returnPoint?.name === trip.returnTo ? trip.returnPoint.location : null
  const homeAt = (id: string) => (id === ORIGIN_KEY ? goal ?? tripOriginLocation(trip) : places.get(pinOfStop(id)))
  // 出発地から回って、最後の場所から帰る場所（なければ出発地）へ帰るまで
  const pairs = costLegPairs(route.pinIds, ORIGIN_KEY)
  const legs = pairs.map(([from, to], index) => {
    const locate = index === pairs.length - 1 && index > 0 && to === ORIGIN_KEY ? homeAt : at
    const start = locate(from)
    const end = locate(to)
    return {
      mode: legModeOf(route.legModes, from, to, locate, mode),
      km: start && end ? distanceKm(start, end) : null,
    }
  })
  return estimateShioriCost(legs, nights(trip.startDate, trip.endDate), memberCount)
}
