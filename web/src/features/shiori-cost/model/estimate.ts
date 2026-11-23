import type { LegMode } from '@/entities/route'

export type YenRange = readonly [low: number, high: number]

export interface CostLeg {
  mode: LegMode
  km: number | null
}

// 実際の運賃ではなく、旅を計画するための大まかな幅（円）。料金の照会はしない。
function transportRange(mode: LegMode, km: number, partySize: number): YenRange {
  switch (mode) {
    case 'walk': return [0, 0]
    case 'car': return [km * 1.3 * 12 / partySize, km * 1.3 * 24 / partySize]
    case 'transit': return [180 + 14 * km, 370 + 34 * km]
    case 'plane': return [8_000 + 6 * km, 24_000 + 16 * km]
  }
}

const roundRange = ([low, high]: YenRange): YenRange => [Math.floor(low / 100) * 100, Math.ceil(high / 100) * 100]

/**
 * 交通費を数える区間（どこから、どこへ）。出発地 → 1 つ目 → … → 最後の場所、と、最後の場所から出発地へ帰る区間。
 * 帰りを数えないと、飛行機の旅では運賃がほぼ片道分になるため（レビューの指摘）。場所がなければ区間もない
 */
export function costLegPairs(pinIds: readonly string[], originKey: string): [string, string][] {
  if (pinIds.length === 0) return []
  const stops = [originKey, ...pinIds, originKey]
  return stops.slice(1).map((to, index) => [stops[index], to])
}

export function estimateShioriCost(legs: readonly CostLeg[], nights: number, members: number) {
  const partySize = Math.max(1, members)
  const days = nights + 1
  // 日数分の昼食と泊数分の夕食。
  const meals: YenRange = [900 * days + 1_500 * nights, 1_800 * days + 3_000 * nights]
  let low = 0
  let high = 0
  let missingLegs = 0
  let countedLegs = 0
  for (const { mode, km } of legs) {
    if (mode === 'walk') continue
    countedLegs++
    if (km === null || !Number.isFinite(km) || km < 0) {
      missingLegs++
      continue
    }
    const [legLow, legHigh] = transportRange(mode, km, partySize)
    low += legLow
    high += legHigh
  }
  const transport = roundRange([low, high])
  // 計算できた区間（徒歩を除く）が 1 つでもあるか、分からない区間がないとき
  const transportKnown = missingLegs === 0 || countedLegs > missingLegs
  return { transport, meals, missingLegs, transportKnown, total: [transport[0] + meals[0], transport[1] + meals[1]] as YenRange }
}
