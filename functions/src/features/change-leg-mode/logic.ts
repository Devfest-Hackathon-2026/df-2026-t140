import { defaultLegMode, PLANE_MIN_KM } from '../../domain/flight'
import type { Route } from '../../domain/route'
import {
  buildPlan,
  distanceKm,
  type FlightChoices,
  type PlanOrigin,
  type PlanPlace,
  routeTiming,
  travelKey,
  travelLegs,
} from '../../domain/routePlan'
import { type LegMode, WALK_MAX_KM } from '../../domain/travelMode'

// しおりの移動の行で、区間ごとの手段を選び直すときの、純粋な決め。Emulator なしで試せる（scripts/transit.test.mjs）

// pinIds は、buildPlan が返すしおりの行の順（夜景を日の最後へ、宿に間に合わない場所を宿のあとへ回したあと）。直すたびに保存する順番も行の順にそろう（#602）
export type LegModeUpdate = Pick<Route, 'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes'>

/**
 * 区間（from → to）の手段を mode にして、しおりを組み直す。mode が null か区間の既定と同じなら、その区間の選択を外す（区間の既定に戻す）。
 * order は、今のしおりの回る順に並べた建った場所。区間が今のしおりにない（順番が変わった）ときは 'stale'。
 * 徒歩を選んだのに区間が WALK_MAX_KM より遠いときは 'too-far'、飛行機を選んだのに PLANE_MIN_KM より近いときは 'too-near'。
 * flights.plan を渡すと、飛行機の区間の便をその場で決め直す（時刻表から。なければ残してある便）
 */
export function routeWithLegMode(
  route: Pick<Route, 'style' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>,
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  from: string,
  to: string,
  mode: LegMode | null,
  flights?: FlightChoices,
): LegModeUpdate | 'stale' | 'too-far' | 'too-near' {
  const key = travelKey(from, to)
  const { points, keys } = travelLegs(order, origin)
  const index = keys.indexOf(key)
  if (index < 0) return 'stale'
  if (mode === 'walk' && distanceKm(points[index], points[index + 1]) > WALK_MAX_KM) return 'too-far'
  if (mode === 'plane' && distanceKm(points[index], points[index + 1]) < PLANE_MIN_KM) return 'too-near'
  // 区間の既定（遠い区間と島への区間は飛行機、ほかは旅全体の手段）と同じ手段を選んだら、この区間の選択を外す
  const fallback = defaultLegMode(points[index], points[index + 1], origin.travelMode ?? 'car')
  const legModes: Record<string, LegMode> = { ...(route.legModes ?? {}) }
  if (mode && mode !== fallback) legModes[key] = mode
  else delete legModes[key]
  const plan = buildPlan(order, origin, days, routeTiming(route), undefined, legModes, flights ?? { saved: route.legFlights })
  return { ...plan, legModes: plan.legModes ?? {}, legFlights: plan.legFlights ?? {}, revision: (route.revision ?? 0) + 1 }
}

// 便を決める planner は、時刻を直す機能（set-stop-time）も使うので domain に置いた。前からの読み込み口として出し直す
export { dateOfDay, flightPlanner } from '../../domain/flightPlanner'
