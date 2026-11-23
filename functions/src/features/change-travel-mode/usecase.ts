import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import type { TravelMode } from '../../domain/travelMode'
import { tripOrigin } from '../../domain/tripOrigin'
import type { FlightsPort } from '../../ports/flights'
import { routeWithMode } from './logic'

export type ChangeTravelModeResult = { status: 'changed' | 'unchanged' | 'not-member' | 'not-found' | 'confirmed' }

/**
 * 旅の移動手段（車、電車・バス）を選び直し、しおりの時刻と移動時間を計算し直す。メンバーなら誰でもできる（幹事だけにしない）。
 * 外部の API は、飛行機の区間があるときに、便を決め直すための時刻表（ODPT）を読むだけ（searchingFlights。そのときはトランザクションをやり直す）。
 * 電車・バスは domain/transit.ts、車は直線距離の式。車の Routes の時間は、開いたときに features/shiori-travel が出す
 */
export async function changeTravelMode(
  ports: { db: Firestore; flights: FlightsPort },
  input: { tripId: string; uid: string; mode: TravelMode },
): Promise<ChangeTravelModeResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const memberRef = tripRef.collection('members').doc(input.uid)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<ChangeTravelModeResult> => {
    const [tripNow, memberNow, routes, pins] = await Promise.all([
      tx.get(tripRef), tx.get(memberRef), tx.get(tripRef.collection('routes')),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    const trip = tripNow.data() as Trip | undefined
    if (!memberNow.exists) return { status: 'not-member' as const }
    if (!trip) return { status: 'not-found' as const }
    // 旅程が確定しているあいだは、旅全体の手段を変えない（features/confirm-shiori）
    if (isConfirmed(trip)) return { status: 'confirmed' as const }
    if (trip.travelMode === input.mode) return { status: 'unchanged' as const }
    const origin = { ...tripOrigin(trip), travelMode: input.mode }
    const places = pins.docs.map((doc) => ({ ...doc.data() as Pin, id: doc.id }))
    const days = tripDays(trip.startDate, trip.endDate)
    for (const doc of routes.docs) {
      const route = doc.data() as Route
      // 空港まで・空港からの移動は旅全体の手段で見積もるので、手段が変わったら便を決め直す
      tx.update(doc.ref, { ...routeWithMode(route, places, origin, days, search(origin, trip.startDate, route.legFlights, true)), updatedAt: FieldValue.serverTimestamp() })
    }
    tx.update(tripRef, { travelMode: input.mode, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed' as const }
  }))
}
