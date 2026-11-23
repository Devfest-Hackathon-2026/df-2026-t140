import { FieldValue } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { tripOrigin } from '../../domain/tripOrigin'
import { routeWithVisitAdded, routeWithVisitRemoved } from './logic'
import type { RepeatVisitPorts } from './ports'
import type { RepeatVisitInput, RepeatVisitResult } from './types'

/**
 * しおりの行のすぐ下に同じ場所の行を足す、または同じ場所の行を 1 つ消して、保存する。読む → logic で決める → 書く。
 * しおりの場所の行の複製ボタンと「この行を消す」ボタンから、画面が呼ぶ（企画書「ユーザー体験」3-6、#528）。
 *
 * 1 つのトランザクションで、メンバーか、ルートと建った場所を読み、足した（消した）順で計算し直して書く。
 * できるのは旅のメンバーなら誰でも（行を動かすのと同じく、仮に全員）。旅程が確定しているあいだは断る。
 * 組み直して、便が決まっていない・乗れなくなった飛行機の区間ができたら、時刻表を読んで便を探す（searchingFlights。そのときはトランザクションをやり直す）
 */
export async function repeatVisit(ports: RepeatVisitPorts, input: RepeatVisitInput): Promise<RepeatVisitResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<RepeatVisitResult> => {
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
    // 旅程が確定しているあいだは、行を足さない・消さない（features/confirm-shiori）
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const places = pinsSnapshot.docs.map((snapshot) => {
      const pin = snapshot.data() as Pin
      return planPlace(snapshot.id, pin)
    })
    const origin = tripOrigin(trip)
    const change = input.remove ? routeWithVisitRemoved : routeWithVisitAdded
    const update = change(route, places, origin, tripDays(trip.startDate, trip.endDate), input.stopId, search(origin, trip.startDate, route.legFlights))
    if (typeof update === 'string') return { status: update }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  }))
}
