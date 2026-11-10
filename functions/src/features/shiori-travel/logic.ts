import type { LatLng } from '../../domain/pin'
import type { Route } from '../../domain/route'
import type { ShioriTravelResult } from './types'
import { buildPlan, type PlanOrigin, type PlanPlace, STYLE_TIMINGS, travelLegs, travelTable } from '../../domain/routePlan'

// しおりの移動時間を Routes で計算し直す、純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** ルートの回る順に、建った場所を並べる。建っていない（消えた）場所は飛ばす */
export function routeOrder(route: Pick<Route, 'pinIds'>, places: readonly PlanPlace[]): PlanPlace[] {
  const placeOf = new Map(places.map((place) => [place.id, place]))
  return route.pinIds.flatMap((id) => placeOf.get(id) ?? [])
}

/**
 * Routes の区間ごとの秒から、スケジュールを計算し直す。区間のどれも取れなければ null（目安のまま）。
 * 取れなかった区間だけは、直線距離の目安で埋める
 */
export function replan(
  route: Pick<Route, 'style'>,
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  legSeconds: readonly (number | null)[],
): Pick<Route, 'schedule' | 'totalMoveMinutes'> | null {
  const { keys } = travelLegs(order, origin)
  const table = travelTable(keys, legSeconds)
  if (table.size === 0) return null
  const plan = buildPlan(order, origin, days, STYLE_TIMINGS[route.style] ?? STYLE_TIMINGS.shortest, table)
  return { schedule: plan.schedule, totalMoveMinutes: plan.totalMoveMinutes }
}

/**
 * Routes を聞いてよいか。聞いてよければ null、だめなら返す結果。
 * 順に、メンバーか、しおりがあるか、呼べる設定か（キーがあり Emulator でない）、開いた人が合言葉を通しているか
 */
export function travelGate(state: {
  member: boolean
  found: boolean
  enabled: boolean
  unlocked: () => boolean
}): Exclude<ShioriTravelResult, { status: 'routes' }> | null {
  if (!state.member) return { status: 'not-member' }
  if (!state.found) return { status: 'not-found' }
  if (!state.enabled) return { status: 'estimate', reason: 'off' }
  if (!state.unlocked()) return { status: 'estimate', reason: 'locked' }
  return null
}

/** 取れた区間の道の形を、区間のキーと組にする（取れなかった区間は入れない。画面はその区間をまっすぐ結ぶ） */
export function legPathsOf(keys: readonly string[], paths: readonly (LatLng[] | null)[]): { key: string; points: LatLng[] }[] {
  return keys.flatMap((key, index) => {
    const points = paths[index]
    return points && points.length >= 2 ? [{ key, points }] : []
  })
}

/**
 * 開発環境（Emulator）の見本の線。2 点を、横に少しふくらませた曲線（12 点）で結ぶ。道の形ではない。
 * 手元で、道に沿った線の見た目を確かめるためだけに使う
 */
export function sampleLegPaths(points: readonly LatLng[], keys: readonly string[]): { key: string; points: LatLng[] }[] {
  return keys.map((key, index) => {
    const from = points[index]
    const to = points[index + 1]
    const bend = 0.18
    const control = { lat: (from.lat + to.lat) / 2 - (to.lng - from.lng) * bend, lng: (from.lng + to.lng) / 2 + (to.lat - from.lat) * bend }
    const curve = Array.from({ length: 12 }, (_, i) => {
      const t = i / 11
      const u = 1 - t
      return { lat: u * u * from.lat + 2 * u * t * control.lat + t * t * to.lat, lng: u * u * from.lng + 2 * u * t * control.lng + t * t * to.lng }
    })
    return { key, points: curve }
  })
}
