import { FieldValue } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { tripOrigin } from '../../domain/tripOrigin'
import { routeWithPlaceBack } from './logic'
import type { RestorePlacePorts } from './ports'
import type { RestorePlaceInput, RestorePlaceResult } from './types'

/**
 * しおりから外した場所を、しおりに戻す。読む → logic で決める → 書く。
 * 地図で建物を押して出る場所カードの「しおりに戻す」から、画面が呼ぶ（Takana の決定、2026-11-23、バグ30）。
 * 戻せるのは旅のメンバーなら誰でも（建物を消すのと同じ）。旅程が確定しているあいだは戻さない。
 * 外した印（leftOutPinIds）のあるルートすべてに戻す。戻したあとに、便を探す飛行機の区間があれば時刻表を読む（searchingFlights）
 */
export async function restorePlace(ports: RestorePlacePorts, input: RestorePlaceInput): Promise<RestorePlaceResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const pinRef = tripRef.collection('pins').doc(input.pinId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<RestorePlaceResult> => {
    const [tripSnapshot, memberSnapshot, pinSnapshot, routesSnapshot, pinsSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members').doc(input.uid)),
      tx.get(pinRef),
      tx.get(tripRef.collection('routes')),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    if (!memberSnapshot.exists) return { status: 'not-member' }
    const trip = tripSnapshot.data() as Trip | undefined
    const pin = pinSnapshot.data() as Pin | undefined
    if (!trip || !pin) return { status: 'not-found' }
    if (pin.status !== 'done') return { status: 'not-built' }
    if (isConfirmed(trip)) return { status: 'confirmed' }

    const places = pinsSnapshot.docs.map((snapshot) => planPlace(snapshot.id, snapshot.data() as Pin))
    const origin = tripOrigin(trip)
    const days = tripDays(trip.startDate, trip.endDate)
    let routes = 0
    for (const snapshot of routesSnapshot.docs) {
      const route = snapshot.data() as Route
      const update = routeWithPlaceBack(route, places, origin, days, input.pinId, search(origin, trip.startDate, route.legFlights))
      if (!update) continue
      routes += 1
      tx.update(snapshot.ref, { ...update, updatedAt: FieldValue.serverTimestamp() })
    }
    return routes > 0 ? { status: 'restored', routes } : { status: 'unchanged' }
  }))
}
