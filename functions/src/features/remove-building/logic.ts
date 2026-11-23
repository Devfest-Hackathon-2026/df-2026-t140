import type { Route } from '../../domain/route'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming } from '../../domain/routePlan'
import { pinOfStop, visitOrder } from '../../domain/visit'

// 建物を消したあとのしおりの、純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** 消した場所を外したあとのルート。変わる項目だけ（しおりから外していた場所を消したときは、leftOutPinIds だけ） */
export type RemovalUpdate = Partial<Pick<
  Route,
  'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'leftOutPinIds'
>>

/**
 * 1 本のルートを、どう変えるか。
 * - unchanged：その場所を含まない（しおりにも、日程を縮めて外した場所にもない）
 * - delete：場所が 1 つもなくなった、計画中の旅のしおり。消しておけば、次に建ったときに作り直される（features/propose-routes）
 * - update：残りの場所を、今の順番のまま時刻と日の分け方を計算し直す
 */
export type RouteAfterRemoval = { kind: 'unchanged' } | { kind: 'delete' } | { kind: 'update'; update: RemovalUpdate }

/**
 * しおりから 1 つの場所を外し、残りの順で時刻と日の分け方を計算し直す（企画書「ユーザー体験」3-6「建った建物を消せる」）。
 * - ほかの場所の順番は変えない。日の分け方は、しおりと同じく、その日の 19 時までに入るかで決める（domain/routePlan.ts の dayPacker）
 * - 時刻は、そのルートの時間の決め（滞在、出発の時刻）のまま、直線距離の目安で計算し直す（しおりの入れ替えと同じ）
 * - 建っていない（消えた）ほかの場所も、ついでに飛ばす
 * places は、消す場所を除いた、建った場所のすべて（順は問わない）。
 * deletable は、場所がなくなったら消してよいルートか（計画中の旅のしおり）。
 * flights を渡すと、便が決まっていない・乗れなくなった飛行機の区間の便を探す（domain/flightPlanner.ts の searchingFlights）。
 */
export function routeAfterRemoval(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging' | 'leftOutPinIds'>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  pinId: string,
  deletable: boolean,
  flights?: FlightChoices,
): RouteAfterRemoval {
  // 日程を縮めてしおりから外した場所なら、その印だけを消す
  const leftOut = route.leftOutPinIds?.includes(pinId) ? { leftOutPinIds: route.leftOutPinIds.filter((id) => id !== pinId) } : {}
  if (!route.pinIds.includes(pinId)) return route.leftOutPinIds?.includes(pinId) ? { kind: 'update', update: leftOut } : { kind: 'unchanged' }
  // 同じ場所を何度も訪れるしおりでは、その場所の行をすべて外す
  const order = visitOrder(route.pinIds.filter((id) => pinOfStop(id) !== pinId), places)
  if (order.length === 0 && deletable) return { kind: 'delete' }
  return {
    kind: 'update',
    update: {
      // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
      ...buildPlan(order, origin, days, routeTiming(route), undefined, route.legModes, flights ?? { saved: route.legFlights }),
      revision: (route.revision ?? 0) + 1,
      addedPinIds: (route.addedPinIds ?? []).filter((id) => id !== pinId),
      ...leftOut,
    },
  }
}
