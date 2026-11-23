import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { FlightsPort } from '../../ports/flights'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { MEET_KEY, ORIGIN_KEY, planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { memberJoin, ownerUid } from '../../domain/tripOwner'
import { tripOrigin } from '../../domain/tripOrigin'
import { searchingFlights } from '../../domain/flightPlanner'
import { visitOrder } from '../../domain/visit'
import { clashesWith, isEventTime, keepMeetBeforeDepart, newClashes, routeWithStopTime } from './logic'

export interface SetStopTimeInput {
  tripId: string
  routeId: string
  uid: string
  /** 直す時刻。集合時間は @meet、出発地を出る時間は @origin、場所に着く時刻はその行の ID（ふつうはピンの ID。domain/visit.ts）、場所を出る時刻は行の ID@leave */
  key: string
  /** 0 時からの分（0 〜 1439） */
  minutes: number
  /** 時刻が決まったイベントの時間と重なっても直す（人が確認のダイアログで「このまま変える」を選んだ）。#581 */
  force?: boolean
}

export type SetStopTimeResult =
  | { status: 'changed'; revision: number }
  /** 直すと、イベント（names）の時間と重なる。まだ書いていない。人が確かめたら force を付けて呼び直す */
  | { status: 'clash'; names: string[] }
  | { status: 'not-member' | 'not-found' | 'confirmed' | 'stale' | 'fixed' }

/**
 * しおりの時刻を人が直し、しおりを組み直して保存する。読む → logic で決める → 書く。
 * メンバーなら誰でもできる（幹事だけにしない）。旅程が確定しているあいだは、発案者だけができる（features/confirm-shiori）。
 * 場所が今のしおりにない（ほかの人が消した）ときは stale。
 * 飛行機の区間があれば、直した時刻から便を選び直す（ANA・JAL の時刻表。取れなければ残してある便か目安）。
 * 集合時間だけを直したときは、出発時間がずれる（集合を出発より遅くした）ときだけ便を選び直す。ずれなければほかの時刻は変わらないので、残してある便を使う。
 * 選び直さないときも、便が決まっていない飛行機の区間があれば便を探す。
 * 時刻表を読むのは、便を決める飛行機の区間があるときだけ（searchingFlights。トランザクションの外で読み、トランザクションをやり直す）。
 * 時刻が決まったイベントの行の時刻は直せない（fixed）。直すと、前は重なっていなかったイベントの時間と重なるときは、force がなければ書かずに clash を返す（#581）
 */
export async function setStopTime(ports: { db: Firestore; flights: FlightsPort }, input: SetStopTimeInput): Promise<SetStopTimeResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const routeRef = tripRef.collection('routes').doc(input.routeId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<SetStopTimeResult> => {
    const [tripSnapshot, membersSnapshot, routeSnapshot, pinsSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members')),
      tx.get(routeRef),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    const members = membersSnapshot.docs.map((doc) => memberJoin(doc.id, doc.data()))
    if (!members.some((member) => member.uid === input.uid)) return { status: 'not-member' }
    const trip = tripSnapshot.data() as Trip | undefined
    const route = routeSnapshot.data() as Route | undefined
    if (!trip || !route) return { status: 'not-found' }
    if (isConfirmed(trip) && ownerUid(members) !== input.uid) return { status: 'confirmed' }
    const places = pinsSnapshot.docs.map((snapshot) => {
      const pin = snapshot.data() as Pin
      return planPlace(snapshot.id, pin)
    })
    const order = visitOrder(route.pinIds, places)
    const origin = tripOrigin(trip)
    if (isEventTime(order, input.key)) return { status: 'fixed' }
    const days = tripDays(trip.startDate, trip.endDate)
    // 出発からあとの時刻が動くなら、全部の飛行機の区間の便を、組み直した時刻から選び直す
    const flights = search(origin, trip.startDate, route.legFlights, movesDepart(route, input))
    const update = routeWithStopTime(route, order, origin, days, input.key, input.minutes, flights)
    if (update === 'stale') return { status: 'stale' }
    if (!input.force) {
      const clashes = newClashes(clashesWith(route, order, origin, days, route.stopTimes), clashesWith({ ...update, style: route.style }, order, origin, days, update.stopTimes))
      if (clashes.length > 0) return { status: 'clash', names: clashes.map((id) => order.find((place) => place.id === id)?.name ?? id) }
    }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  }))
}

/** この直しで、出発からあとの時刻が動くか。集合時間の直しは、出発をずらすときだけ動く（logic の keepMeetBeforeDepart） */
function movesDepart(route: Pick<Route, 'style' | 'stopTimes'>, input: Pick<SetStopTimeInput, 'key' | 'minutes'>): boolean {
  if (input.key !== MEET_KEY) return true
  return keepMeetBeforeDepart(route, input.key, input.minutes)[ORIGIN_KEY] !== route.stopTimes?.[ORIGIN_KEY]
}
