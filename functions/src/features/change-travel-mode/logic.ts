import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { defaultLegMode } from '../../domain/flight'
import { groundMode } from '../../domain/travelMode'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, planPlace, routeTiming, travelLegs } from '../../domain/routePlan'
import { visitOrder } from '../../domain/visit'

// 旅の移動手段を選び直したときの、純粋な計算。Emulator なしで試せる（scripts/transit.test.mjs）

/**
 * 回る順番と滞在は保ったまま、新しい移動手段で時刻と移動時間を計算し直す。origin.travelMode が新しい移動手段。
 * 区間ごとに選んだ手段は残す。ただし、区間の既定（新しい旅全体の手段か、遠い区間と島への区間は飛行機）と同じになった区間の選択は外す（「この区間だけ」の印が残って外せなくならないように）。
 * flights を渡すと、飛行機の区間の便を、新しい手段での空港までの移動で決め直す（domain/flightPlanner.ts の searchingFlights）
 * 返す pinIds は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）。保存する順番も行の順にそろう
 */
export function routeWithMode(route: Route, pins: readonly (Pin & { id: string })[], origin: PlanOrigin, days: number, flights?: FlightChoices) {
  const order = visitOrder(route.pinIds, pins.map((pin) => planPlace(pin.id, pin)))
  return {
    ...buildPlan(order, origin, days, routeTiming(route), undefined, differentModes(route.legModes, order, origin), flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
  }
}

/**
 * 区間の既定（遠い区間と島への区間は飛行機、ほかは新しい旅全体の手段）と違う区間の選択だけを残す（legModes がなければ undefined のまま）。
 * 今の順番にない区間は、ここでは外さない（buildPlan が外す）
 */
function differentModes(legModes: Route['legModes'], order: readonly PlanPlace[], origin: PlanOrigin): Route['legModes'] {
  if (!legModes) return undefined
  const { points, keys } = travelLegs(order, origin)
  const tripMode = origin.travelMode ?? 'car'
  return Object.fromEntries(
    Object.entries(legModes).filter(([key, mode]) => {
      const index = keys.indexOf(key)
      const fallback = index < 0 ? groundMode(tripMode) : defaultLegMode(points[index], points[index + 1], tripMode)
      return mode !== fallback
    }),
  )
}
