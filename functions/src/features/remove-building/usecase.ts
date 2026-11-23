import { FieldValue } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import { tripOrigin } from '../../domain/tripOrigin'
import type { Pin } from '../../domain/pin'
import { type Route, SHIORI_ROUTE_ID } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { routeAfterRemoval } from './logic'
import type { RemoveBuildingPorts } from './ports'
import type { RemoveBuildingInput, RemoveBuildingResult } from './types'

/**
 * 建った建物を消す。読む → logic で決める → 書く。
 * 地図で建物を押して出る場所カードの「建物を消す」から、画面が呼ぶ（企画書「ユーザー体験」3-6）。
 *
 * 1 つのトランザクションで、メンバーか、ピン、旅のルート、建った場所を読み、
 * ピンと模型（model/current）を消して、その場所を含むルートから外し、残りの順で計算し直して書く。
 * 全員の画面は、ピンとルートの購読で変わる（地図の模型が消え、しおりが組み直される）。
 * 消せるのは旅のメンバーなら誰でも（誰ができるかは決めていない。企画書「まだ決めていないこと」。仮に全員）。
 * 消すと、建てた数（20 棟まで）からも外れる。
 * 消したあとに、便が決まっていない・乗れなくなった飛行機の区間ができたら、時刻表を読んで便を探す（searchingFlights。そのときはトランザクションをやり直す）
 */
export async function removeBuilding(ports: RemoveBuildingPorts, input: RemoveBuildingInput): Promise<RemoveBuildingResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const pinRef = tripRef.collection('pins').doc(input.pinId)
  const modelRef = pinRef.collection('model').doc('current')
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<RemoveBuildingResult> => {
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
    // 旅程が確定しているあいだは、建物を消さない（features/confirm-shiori）
    if (isConfirmed(trip)) return { status: 'confirmed' }

    const places = pinsSnapshot.docs
      .filter((snapshot) => snapshot.id !== input.pinId)
      .map((snapshot) => {
        const place = snapshot.data() as Pin
        return planPlace(snapshot.id, place)
      })
    const origin = tripOrigin(trip)
    const days = tripDays(trip.startDate, trip.endDate)
    let routes = 0
    for (const snapshot of routesSnapshot.docs) {
      const route = snapshot.data() as Route
      const deletable = snapshot.id === SHIORI_ROUTE_ID && trip.status === 'planning'
      const next = routeAfterRemoval(route, places, origin, days, input.pinId, deletable, search(origin, trip.startDate, route.legFlights))
      if (next.kind === 'unchanged') continue
      routes += 1
      if (next.kind === 'delete') tx.delete(snapshot.ref)
      else tx.update(snapshot.ref, { ...next.update, updatedAt: FieldValue.serverTimestamp() })
    }
    tx.delete(modelRef)
    tx.delete(pinRef)
    return { status: 'removed', routes }
  }))
}
