import type { Route, RouteStop } from './types'

// しおりの宿の枠の決め。Functions 側は functions/src/domain/route.ts（LODGING_SKIP）と
// functions/src/domain/routePlan.ts（splitByNights、assignLodging）。片方を変えたら、もう片方も合わせる

/** Route.lodging の値で、その夜は宿を取らないことを表す印。自分で書いた過ごし方があれば「@skip:車中泊」の形 */
export const LODGING_SKIP = '@skip'

/** 宿を取らない夜に、自分で書ける過ごし方の長さの上限（Functions の LODGING_NOTE_MAX と合わせる） */
export const LODGING_NOTE_MAX = 20

/** Route.lodging の値が、宿を取らない夜の印か */
function isSkip(value: string | undefined): value is string {
  return value === LODGING_SKIP || (typeof value === 'string' && value.startsWith(`${LODGING_SKIP}:`))
}

/**
 * 泊まる夜 1 つの、宿の状態。night は何日目の夜か（1 日目の夜が 1）。
 * open：まだ決めていない（点線の枠）。skip：宿を取らない（note は自分で書いた過ごし方。書いていなければ null）。pin：宿が建物で決まっている（pinId。しおりのその日の最後の行）
 */
export type LodgingNight = { night: number } & ({ state: 'open' } | { state: 'skip'; note: string | null } | { state: 'pin'; pinId: string })

/**
 * 泊まる夜ごとの宿の状態（1 日目の夜から順）。nights は旅の泊数（shared/lib の nights。日帰りは 0）。
 * 宿のピンがしおりの行にないもの（消えた、まだ届いていない）は、決めていない夜として出す
 */
export function lodgingNights(route: Pick<Route, 'lodging' | 'schedule'>, nights: number): LodgingNight[] {
  const result: LodgingNight[] = []
  for (let night = 1; night <= nights; night += 1) {
    const value = route.lodging?.[String(night)]
    if (isSkip(value)) result.push({ night, state: 'skip', note: value.slice(LODGING_SKIP.length + 1) || null })
    else if (value && route.schedule.some((stop) => stop.pinId !== null && (stop.stopId ?? stop.pinId) === value)) result.push({ night, state: 'pin', pinId: value })
    else result.push({ night, state: 'open' })
  }
  return result
}

/** 宿がまだ決まっていない、いちばん早い夜。なければ null（宿を知らせる・確定を止めるのに使う） */
export function openLodgingNight(route: Pick<Route, 'lodging' | 'schedule'>, nights: number): number | null {
  return lodgingNights(route, nights).find((item) => item.state === 'open')?.night ?? null
}

/**
 * 宿に決まっている建物の、しおりの行の ID（宿の行として出す。取って動かせない）。
 * 宿にするときはその場所の 1 つ目の行なので、ふつうはピンの ID と同じ。前の夜と同じ宿にした夜は、複製した行（「ピンの ID~番号」。./visits.ts）
 */
export function lodgingStopIds(route: Pick<Route, 'lodging'>): string[] {
  return Object.values(route.lodging ?? {}).filter((value) => !isSkip(value))
}

/** 宿を探す範囲の、真ん中からの最小の広さ（度。南北に約 15 km、東西もおよそ同じ） */
const SEARCH_LAT = 0.14
const SEARCH_LNG = 0.17

/**
 * その夜の宿を探す範囲。その日の最後の場所と、翌日の最初の場所の、あいだの地点を真ん中にした四角（Youkin06 の依頼、2026-11-21。
 * 次の日の出発が楽な所に泊まれるように）。2 つの場所が離れていれば、両方が入る広さまで広げる（Functions は真ん中に近い順に探す）。
 * 翌日の場所がまだなければ、その日の最後の場所（その日に場所がなければ、それより前の最後の場所。それもなければ、しおりの最初の場所）のまわり。
 * 宿に決まった建物（stayIds）は、前後の場所に数えない。locationOf は、ピンの ID から位置を引く。
 * しおりに場所が 1 つもなければ null（いま地図で映している範囲から探す）
 */
export function lodgingSearchBounds(
  schedule: readonly Pick<RouteStop, 'day' | 'pinId'>[],
  night: number,
  locationOf: (pinId: string) => { lat: number; lng: number } | undefined,
  stayIds: readonly string[] = [],
): { north: number; south: number; east: number; west: number } | null {
  const located = schedule.flatMap((stop) => {
    const location = stop.pinId && !stayIds.includes(stop.pinId) ? locationOf(stop.pinId) : undefined
    return location ? [{ day: stop.day, location }] : []
  })
  const before = located.filter((stop) => stop.day <= night).at(-1)
  const after = located.find((stop) => stop.day > night)
  const from = (before ?? after ?? located[0])?.location
  if (!from) return null
  const to = before && after ? after.location : from
  const lat = (from.lat + to.lat) / 2
  const lng = (from.lng + to.lng) / 2
  const halfLat = Math.max(SEARCH_LAT, Math.abs(from.lat - to.lat) / 2)
  const halfLng = Math.max(SEARCH_LNG, Math.abs(from.lng - to.lng) / 2)
  return { north: lat + halfLat, south: lat - halfLat, east: lng + halfLng, west: lng - halfLng }
}

/**
 * 前の夜の宿（night - 1 の夜の宿が建物で決まっていて、その行がしおりにあるときだけ）。宿の枠の「前の夜と同じ宿にする」に、その宿の名前を添える。
 * なければ null（1 日目の夜、前の夜がまだ決まっていない、宿を取らない夜）
 */
export function previousLodging(nights: readonly LodgingNight[], schedule: readonly RouteStop[], night: number): { name: string } | null {
  const before = nights.find((item) => item.night === night - 1)
  if (before?.state !== 'pin') return null
  const row = schedule.find((stop) => stop.pinId !== null && (stop.stopId ?? stop.pinId) === before.pinId)
  return row ? { name: row.name } : null
}
