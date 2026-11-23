// 同じ場所を旅の中で何度も訪れるための、しおりの行の ID の決め（純粋。I/O なし。企画書「ユーザー体験」3-6、#528）。
// しおりの順番（Route.pinIds）には、行の ID が並ぶ。その場所の 1 つ目の行はピンの ID そのまま、複製した行は「ピンの ID~番号」。
// ピンの ID は Firestore の自動の ID（英数字）なので、~ とはぶつからない。
// しおりに場所があるあいだは、ピンの ID そのままの行が必ず 1 つある（その行を消したら、残りの 1 つをピンの ID に付け替える）。
// これで、行の ID を知らない処理（建った場所がしおりに入っているかを pinIds で見る、など）がそのまま動く。
// 画面側の同じ決めは web/src/entities/route/model/visits.ts。片方を変えたら、もう片方も合わせる
import type { LegFlight } from './flight'
import type { PlanPlace } from './routePlan'
import type { LegMode } from './travelMode'

/** ピンの ID と番号のあいだの印 */
export const VISIT_MARK = '~'

/** 行の ID の形（ピンの ID か、ピンの ID~番号）。handler が入力を確かめるのに使う */
export const STOP_ID = /^[A-Za-z0-9_-]{1,128}(~[1-9][0-9]{0,2})?$/

/**
 * Route.stopTimes のキーで、場所を出る時刻を表す印。行の ID のうしろに付ける（例：ピンの ID@leave）。
 * 着く時刻のキーは行の ID そのまま。画面側の同じ決めは web/src/entities/route/model/stopTimes.ts の LEAVE_MARK
 */
export const LEAVE_MARK = '@leave'

/** その行の、出る時刻のキー */
export const leaveKey = (stopId: string): string => `${stopId}${LEAVE_MARK}`

/** stopTimes のキーが指す行の ID（出る時刻のキーなら印を外す。ほかのキーはそのまま） */
export function stopOfTimeKey(key: string): string {
  return key.endsWith(LEAVE_MARK) ? key.slice(0, -LEAVE_MARK.length) : key
}

/** しおりの行の数の上限（建物は 20 棟まで。同じ場所を何度入れても、ここまで。実装した AI が仮に選んだ） */
export const MAX_STOPS = 40

/** 行の ID から、その場所のピンの ID */
export function pinOfStop(stopId: string): string {
  const at = stopId.indexOf(VISIT_MARK)
  return at < 0 ? stopId : stopId.slice(0, at)
}

/**
 * しおりの順番（行の ID）に、建った場所を並べる。複製した行は、同じ場所を行の ID で入れる（pinId にピンの ID）。
 * 建っていない（消えた）場所の行は飛ばす
 */
export function visitOrder(stopIds: readonly string[], places: readonly PlanPlace[]): PlanPlace[] {
  const placeOf = new Map(places.map((place) => [place.id, place]))
  return stopIds.flatMap((stopId) => {
    const pinId = pinOfStop(stopId)
    const place = placeOf.get(pinId)
    if (!place) return []
    return [pinId === stopId ? place : { ...place, id: stopId, pinId }]
  })
}

/**
 * その場所に足す行の ID。2 番から数えて、今の行が使っていないいちばん小さい番号（ピンの ID そのままの行は 1 番）。
 * 行は MAX_STOPS までなので、番号は STOP_ID の 3 けたに収まる
 */
export function nextStopId(stopIds: readonly string[], pinId: string): string {
  const used = new Set(stopIds)
  let number = 2
  while (used.has(`${pinId}${VISIT_MARK}${number}`)) number += 1
  return `${pinId}${VISIT_MARK}${number}`
}

/** 行の ID をキーにした控え（人が直した時刻、区間ごとの手段と便） */
export interface StopKeyed {
  stopTimes?: Record<string, number>
  legModes?: Record<string, LegMode>
  legFlights?: Record<string, LegFlight>
}

const legEnds = (key: string): [string, string] => {
  const at = key.indexOf('>')
  return [key.slice(0, at), key.slice(at + 1)]
}

function mapKeys<T>(record: Record<string, T> | undefined, rename: (key: string) => string | null): Record<string, T> | undefined {
  if (!record) return undefined
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
    const next = rename(key)
    return next === null ? [] : [[next, value] as const]
  }))
}

/** 行の ID を付け替える（rename が null を返した行の分は外す）。区間のキー（どこから>どこへ）は、両端を付け替える */
export function renameStops<T extends StopKeyed>(keyed: T, rename: (stopId: string) => string | null): T {
  const leg = (key: string) => {
    const [from, to] = legEnds(key).map(rename)
    return from === null || to === null ? null : `${from}>${to}`
  }
  // 出る時刻のキー（行の ID@leave）は、行の ID を付け替えて印を付け直す
  const time = (key: string) => {
    const stopId = stopOfTimeKey(key)
    if (stopId === key) return rename(key)
    const next = rename(stopId)
    return next === null ? null : leaveKey(next)
  }
  return { ...keyed, stopTimes: mapKeys(keyed.stopTimes, time), legModes: mapKeys(keyed.legModes, leg), legFlights: mapKeys(keyed.legFlights, leg) }
}
