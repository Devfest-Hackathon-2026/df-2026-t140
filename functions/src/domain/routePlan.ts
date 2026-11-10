// ルートの計算（純粋。I/O なし）。回る順番、移動時間、日ごとのスケジュールを、ピンの緯度経度から自分で計算する。
// 回る順番は、いつも直線距離で決める。移動時間は、Routes API（車）の時間の表（TravelTable）を渡されたら、その区間はそれを使い、
// 渡されない区間は直線距離からの見積もり（実際の道や乗り物の時間ではない）にする。
// 保存するしおり（features/propose-routes）は、いつも目安で作る。Routes の時間を使うのは、しおりを開いたときに画面へ返すだけの
// features/shiori-travel（本番で、合言葉を通した人だけ。規約で Routes の時間は保存できないため。todo/humans/2026-11-07-shiori-routes-api.md）
import type { LatLng } from './pin'
import type { RouteStop, RouteStyle } from './route'

/** 回る場所 1 つ */
export interface PlanPlace {
  /** ピンの ID */
  id: string
  name: string
  location: LatLng
  /** その場所の希望を書いた人 */
  uid: string
}

/** 出発地。位置が分からなければ location は null（出発地からの移動は入れない） */
export interface PlanOrigin {
  name: string
  location: LatLng | null
}

/** 案の種類ごとの、時間の決め */
export interface StyleTiming {
  /** 1 日の始まり（0 時からの分） */
  startMinutes: number
  /** 1 か所にいる時間（分） */
  stayMinutes: number
}

export const STYLE_TIMINGS: Record<RouteStyle, StyleTiming> = {
  shortest: { startMinutes: 9 * 60, stayMinutes: 60 },
  relaxed: { startMinutes: 10 * 60, stayMinutes: 120 },
  wishes: { startMinutes: 9 * 60, stayMinutes: 90 },
}

/** 案の順番（A、B、C）。同数のときは、この順で先の案に決まる */
export const STYLE_ORDER: readonly RouteStyle[] = ['shortest', 'relaxed', 'wishes']
export const STYLE_LABELS: Record<RouteStyle, string> = { shortest: 'A', relaxed: 'B', wishes: 'C' }

/** 道のりは、直線距離のこの倍とみなす */
const DETOUR = 1.3
/** 移動の速さ（km/h）。車や電車をならした見積もり */
const SPEED_KMH = 60
/** 乗り降りや駐車にかかる時間（分） */
const TRANSFER_MINUTES = 10
/** これより多いと、全部の順番を試さない（5 棟までなので、ふつうは届かない） */
const MAX_PERMUTED = 7

/** 区間ごとの移動時間（分）の表。キーは travelKey(どこから, どこへ)。どちらもピンの ID か ORIGIN_KEY */
export type TravelTable = ReadonlyMap<string, number>
/** 表のキーで、出発地を表す印（ピンの ID とは重ならない） */
export const ORIGIN_KEY = '@origin'
export const travelKey = (from: string, to: string): string => `${from}>${to}`

/** 2 点の直線距離（km。大圏距離） */
export function distanceKm(from: LatLng, to: LatLng): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(to.lat - from.lat)
  const dLng = radians(to.lng - from.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 直線距離から見積もった移動時間（分。5 分きざみに切り上げ） */
export function moveMinutes(km: number): number {
  const minutes = ((km * DETOUR) / SPEED_KMH) * 60 + TRANSFER_MINUTES
  return Math.ceil(minutes / 5) * 5
}

/** Routes API の移動時間（秒）から、しおりに書く移動時間（分）。乗り降りの時間を足し、5 分きざみに切り上げる（moveMinutes と同じ決め） */
export function routesMoveMinutes(seconds: number): number {
  return Math.ceil((seconds / 60 + TRANSFER_MINUTES) / 5) * 5
}

/**
 * buildPlan がたどる区間（出発地の位置が分かれば出発地 → 1 つ目、そのあとは順番どおり。日をまたぐ区間も入る）。
 * points は Routes API に渡す点の並び、keys は区間ごとの表のキー（長さは points.length - 1）
 */
export function travelLegs(order: readonly PlanPlace[], origin: PlanOrigin): { points: LatLng[]; keys: string[] } {
  const stops = [
    ...(origin.location && order.length > 0 ? [{ key: ORIGIN_KEY, location: origin.location }] : []),
    ...order.map((place) => ({ key: place.id, location: place.location })),
  ]
  return {
    points: stops.map((stop) => stop.location),
    keys: stops.slice(1).map((stop, index) => travelKey(stops[index].key, stop.key)),
  }
}

/** Routes API の区間ごとの秒から、移動時間の表を作る。道がない区間（null）は表に入れない（その区間は目安になる） */
export function travelTable(keys: readonly string[], legSeconds: readonly (number | null)[]): TravelTable {
  const table = new Map<string, number>()
  keys.forEach((key, index) => {
    const value = legSeconds[index]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) table.set(key, routesMoveMinutes(value))
  })
  return table
}

/** 順番どおりに回ったときの直線距離の合計（km）。出発地の位置が分かれば、出発地から 1 つ目までも足す */
export function pathKm(places: readonly PlanPlace[], origin: PlanOrigin): number {
  let total = origin.location && places.length > 0 ? distanceKm(origin.location, places[0].location) : 0
  for (let index = 1; index < places.length; index += 1) {
    total += distanceKm(places[index - 1].location, places[index].location)
  }
  return total
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  )
}

/** 近い所から順にたどる（場所が多すぎて、全部の順番を試せないとき） */
function nearestFirst(places: readonly PlanPlace[], origin: PlanOrigin): PlanPlace[] {
  const rest = [...places]
  const order: PlanPlace[] = []
  let at = origin.location
  while (rest.length > 0) {
    const from = at
    const next = from
      ? rest.reduce((best, place) => (distanceKm(from, place.location) < distanceKm(from, best.location) ? place : best))
      : rest[0]
    rest.splice(rest.indexOf(next), 1)
    order.push(next)
    at = next.location
  }
  return order
}

/** 全員の希望が、どれだけ早く 1 つずつ入るか（小さいほど早い）。人ごとに、その人の最初の場所が何番目かを足す */
function firstTurnsSum(order: readonly PlanPlace[]): number {
  const first = new Map<string, number>()
  order.forEach((place, index) => {
    if (!first.has(place.uid)) first.set(place.uid, index)
  })
  return [...first.values()].reduce((sum, index) => sum + index, 0)
}

const keyOf = (order: readonly PlanPlace[]) => order.map((place) => place.id).join('>')

/**
 * 3 つの案の回る順番を決める。場所が 3 つ以上なら、3 つとも違う順番になる。
 * - shortest：移動の合計がいちばん短い順
 * - relaxed：shortest の逆まわり（時間の決めも違う：滞在を長く、出発を遅く）
 * - wishes：全員の希望が早めに 1 つずつ入る順。同じなら移動が短いほう。上の 2 つと同じ順番は選ばない
 * 同じ入力なら、いつも同じ結果になる（場所は ID の順に並べてから試す）。
 */
export function proposeOrders(places: readonly PlanPlace[], origin: PlanOrigin): Record<RouteStyle, PlanPlace[]> {
  const sorted = [...places].sort((left, right) => left.id.localeCompare(right.id))
  if (sorted.length > MAX_PERMUTED) {
    const shortest = nearestFirst(sorted, origin)
    const relaxed = [...shortest].reverse()
    const wishes = [...sorted].sort((left, right) => left.uid.localeCompare(right.uid))
    return { shortest, relaxed, wishes }
  }
  const candidates = permutations(sorted).map((order) => ({ order, km: pathKm(order, origin), turns: firstTurnsSum(order) }))
  const byKm = [...candidates].sort((left, right) => left.km - right.km)
  const shortest = byKm[0].order
  const relaxed = [...shortest].reverse()
  const used = new Set([keyOf(shortest), keyOf(relaxed)])
  const byTurns = [...candidates].sort((left, right) => left.turns - right.turns || left.km - right.km)
  const wishes = (byTurns.find((candidate) => !used.has(keyOf(candidate.order))) ?? byTurns[0]).order
  return { shortest, relaxed, wishes }
}

/**
 * 決まったルートに場所を 1 つ足すとき、どこに入れるか（0 なら先頭）。移動（直線距離）がいちばん増えない位置。
 * ほかの場所の順番は変えない（今のルートに近い形を保つ）。同じ増え方なら、後ろのほう（これからの予定を動かさない）。
 */
export function insertionIndex(order: readonly PlanPlace[], place: PlanPlace, origin: PlanOrigin): number {
  const before = pathKm(order, origin)
  let best = order.length
  let bestAdded = Infinity
  for (let index = order.length; index >= 0; index -= 1) {
    const added = pathKm([...order.slice(0, index), place, ...order.slice(index)], origin) - before
    if (added < bestAdded - 1e-9) {
      best = index
      bestAdded = added
    }
  }
  return best
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 0 時からの分を HH:MM にする。24 時を過ぎたら 23:59 で止める */
export function clock(minutes: number): string {
  const capped = Math.min(minutes, 23 * 60 + 59)
  return `${pad(Math.floor(capped / 60))}:${pad(capped % 60)}`
}

/** 場所を、日数に合わせて前から順に分ける（3 か所で 2 日なら 2 と 1）。場所より日が多ければ、余った日は使わない */
export function splitIntoDays<T>(items: readonly T[], days: number): T[][] {
  const count = Math.max(1, Math.min(days, items.length))
  const base = Math.floor(items.length / count)
  const extra = items.length % count
  const result: T[][] = []
  let index = 0
  for (let day = 0; day < count; day += 1) {
    const size = base + (day < extra ? 1 : 0)
    result.push(items.slice(index, index + size))
    index += size
  }
  return result
}

export interface Plan {
  schedule: RouteStop[]
  totalMoveMinutes: number
  totalDistanceKm: number
  originIncluded: boolean
}

/**
 * 回る順番から、日ごとのスケジュール（時刻、場所、滞在時間、次への移動）を作る。
 * - 1 日目は、出発地の位置が分かれば「出発」の行から始める。分からなければ、1 つ目の場所から始める
 * - 2 日目からは、その日の 1 つ目の場所から始める（宿は決めていないので、宿からの移動は入れない）
 * - 日をまたぐ移動（前の日の最後 → 次の日の最初）は、前の日の最後の行の「次への移動」に入れ、合計にも足す
 * - 帰りの移動は入れない
 * - 移動時間は、travel（Routes API の表）にその区間があればそれを、なければ直線距離からの見積もりを使う
 */
export function buildPlan(order: readonly PlanPlace[], origin: PlanOrigin, days: number, timing: StyleTiming, travel?: TravelTable): Plan {
  const schedule: RouteStop[] = []
  let totalMoveMinutes = 0
  let totalDistanceKm = 0
  const minutesFor = (from: string, to: string, km: number) => travel?.get(travelKey(from, to)) ?? moveMinutes(km)
  const originIncluded = origin.location !== null && order.length > 0
  const groups = splitIntoDays(order, days)

  groups.forEach((group, dayIndex) => {
    const day = dayIndex + 1
    let now = timing.startMinutes
    if (dayIndex === 0 && origin.location && group.length > 0) {
      const km = distanceKm(origin.location, group[0].location)
      const move = minutesFor(ORIGIN_KEY, group[0].id, km)
      schedule.push({ day, time: clock(now), pinId: null, name: `${origin.name} 出発`, stayMinutes: 0, moveMinutesToNext: move })
      totalMoveMinutes += move
      totalDistanceKm += km
      now += move
    }
    group.forEach((place, index) => {
      const next = group[index + 1] ?? groups[dayIndex + 1]?.[0]
      let move: number | null = null
      if (next) {
        const km = distanceKm(place.location, next.location)
        move = minutesFor(place.id, next.id, km)
        totalMoveMinutes += move
        totalDistanceKm += km
      }
      schedule.push({ day, time: clock(now), pinId: place.id, name: place.name, stayMinutes: timing.stayMinutes, moveMinutesToNext: move })
      now += timing.stayMinutes + (move ?? 0)
    })
  })

  return { schedule, totalMoveMinutes, totalDistanceKm: Math.round(totalDistanceKm), originIncluded }
}

/** 旅の日数。終了日なし（null）は日帰りで 1 */
export function tripDays(startDate: string, endDate: string | null): number {
  if (!endDate) return 1
  const toUtc = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const days = Math.round((toUtc(endDate) - toUtc(startDate)) / 86_400_000) + 1
  return Number.isFinite(days) ? Math.max(1, days) : 1
}
