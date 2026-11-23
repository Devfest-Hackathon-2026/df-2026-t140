// 旅の移動手段。しおりの移動時間を、電車・バスで出すか、車で出すか、飛行機（遠い区間は飛行機、空港までと現地は電車・バス）で出すか。
// Functions 側の同じ決めは functions/src/domain/travelMode.ts。片方を変えたら、もう片方も合わせる
import type { Trip } from './types'
import { translate as t } from '../../../shared/lib/language.ts'

export type TravelMode = 'car' | 'transit' | 'plane'

/** 選ぶ順（既定の電車・バスを先に） */
export const TRAVEL_MODES: readonly TravelMode[] = ['transit', 'car', 'plane']

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = { transit: t('電車・バス', 'Train or bus'), car: t('車', 'Car'), plane: t('飛行機', 'Flight') }

/** 旅の移動手段。前からある旅（travelMode がない）は車 */
export function travelModeOf(trip: Pick<Trip, 'travelMode'>): TravelMode {
  return trip.travelMode === 'transit' || trip.travelMode === 'plane' ? trip.travelMode : 'car'
}

/** 地上の移動手段（車か電車・バス） */
export type GroundMode = 'car' | 'transit'

/** 旅全体の手段のうち、地上を動くときの手段。飛行機の旅は、空港までと現地の近い区間を電車・バスで動く（Functions 側は domain/travelMode.ts の groundMode） */
export function groundMode(mode: TravelMode): GroundMode {
  return mode === 'plane' ? 'transit' : mode
}
