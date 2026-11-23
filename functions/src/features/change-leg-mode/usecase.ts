import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { FlightsPort } from '../../ports/flights'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, travelKey, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import type { LegMode } from '../../domain/travelMode'
import { tripOrigin } from '../../domain/tripOrigin'
import { searchingFlights } from '../../domain/flightPlanner'
import { visitOrder } from '../../domain/visit'
import { flightPlanner, routeWithLegMode } from './logic'

export interface ChangeLegModeInput {
  tripId: string
  routeId: string
  uid: string
  /** 区間の出発（建った場所の ID か、出発地の @origin） */
  from: string
  /** 区間の行き先（建った場所の ID） */
  to: string
  /** null なら、その区間の選択を外して旅全体の手段に戻す */
  mode: LegMode | null
}

export type ChangeLegModeResult =
  | { status: 'changed'; revision: number }
  | { status: 'not-member' | 'not-found' | 'confirmed' | 'stale' | 'too-far' | 'too-near' }

/**
 * しおりの移動の行で、区間ごとの手段を選び直し、しおりを組み直して保存する。読む → logic で決める → 書く。
 * メンバーなら誰でもできる（幹事だけにしない）。区間が今のしおりにない（ほかの人が順番を入れ替えた）ときは stale。
 * 直線 10 km（WALK_MAX_KM）より遠い区間の徒歩は too-far、直線 200 km（PLANE_MIN_KM）より近い区間の飛行機は too-near で断る。
 * 飛行機を選んだときは、ANA・JAL の時刻表（ODPT）から便を決め、便の要約をルートに残す（時刻表そのものは残さない）。
 * ほかの手段を選んだときも、時刻がずれて、ほかの飛行機の区間の便に乗れなくなったら（または便が決まっていない区間があれば）、時刻表を読んで便を探す
 * （searchingFlights。そのときはトランザクションをやり直す）。
 * ほかの外部の API は呼ばない（車の Routes の時間は、開いたときに features/shiori-travel が出す）
 */
export async function changeLegMode(ports: { db: Firestore; flights: FlightsPort }, input: ChangeLegModeInput): Promise<ChangeLegModeResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  // 飛行機を選んだときは、いつも時刻表を読む（トランザクションの外で。キーがない、取れないときは null で、距離の式の目安になる）
  const timetable = input.mode === 'plane' ? await ports.flights.timetable() : null
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<ChangeLegModeResult> => {
    const routeRef = tripRef.collection('routes').doc(input.routeId)
    const [tripSnapshot, memberSnapshot, routeSnapshot, pinsSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members').doc(input.uid)),
      tx.get(routeRef),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    if (!memberSnapshot.exists) return { status: 'not-member' }
    const trip = tripSnapshot.data() as Trip | undefined
    const route = routeSnapshot.data() as Route | undefined
    if (!trip || !route) return { status: 'not-found' }
    // 旅程が確定しているあいだは、区間の手段を変えない（features/confirm-shiori）
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const places = pinsSnapshot.docs.map((snapshot) => {
      const pin = snapshot.data() as Pin
      return planPlace(snapshot.id, pin)
    })
    const order = visitOrder(route.pinIds, places)
    const origin = tripOrigin(trip)
    // 区間の既定と同じ手段を選んだら、この区間の選択を外す（logic で決める。画面を通さずに呼ばれても同じにする）
    // 飛行機を選んだときは、押した区間の便を時刻表から決め直す（既定が飛行機の区間でも探す）。
    // ほかの飛行機の区間は、残してある便に乗れればそれを使い、便が決まっていない・乗れなくなった区間だけ探す
    const flights = input.mode === 'plane'
      ? { plan: flightPlanner(timetable, origin, trip.startDate), planKey: travelKey(input.from, input.to), saved: route.legFlights }
      : search(origin, trip.startDate, route.legFlights)
    const update = routeWithLegMode(route, order, origin, tripDays(trip.startDate, trip.endDate), input.from, input.to, input.mode, flights)
    if (update === 'stale' || update === 'too-far' || update === 'too-near') return { status: update }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  }))
}
