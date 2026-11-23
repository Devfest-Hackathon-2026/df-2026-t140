// しおりの区間（次の場所までの移動）の決め。Functions 側は functions/src/domain/routePlan.ts（travelKey、ORIGIN_KEY）と
// functions/src/domain/travelMode.ts（WALK_MAX_KM）、functions/src/domain/flight.ts（PLANE_MIN_KM）。片方を変えたら、もう片方も合わせる

import type { LegMode } from './types'

/** 区間の出発が出発地（集合場所）のときの印 */
export const ORIGIN_KEY = '@origin'

/** しおりで直した時刻（Route.stopTimes）のキーで、集合時間を表す印。Functions 側は functions/src/domain/routePlan.ts の MEET_KEY */
export const MEET_KEY = '@meet'

/** 区間のキー（Route.legModes のキー）。「どこから>どこへ」 */
export function legKey(from: string, to: string): string {
  return `${from}>${to}`
}

/** 徒歩を選べる区間の長さの上限（直線距離 km。歩いて約 3 時間。かめの決定、2026-11-18） */
export const WALK_MAX_KM = 10

/** 2 点の直線距離（km。大圏距離） */
export function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const h =
    Math.sin(radians(to.lat - from.lat) / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(radians(to.lng - from.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** この区間で徒歩を選べるか。位置が分からなければ選べる（Functions が断る） */
export function walkAllowed(from: { lat: number; lng: number } | null | undefined, to: { lat: number; lng: number } | null | undefined): boolean {
  return !from || !to || distanceKm(from, to) <= WALK_MAX_KM
}

/** 飛行機を選べる区間の長さの下限（直線距離 km）。近い区間では飛行機を出さない（かめの決定、2026-11-18） */
export const PLANE_MIN_KM = 200

/** この区間で飛行機を選べるか。位置が分からなければ選べない（近い区間かもしれないので出さない） */
export function planeAllowed(from: { lat: number; lng: number } | null | undefined, to: { lat: number; lng: number } | null | undefined): boolean {
  return Boolean(from && to) && distanceKm(from!, to!) >= PLANE_MIN_KM
}

/**
 * 選ばなくても最初から飛行機にする区間（車や電車では行きにくい）。直線 600 km 以上か、端のどちらかが北緯 30 度より南（奄美・沖縄・先島などの島）で
 * 200 km 以上。かめの決定（2026-11-19、#465）。Functions 側は functions/src/domain/flight.ts の planeByDefault
 */
export const PLANE_DEFAULT_KM = 600
export const ISLANDS_SOUTH_OF_LAT = 30

export function planeByDefault(from: { lat: number; lng: number } | null | undefined, to: { lat: number; lng: number } | null | undefined): boolean {
  if (!from || !to) return false
  const distance = distanceKm(from, to)
  if (distance >= PLANE_DEFAULT_KM) return true
  return distance >= PLANE_MIN_KM && (from.lat < ISLANDS_SOUTH_OF_LAT || to.lat < ISLANDS_SOUTH_OF_LAT)
}

/**
 * 飛行機の旅で、最初から飛行機にする区間の長さの下限（直線距離 km）。これより近い区間は電車・バス。
 * Functions 側は functions/src/domain/flight.ts の PLANE_TRIP_MIN_KM
 */
export const PLANE_TRIP_MIN_KM = 300

/**
 * 区間の既定の手段。最初から飛行機にする区間なら飛行機、それ以外は旅全体の地上の手段（飛行機の旅は電車・バス）。
 * Functions 側は functions/src/domain/flight.ts の defaultLegMode
 */
export function defaultLegMode(
  from: { lat: number; lng: number } | null | undefined,
  to: { lat: number; lng: number } | null | undefined,
  tripMode: 'transit' | 'car' | 'plane',
): LegMode {
  if (planeByDefault(from, to)) return 'plane'
  if (tripMode === 'plane') return from && to && distanceKm(from, to) >= PLANE_TRIP_MIN_KM ? 'plane' : 'transit'
  return tripMode
}

/**
 * しおりの区間（from → to）の手段。区間ごとに選んだ手段（Route.legModes）があればそれ、なければ区間の既定（defaultLegMode）。
 * しおりの移動の行と、旅の再生で走る乗り物が、同じ決めを使う
 */
export function legModeOf(
  legModes: Readonly<Record<string, LegMode>> | undefined,
  from: string,
  to: string,
  locate: (id: string) => { lat: number; lng: number } | null | undefined,
  tripMode: 'transit' | 'car' | 'plane',
): LegMode {
  return legModes?.[legKey(from, to)] ?? defaultLegMode(locate(from), locate(to), tripMode)
}
