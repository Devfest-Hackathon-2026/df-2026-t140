// 旅の移動手段。しおりの移動時間を、車（Routes API と直線距離の目安）で出すか、電車・バス（domain/transit.ts）で出すか、
// 飛行機（遠い区間は飛行機、空港までと現地の近い区間は電車・バス。domain/flight.ts の defaultLegMode）で出すか。
// 旅を作るときに選び、しおりでメンバーなら誰でも選び直せる（features/change-travel-mode）。企画書「ユーザー体験」1
// 画面側の同じ決めは web/src/entities/trip/model/travelMode.ts。片方を変えたら、もう片方も合わせる
import type { Trip } from './trip'

export type TravelMode = 'car' | 'transit' | 'plane'

export const TRAVEL_MODES: readonly TravelMode[] = ['transit', 'car', 'plane']

export function isTravelMode(value: unknown): value is TravelMode {
  return value === 'car' || value === 'transit' || value === 'plane'
}

/** 地上の移動手段（車か電車・バス） */
export type GroundMode = 'car' | 'transit'

/**
 * 旅全体の手段のうち、地上を動くときの手段。飛行機の旅は、空港までと現地の近い区間を電車・バスで動く
 * （Takana の依頼、2026-11-22。レンタカーにするかは、しおりの移動の行で区間ごとに選び直せる）
 */
export function groundMode(mode: TravelMode): GroundMode {
  return mode === 'plane' ? 'transit' : mode
}

/**
 * 区間ごとに選べる移動手段（しおりの移動の行。features/change-leg-mode）。旅全体の手段に、徒歩と飛行機を足したもの。
 * 飛行機は直線 200 km より遠い区間だけ（domain/flight.ts の PLANE_MIN_KM。近い区間では選ばせない。かめの決定、2026-11-18、#424）
 */
export type LegMode = GroundMode | 'walk' | 'plane'

/**
 * 徒歩を選べる区間の長さの上限（直線距離 km）。これより遠い区間では、しおりで徒歩を選べない（歩いて約 3 時間。かめの決定、2026-11-18）。
 * 画面側の同じ値は web/src/entities/route/model/types.ts の WALK_MAX_KM
 */
export const WALK_MAX_KM = 10

export function isLegMode(value: unknown): value is LegMode {
  return isTravelMode(value) || value === 'walk'
}

/** 区間ごとに選んだ手段の表。キーは「どこから>どこへ」（domain/routePlan.ts の travelKey。出発地は @origin） */
export type LegModes = Readonly<Record<string, LegMode>>

/** 旅の移動手段。前からある旅（travelMode がない）は、これまでどおり車 */
export function travelModeOf(trip: Pick<Trip, 'travelMode'>): TravelMode {
  return isTravelMode(trip.travelMode) ? trip.travelMode : 'car'
}
