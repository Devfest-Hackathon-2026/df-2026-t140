import type { DocumentReference } from 'firebase-admin/firestore'
import { tripOrigin } from '../../domain/tripOrigin'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { planPlace, travelLegs, tripDays } from '../../domain/routePlan'
import type { Trip } from '../../domain/trip'
import { travelModeOf } from '../../domain/travelMode'
import { legPathsOf, replan, routeOrder, sampleLegPaths, travelGate } from './logic'
import type { ShioriTravelPorts } from './ports'
import type { ShioriTravelInput, ShioriTravelResult } from './types'

/**
 * しおりを開いた人に、Routes API（車）の移動時間で計算し直したスケジュールを返す。読む → 聞く → 計算して返す。何も書かない。
 *
 * 規約で、Routes の時間は保存できない（Service Specific Terms 19.3、Terms of Service 3.2.3(a)(b)）。
 * そのため、保存するしおり（features/propose-routes）はいつも直線距離の目安で作り、Routes の時間は画面に返すだけにする
 * （チームの決定、2026-11-08。todo/humans/2026-11-07-shiori-routes-api.md）。
 *
 * Routes を聞くのは、呼べる設定（キーがあり、Emulator でない）で、開いた人が旅のメンバーで、合言葉を通しているか、
 * 全員に開く切り替え（settings/ai の openToAll）が入っているときだけ（切り替えで開くのはヨウキンの決定、2026-11-08、#165）。
 * 1 回開くたびに 1 回（出発地と場所を経由地として 1 回で渡す）。1 日の回数は Google Cloud の Routes の上限で止まる
 */
export async function shioriTravel(ports: ShioriTravelPorts, input: ShioriTravelInput): Promise<ShioriTravelResult> {
  const { db, aiGate, routesApi } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const [tripSnapshot, memberSnapshot, routeSnapshot] = await Promise.all([
    tripRef.get(),
    tripRef.collection('members').doc(input.uid).get(),
    tripRef.collection('routes').doc(input.routeId).get(),
  ])
  const trip = tripSnapshot.data() as Trip | undefined
  const route = routeSnapshot.data() as Route | undefined
  // 電車・バスと飛行機の旅は、車の Routes を聞かない（回数も使わない）。保存してある見積もりをそのまま出す
  if (memberSnapshot.exists && trip && route && travelModeOf(trip) !== 'car') return { status: 'estimate', reason: 'transit' }
  // 開発環境（Emulator）では Routes を呼ばず、見本の曲線を返す（見た目を確かめるため。時刻は保存してある目安のまま。合言葉は見ない）
  if (routesApi.sampleMode() && memberSnapshot.exists && trip && route) {
    const sampleOrder = await builtOrder(tripRef, route)
    const legs = travelLegs(sampleOrder, tripOrigin(trip))
    return {
      status: 'routes',
      pinIds: route.pinIds,
      revision: route.revision ?? 0,
      schedule: route.schedule,
      totalMoveMinutes: route.totalMoveMinutes,
      legPaths: sampleLegPaths(legs.points, legs.keys),
      sample: true,
    }
  }
  const enabled = routesApi.enabled()
  // 合言葉の記録は、前の条件がそろったときだけ読む
  const unlocked = memberSnapshot.exists && trip && route && enabled ? await travelAllowed(aiGate, input.uid) : false
  const refused = travelGate({ member: memberSnapshot.exists, found: Boolean(trip && route), enabled, unlocked: () => unlocked })
  if (refused || !trip || !route) return refused ?? { status: 'not-found' }

  const order = await builtOrder(tripRef, route)
  const origin = tripOrigin(trip)
  const { points, keys } = travelLegs(order, origin)
  if (keys.length === 0) return { status: 'estimate', reason: 'unavailable' }

  const legs = await routesApi.legs(points)
  const plan = legs ? replan(route, order, origin, tripDays(trip.startDate, trip.endDate), legs.seconds) : null
  if (!legs || !plan) return { status: 'estimate', reason: 'unavailable' }
  return { status: 'routes', pinIds: route.pinIds, revision: route.revision ?? 0, ...plan, legPaths: legPathsOf(keys, legs.paths) }
}

/**
 * 開いた人に Routes の時間を出してよいか（テストのために export する）。全員に開く切り替えが入っていれば、合言葉は見ない
 * （suggest-places の permitFor と同じ見方）
 */
export async function travelAllowed(aiGate: ShioriTravelPorts['aiGate'], uid: string): Promise<boolean> {
  return (await aiGate.isOpenToAll()) || (await aiGate.isUnlocked(uid))
}

/** しおりの回る順に、建った場所を並べる（Firestore を読む） */
async function builtOrder(tripRef: DocumentReference, route: Route) {
  const pinsSnapshot = await tripRef.collection('pins').where('status', '==', 'done').get()
  const places = pinsSnapshot.docs.map((snapshot) => {
    const pin = snapshot.data() as Pin
    return planPlace(snapshot.id, pin)
  })
  return routeOrder(route, places)
}
