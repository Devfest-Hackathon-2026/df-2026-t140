import type { Pin } from '@/entities/pin'
import { type AirportStop, legAirportStops, legKey, legModeOf, ORIGIN_KEY, pinOfStop, type Route } from '@/entities/route'
import { type Trip, tripOriginLocation } from '@/entities/trip'
import type { WithId } from '@/shared/api'

/**
 * しおりの一覧で、区間（from は行の ID か @origin、to は行の ID）の乗り降りする空港を引く関数を作る。
 * 飛行機の区間で空港が分かるときだけ空港を返し、ほかは null。地図の線・再生と同じ決め（legModeOf、legAirportStops）。
 * 決まったしおりの同じ決めは pages/final-shiori/model/legs.ts
 */
export function shioriLegAirports(
  trip: Trip,
  route: Route,
  pins: readonly WithId<Pin>[],
  tripMode: Parameters<typeof legModeOf>[4],
): (leg: { from: string; to: string }) => { from: AirportStop; to: AirportStop } | null {
  const at = (id: string) => (id === ORIGIN_KEY ? tripOriginLocation(trip) : pins.find((pin) => pin.id === pinOfStop(id))?.location)
  return ({ from, to }) => {
    const fromPoint = at(from)
    const toPoint = at(to)
    if (!fromPoint || !toPoint || legModeOf(route.legModes, from, to, at, tripMode) !== 'plane') return null
    return legAirportStops(route.legFlights?.[legKey(from, to)], fromPoint, toPoint)
  }
}
