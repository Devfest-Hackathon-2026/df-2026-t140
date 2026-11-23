import type { Pin } from '@/entities/pin'
import { type AirportStop, defaultLegMode, legAirportStops, type LegFlight, type LegMode, legKey, ORIGIN_KEY, pinOfStop, planeAllowed, type Route, walkAllowed } from '@/entities/route'
import { type Trip, tripOriginLocation, travelModeOf } from '@/entities/trip'
import type { WithId } from '@/shared/api'

/** 決まったしおりの移動の行に出すもの（地図のしおり S11 の移動の行と同じ決め方。pages/trip-map/ui/ShioriSheet.tsx の renderMove） */
export interface FinalLeg {
  from: string
  to: string
  mode: LegMode
  chosen: boolean
  tripMode: LegMode
  walkable: boolean
  planeable: boolean
  flight?: LegFlight
  /** 飛行機の区間で乗り降りする空港（行の下に、場所の行と同じ形で出す）。ほかの区間は null */
  airports: { from: AirportStop; to: AirportStop } | null
}

/** from（行の ID か、出発地の @origin）から to（行の ID）への区間の手段。行の ID は、ふつうはピンの ID。選んでいない区間は区間の既定 */
export function finalLeg(trip: Trip, route: Route, pins: readonly WithId<Pin>[], from: string, to: string): FinalLeg {
  const at = (id: string) => (id === ORIGIN_KEY ? tripOriginLocation(trip) : pins.find((pin) => pin.id === pinOfStop(id))?.location)
  const chosen = route.legModes?.[legKey(from, to)]
  const fallback = defaultLegMode(at(from), at(to), travelModeOf(trip))
  const mode = chosen ?? fallback
  const fromPoint = at(from)
  const toPoint = at(to)
  const flight = route.legFlights?.[legKey(from, to)]
  return {
    from,
    to,
    mode,
    chosen: Boolean(chosen),
    tripMode: fallback,
    walkable: walkAllowed(fromPoint, toPoint),
    planeable: planeAllowed(fromPoint, toPoint),
    flight,
    airports: mode === 'plane' && fromPoint && toPoint ? legAirportStops(flight, fromPoint, toPoint) : null,
  }
}
