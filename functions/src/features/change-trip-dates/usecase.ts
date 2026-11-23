import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { tripOrigin } from '../../domain/tripOrigin'
import { memberJoin, ownerUid } from '../../domain/tripOwner'
import type { FlightsPort } from '../../ports/flights'
import { decideChangeDates, routeWithDates } from './logic'

export interface ChangeTripDatesInput {
  tripId: string
  uid: string
  startDate: string
  /** 日帰りなら null */
  endDate: string | null
}

export type ChangeTripDatesResult =
  /** leftOut は今回外した場所の数、restored は前に外していて今回しおりに戻した場所の数 */
  | { status: 'changed'; leftOut: number; restored: number }
  | { status: 'unchanged' | 'not-member' | 'not-found' | 'not-owner' | 'confirmed' }

/**
 * 旅の日程を変え、しおりを新しい日程で組み直す。読む → logic で決める → 書く（企画書「ユーザー体験」の発案者。Lazyturtle0852 の決定、2026-11-22）。
 * 変えられるのは発案者だけ（domain/tripOwner.ts）。旅程が確定しているあいだは変えない。
 * 日数が減って入りきらない場所は、しおりから外して leftOutPinIds に残す（建物は消さない）。前に外した場所は、時間に収まれば戻す（logic.ts の routeWithDates）。
 * 外の API は、飛行機の区間があるときに、新しい日付で便を決め直すための時刻表（ODPT）を読むだけ（searchingFlights。そのときはトランザクションをやり直す）
 */
export async function changeTripDates(
  ports: { db: Firestore; flights: FlightsPort },
  input: ChangeTripDatesInput,
): Promise<ChangeTripDatesResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<ChangeTripDatesResult> => {
    const [tripNow, membersNow, routes, pins] = await Promise.all([
      tx.get(tripRef), tx.get(tripRef.collection('members')), tx.get(tripRef.collection('routes')),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    const trip = tripNow.data() as Trip | undefined
    const members = membersNow.docs.map((doc) => memberJoin(doc.id, doc.data()))
    const decision = decideChangeDates({
      isMember: members.some((member) => member.uid === input.uid),
      isOwner: ownerUid(members) === input.uid,
      tripExists: Boolean(trip),
      confirmed: trip ? isConfirmed(trip) : false,
      same: trip?.startDate === input.startDate && (trip?.endDate ?? null) === input.endDate,
    })
    if (decision !== 'change' || !trip) return { status: decision === 'change' ? 'not-found' : decision }

    const before = tripDays(trip.startDate, trip.endDate)
    const days = tripDays(input.startDate, input.endDate)
    const origin = tripOrigin({ ...trip, startDate: input.startDate })
    const places = pins.docs.map((doc) => planPlace(doc.id, doc.data() as Pin))
    // 今回外した場所（ピンの ID）。案が複数ある旅でも、同じ場所を 2 回数えない
    const leftOut = new Set<string>()
    const restored = new Set<string>()
    for (const doc of routes.docs) {
      const route = doc.data() as Route
      // 日付が変わると便も変わるので、飛行機の区間の便は新しい日付で決め直す
      const update = routeWithDates(route, places, origin, days, days < before, search(origin, input.startDate, route.legFlights, true))
      for (const id of update.leftOutPinIds ?? []) if (!route.leftOutPinIds?.includes(id)) leftOut.add(id)
      for (const id of route.leftOutPinIds ?? []) if (!update.leftOutPinIds?.includes(id) && update.pinIds.includes(id)) restored.add(id)
      tx.update(doc.ref, { ...update, updatedAt: FieldValue.serverTimestamp() })
    }
    tx.update(tripRef, { startDate: input.startDate, endDate: input.endDate, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', leftOut: leftOut.size, restored: restored.size }
  }))
}
