import type { LatLng, RegionId, TravelMode } from '@/entities/trip'

// サイコロで選ぶ行き先を、乗り物と日数で無理なく行ける範囲にしぼる計算（旅をつくる画面の「どこに行く？」）。
// 光が跳ねる地方は今までどおりどこでもよく、止まって選ぶ先だけを、出発地から行ける範囲の県にする（Takana の依頼、2026-11-22）。
// 型のほかは何も読み込まない（テストからそのまま呼べるように。地方の県、県の位置、距離の式は呼ぶ側が渡す）

/**
 * 乗り物と泊まる数ごとの、出発地から県のまん中までの直線距離の上限（km）。
 * 車は東京から 1 泊で関東と伊豆・長野まで、大阪から 4 泊で関東か九州の北のあたりまで。
 * 電車・バスは車より遠くまで行け、1 泊で関東と関西を行き来できる。飛行機は上限なし。
 * 数は実装した AI が仮に選んだ（日帰り：車 100、電車・バス 300。1 泊ごとに車 110、電車・バス 250 を足す）
 */
export function reachKm(mode: TravelMode, nights: number): number {
  const stay = Math.max(0, nights)
  if (mode === 'car') return 100 + 110 * stay
  if (mode === 'transit') return 300 + 250 * stay
  return Number.POSITIVE_INFINITY
}

/** 飛行機の旅で、近すぎて飛行機を使わない県を外す距離（km）。しおりで遠い区間を飛行機にする長さ（PLANE_TRIP_MIN_KM）と同じ */
export const PLANE_NEAR_KM = 300

/** 県のまん中の位置 */
export interface PrefecturePoint {
  name: string
  lat: number
  lng: number
}

interface ReachInput {
  /** まだ選んでいない地方（サイコロで選ぶ先の候補）と、その県 */
  regions: readonly { id: RegionId; prefectures: readonly string[] }[]
  /** 出発地の位置。分からなければ null（しぼらない） */
  from: LatLng | null
  /** 選んだ乗り物。まだなら null（しぼらない） */
  mode: TravelMode | null
  nights: number
  prefectures: readonly PrefecturePoint[]
  distance: (from: LatLng, to: LatLng) => number
}

/** サイコロで選べる先。地方と、その地方で選ぶ県 */
export interface RollChoice {
  region: RegionId
  prefectures: string[]
}

/**
 * サイコロで選べる先（地方ごとに、行ける範囲の県）。行ける県が 1 つもない地方は入れない。
 * 行ける県がどの地方にもなければ、いちばん近い県 1 つにする（遠い所しか残っていなくても、サイコロが止まらないことはない）。
 * 出発地か乗り物が分からなければ、まだ選んでいない地方をまるごと
 */
export function rollChoices({ regions, from, mode, nights, prefectures, distance }: ReachInput): RollChoice[] {
  const whole = regions.map((region) => ({ region: region.id, prefectures: [...region.prefectures] }))
  if (!from || !mode) return whole
  const far = reachKm(mode, nights)
  const near = mode === 'plane' ? PLANE_NEAR_KM : 0
  const km = new Map(prefectures.map((point) => [point.name, distance(from, point)]))
  const inRange = (name: string) => {
    const value = km.get(name)
    return value === undefined || (value >= near && value <= far)
  }
  const choices = whole
    .map((choice) => ({ region: choice.region, prefectures: choice.prefectures.filter(inRange) }))
    .filter((choice) => choice.prefectures.length > 0)
  if (choices.length > 0) return choices
  // どこも範囲の外なら、範囲にいちばん近い県（遠すぎるなら近いもの、飛行機で近すぎるなら遠いもの）
  const gap = (name: string) => {
    const value = km.get(name) ?? Number.POSITIVE_INFINITY
    return value > far ? value - far : value < near ? near - value : 0
  }
  const nearest = whole
    .flatMap((choice) => choice.prefectures.map((name) => ({ region: choice.region, name })))
    .sort((a, b) => gap(a.name) - gap(b.name))[0]
  return nearest ? [{ region: nearest.region, prefectures: [nearest.name] }] : whole
}
