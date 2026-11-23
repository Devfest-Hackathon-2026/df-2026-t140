import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { tripOrigin } from '../../domain/tripOrigin'
import type { FlightsPort } from '../../ports/flights'
import { lodgingAfterSkip, routeWithSameLodging } from './logic'

export interface SetLodgingInput {
  tripId: string
  routeId: string
  uid: string
  /** 何日目の夜か（1 日目の夜が 1） */
  night: number
  /** true：宿を取らない夜にする。false：それを取り消す（点線の枠に戻す） */
  skip: boolean
  /** 自分で書いた過ごし方（「車中泊」）。なければ null */
  note: string | null
}

export type SetLodgingResult = { status: 'changed'; revision: number } | { status: 'unchanged' | 'not-member' | 'not-found' | 'confirmed' | 'invalid' | 'decided' }

/**
 * しおりの宿の枠で宿を取らない夜にすることと、その取り消し。読む → logic で決める → 書く。
 * メンバーなら誰でもできる（幹事だけにしない）。旅程が確定しているあいだは変えられない（confirmed）。宿を建物で決めるほうは、建ったときに features/propose-routes が入れる
 */
export async function setLodging(ports: { db: Firestore }, input: SetLodgingInput): Promise<SetLodgingResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const routeRef = tripRef.collection('routes').doc(input.routeId)
  return db.runTransaction(async (tx): Promise<SetLodgingResult> => {
    const [tripSnapshot, memberSnapshot, routeSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members').doc(input.uid)),
      tx.get(routeRef),
    ])
    if (!memberSnapshot.exists) return { status: 'not-member' }
    const trip = tripSnapshot.data() as Trip | undefined
    const route = routeSnapshot.data() as Route | undefined
    if (!trip || !route) return { status: 'not-found' }
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const update = lodgingAfterSkip(route, tripDays(trip.startDate, trip.endDate), input.night, input.skip, input.note)
    if (typeof update === 'string') return { status: update }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  })
}

export interface SameLodgingInput {
  tripId: string
  routeId: string
  uid: string
  /** 何日目の夜を、前の夜と同じ宿にするか（2 日目の夜から） */
  night: number
}

export type SameLodgingResult =
  | { status: 'changed'; revision: number }
  | { status: 'not-member' | 'not-found' | 'confirmed' | 'invalid' | 'decided' | 'no-previous' | 'stale' | 'full' }

/**
 * しおりの宿の枠で、その夜を前の夜と同じ宿にする（同じ宿に 2 泊以上する）。読む → logic で決める → 書く。
 * メンバーなら誰でもできる。旅程が確定しているあいだは変えられない（confirmed）。
 * 前の夜の宿の行を複製して、この夜の宿にする（logic の routeWithSameLodging）。組み直して、便が決まっていない・乗れなくなった
 * 飛行機の区間ができたら、時刻表を読んで便を探す（searchingFlights。そのときはトランザクションをやり直す。features/repeat-visit と同じ）
 */
export async function sameLodging(ports: { db: Firestore; flights: FlightsPort }, input: SameLodgingInput): Promise<SameLodgingResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<SameLodgingResult> => {
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
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const places = pinsSnapshot.docs.map((snapshot) => planPlace(snapshot.id, snapshot.data() as Pin))
    const origin = tripOrigin(trip)
    const update = routeWithSameLodging(route, places, origin, tripDays(trip.startDate, trip.endDate), input.night, search(origin, trip.startDate, route.legFlights))
    if (typeof update === 'string') return { status: update }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  }))
}
