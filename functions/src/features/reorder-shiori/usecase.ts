import { FieldValue } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import { tripOrigin } from '../../domain/tripOrigin'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { moveStop } from './logic'
import type { ReorderShioriPorts } from './ports'
import type { ReorderShioriInput, ReorderShioriResult } from './types'

/**
 * しおりの行を、落とした先の行の位置に差し込んで保存する。読む → logic で決める → 書く。
 * しおりの行を取り（指は長押し、マウスはドラッグ）、別の行に落としたときに、画面が呼ぶ（企画書「ユーザー体験」3-6）。
 *
 * 1 つのトランザクションで、メンバーか、ルートと建った場所を読み、入れ替えた順で計算し直して書く。
 * 同時に建物が建って足された（features/propose-routes）ときも、読み直してから入れ替える。
 * 入れ替えられるのは旅のメンバーなら誰でも（誰ができるかは決めていない。企画書「まだ決めていないこと」。仮に全員）。
 * 入れ替えで、便が決まっていない・乗れなくなった飛行機の区間ができたら、時刻表を読んで便を探す（searchingFlights。そのときはトランザクションをやり直す）
 */
export async function reorderShiori(ports: ReorderShioriPorts, input: ReorderShioriInput): Promise<ReorderShioriResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<ReorderShioriResult> => {
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
    // 旅程が確定しているあいだは、行く順番を変えない（features/confirm-shiori）
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const places = pinsSnapshot.docs.map((snapshot) => {
      const pin = snapshot.data() as Pin
      return planPlace(snapshot.id, pin)
    })
    const origin = tripOrigin(trip)
    const update = moveStop(
      route,
      places,
      origin,
      tripDays(trip.startDate, trip.endDate),
      input.fromPinId,
      input.toPinId,
      search(origin, trip.startDate, route.legFlights),
    )
    if (!update) return { status: 'invalid' }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'reordered', revision: update.revision }
  }))
}
