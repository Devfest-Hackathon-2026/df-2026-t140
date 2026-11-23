// ルートの計算（純粋。I/O なし）。回る順番、移動時間、日ごとのスケジュールを、ピンの緯度経度から自分で計算する。
// 回る順番は、いつも直線距離で決める。移動時間は、Routes API（車）の時間の表（TravelTable）を渡されたら、その区間はそれを使い、
// 渡されない区間は旅の移動手段の見積もり（車は直線距離の式、電車・バスは domain/transit.ts。どちらも実際の時刻ではない）にする。
// 保存するしおり（features/propose-routes）は、いつも目安で作る。Routes の時間を使うのは、しおりを開いたときに画面へ返すだけの
// features/shiori-travel（本番で、合言葉を通した人だけ。規約で Routes の時間は保存できないため。todo/humans/2026-11-07-shiori-routes-api.md）
import { eventBufferMinutes, eventWindow, type EventWindow, isPinEvent, type PinEvent } from './event'
import { type LatLng, lodgingOf, type Pin, type PinCategory } from './pin'
import { isLodgingSkip, type Route, type RouteStop, type RouteStyle } from './route'
import { defaultLegMode, estimatedFlightMinutes, type LegFlight, PLANE_MIN_KM, reuseFlight } from './flight'
import { transitMinutes, walkOnlyMinutes } from './transit'
import { type LegMode, type LegModes, type TravelMode, WALK_MAX_KM } from './travelMode'
import { leaveKey } from './visit'

/** 回る場所 1 つ */
export interface PlanPlace {
  /** しおりの行の ID。ふつうはピンの ID。同じ場所を何度も訪れるときの 2 回目からは「ピンの ID~番号」（domain/visit.ts） */
  id: string
  /** 複製した行のときの、ピンの ID（id がピンの ID なら、ない） */
  pinId?: string
  name: string
  location: LatLng
  /** その場所の希望を書いた人 */
  uid: string
  /** 場所の種類。いる時間の目安に使う（stayMinutesFor）。ないときは、案の一律の分数（StyleTiming.stayMinutes） */
  category?: PinCategory
  /**
   * 宿（種類が lodging の建物）のときだけある。want は「宿を探す」を押した夜（Pin.lodgingNight。なければ null）。
   * しおりに足すとき、どの夜の宿にするかを決めるのに使う（assignLodging）。もう足した宿では見ない（どの夜かは Route.lodging）
   */
  lodging?: { want: number | null }
  /** ごはんのお店として探して建てた場所のときだけある（Pin.mealSlot。「1-lunch」）。しおりに足すとき、その日のそのごはんの位置に入れる（domain/meal.ts の assignMeal） */
  meal?: string
  /**
   * 時刻が決まったイベント（花火大会、見学会）のときだけある（Pin.event）。着く時刻と出る時刻を固定し、開催日の日に置く
   * （buildPlan、dayPacker。開催日を何日目にするかは PlanOrigin.startDate から決める）
   */
  event?: PinEvent
}

/**
 * 出発の条件。位置が分からなければ location は null（出発地からの移動は入れない）。
 * travelMode は旅の移動手段（domain/travelMode.ts）。ないときは車（前からの計算のまま）
 */
export interface PlanOrigin {
  name: string
  location: LatLng | null
  travelMode?: TravelMode
  /** 旅の開始日（YYYY-MM-DD）。時刻が決まったイベントを、開催日の日に置くのに使う。ないときは、イベントも時刻を固定しない */
  startDate?: string
  /** 旅の最後に帰る場所の位置（出発地と違うときだけ。domain/tripOrigin.ts）。ないときは出発地へ帰る */
  returnLocation?: LatLng | null
}

/** 旅の最後に帰る先。帰る場所があればそこ、なければ出発地 */
function homeOf(origin: PlanOrigin): LatLng | null {
  return origin.returnLocation ?? origin.location
}

/** 案の種類ごとの、時間の決め */
export interface StyleTiming {
  /** 1 日の始まり（0 時からの分） */
  startMinutes: number
  /** 1 か所にいる時間（分）。場所の種類が分からないとき（と、stayScale がないとき）に使う */
  stayMinutes: number
  /**
   * 場所の種類ごとの目安（CATEGORY_STAY_MINUTES）に掛ける倍率。あるときは、いる時間を種類の目安で決め、
   * 日の分け方も、その日の DAY_END_MINUTES までに入るかで決める（dayPacker）。
   * ないときは、今までどおり一律の stayMinutes と、場所の数での分け方（splitIntoDays）にする（テストで手で渡す形）
   */
  stayScale?: number
  /** しおりで人が直した時刻（Route.stopTimes。キーは MEET_KEY、ORIGIN_KEY、ピンの ID）。ないときは全部自動で組む */
  stopTimes?: Readonly<Record<string, number>>
  /** 泊まる夜ごとの宿（Route.lodging）。ないときは、宿のない旅として組む */
  lodging?: Readonly<Record<string, string>>
}

export const STYLE_TIMINGS: Record<RouteStyle, StyleTiming> = {
  shortest: { startMinutes: 9 * 60, stayMinutes: 60, stayScale: 1 },
  relaxed: { startMinutes: 10 * 60, stayMinutes: 120, stayScale: 1.25 },
  wishes: { startMinutes: 9 * 60, stayMinutes: 90, stayScale: 1 },
}

/**
 * 場所の種類ごとの、そこにいる時間の目安（分）。スキー場と遊ぶところは終日。宿は、着いてから翌朝まで（buildPlan が決める）。
 * 一律の分数だと、スキー場もランチも同じ長さになり、予定にかける時間が短くなりがちなため（Takana の決定、2026-11-21、#520。
 * 一律 1 時間のバッファの代わり）。分数は実装した AI が仮に選んだ
 */
export const CATEGORY_STAY_MINUTES: Record<PinCategory, number> = {
  // スキー場は最低 4 時間。早く着いたら、リフトの終わる SKI_CLOSE_MINUTES まで（stayMinutesFor。Lazyturtle0852 の決定、2026-11-22、#602）
  ski: 4 * 60,
  themepark: 7 * 60,
  onsen: 120,
  nature: 120,
  town: 120,
  farm: 90,
  shrine: 90,
  nightview: 60,
  food: 60,
  lodging: 60,
}

/** 1 日の予定を入れる終わりの時刻（0 時からの分）。日の分け方で、これを越える場所から次の日に回す（実装した AI が仮に選んだ） */
export const DAY_END_MINUTES = 19 * 60
/**
 * 宿に着く目安の時刻（0 時からの分）。宿のある日は、宿への移動を足してこれまでに着くように場所を入れ、ゆとりもここまでで数える。
 * Lazyturtle0852 の「18〜20 時ぐらい」（2026-11-22、#602）の真ん中を、実装した AI が選んだ
 */
export const LODGING_ARRIVE_MINUTES = 19 * 60
/** スキー場のリフトが止まる目安。これより早く着いたら、ここまでいる（実装した AI が仮に選んだ） */
export const SKI_CLOSE_MINUTES = 16 * 60
/** スキー場にこれより遅く着く日は、その日にほかの場所があれば、スキー場を次の日に回す（10 時ごろから滑るため。実装した AI が仮に選んだ） */
export const SKI_LATEST_ARRIVAL_MINUTES = 12 * 60
/** 遊ぶところ（themepark）のうち、名前でこれに当たる水族館と動物園にいる時間（分。終日にしない。実装した AI が仮に選んだ） */
export const SHORT_THEMEPARK_MINUTES = 150
const SHORT_THEMEPARK_NAME = /水族館|動物園|アクアリウム|aquarium|zoo/i
/** 月ごとの日の入りの目安（0 時からの分。東京のおおよそ。1 月が先頭）。夜景に着く時刻を決めるのに使う */
const SUNSET_BY_MONTH = [16 * 60 + 50, 17 * 60 + 20, 17 * 60 + 50, 18 * 60 + 15, 18 * 60 + 40, 19 * 60, 19 * 60, 18 * 60 + 40, 18 * 60, 17 * 60 + 20, 16 * 60 + 40, 16 * 60 + 30]

/**
 * 夜に置く場所か（夜景）。その日の最後（宿の前）に置き、日の入りのあとに着くようにする。19 時までの枠には数えない。
 * 時刻が決まったイベント（花火など）は、イベントの時刻で置くので、ここには入れない
 */
export const isEveningPlace = (place: Pick<PlanPlace, 'category' | 'event'>): boolean => place.category === 'nightview' && !place.event

/**
 * 夜景に着く、いちばん早い時刻（0 時からの分）。旅の day 日目の月の日の入りの目安の 30 分後を、15 分きざみに切り上げる。
 * 開始日が分からなければ 18 時（Lazyturtle0852 の「夜景は夜に」、2026-11-22、#602）
 */
export function nightStartMinutes(startDate: string | undefined, day: number): number {
  const date = startDate ? new Date(`${startDate}T00:00:00Z`) : null
  if (!date || Number.isNaN(date.getTime())) return 18 * 60
  date.setUTCDate(date.getUTCDate() + day - 1)
  return Math.ceil((SUNSET_BY_MONTH[date.getUTCMonth()] + 30) / 15) * 15
}

/**
 * その場所にいる時間（分）。種類の目安 × 倍率を 15 分きざみにし、1 日の持ち時間で止める。種類か倍率がなければ一律の分数。
 * - 遊ぶところでも、水族館と動物園は SHORT_THEMEPARK_MINUTES（名前で見分ける）
 * - スキー場は、着く時刻（arriveAt）が分かれば、目安と、リフトが止まる SKI_CLOSE_MINUTES までの長いほう
 */
export function stayMinutesFor(
  place: Pick<PlanPlace, 'category'> & { name?: string },
  timing: Pick<StyleTiming, 'startMinutes' | 'stayMinutes' | 'stayScale'>,
  arriveAt?: number,
): number {
  if (timing.stayScale === undefined || !place.category) return timing.stayMinutes
  const base = place.category === 'themepark' && place.name && SHORT_THEMEPARK_NAME.test(place.name) ? SHORT_THEMEPARK_MINUTES : CATEGORY_STAY_MINUTES[place.category]
  let minutes = Math.round((base * timing.stayScale) / 15) * 15
  if (place.category === 'ski' && arriveAt !== undefined) minutes = Math.max(minutes, SKI_CLOSE_MINUTES - arriveAt)
  return Math.max(15, Math.min(minutes, DAY_END_MINUTES - timing.startMinutes))
}

/** 建ったピンから、しおりを組む計算に渡す場所を作る。組み直すどの機能も、これで作る（種類と宿の印を渡し忘れないように） */
export function planPlace(id: string, pin: Pick<Pin, 'name' | 'location' | 'uid' | 'category' | 'lodgingNight' | 'event' | 'mealSlot'>): PlanPlace {
  return {
    id,
    name: pin.name,
    location: pin.location,
    uid: pin.uid,
    category: pin.category,
    ...lodgingOf(pin),
    ...(isPinEvent(pin.event) ? { event: pin.event } : {}),
    ...(pin.mealSlot ? { meal: pin.mealSlot } : {}),
  }
}

/** しおりでのイベントの枠（開催日が何日目か、着く時刻、出る時刻）。イベントでない、開始日が分からない、開催日が旅の前の日なら null */
function windowOf(place: Pick<PlanPlace, 'event'>, origin: Pick<PlanOrigin, 'startDate'>, days = Infinity): EventWindow | null {
  return place.event && origin.startDate ? eventWindow(place.event, origin.startDate, days) : null
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

/** Route.stopTimes のキーで、集合時間を表す印（出発地を出る時間は ORIGIN_KEY。場所を出る時刻は domain/visit.ts の leaveKey） */
export const MEET_KEY = '@meet'
/** 集合時間を決めていないとき、出発の何分前に集まるか（実装した AI が仮に選んだ。2026-11-19） */
export const MEET_LEAD_MINUTES = 15
/** 1 日の分の数。直した時刻は 0 〜 これ未満 */
export const DAY_MINUTES = 24 * 60

/** ルートを組み直すときの時間の決め。案の種類の決めに、しおりで人が直した時刻と、泊まる夜ごとの宿を足す */
export function routeTiming(route: Pick<Route, 'style' | 'stopTimes' | 'lodging'>): StyleTiming {
  const base = STYLE_TIMINGS[route.style] ?? STYLE_TIMINGS.shortest
  return {
    ...base,
    ...(route.stopTimes ? { stopTimes: route.stopTimes } : {}),
    ...(route.lodging ? { lodging: route.lodging } : {}),
  }
}

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

/** 移動手段ごとの、表にない区間の移動時間（分）。車は直線距離の式、電車・バスは駅と線路のつながりでの見積もり（domain/transit.ts） */
export function estimateMinutes(from: LatLng, to: LatLng, mode: LegMode = 'car'): number {
  if (mode === 'plane') return estimatedFlightMinutes(from, to)
  if (mode === 'transit') return transitMinutes(from, to)
  if (mode === 'walk') return walkOnlyMinutes(from, to)
  return moveMinutes(distanceKm(from, to))
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

/**
 * 宿の夜で区切った区間の場所を、span 日に分ける。previous は区間の前の宿（なければ null）、first は旅の 1 日目から始まる区間か。
 * inn は区間の終わりの宿（区間の最後の日の夜の宿）。null なら旅の最後の区間（最後の日は出発地へ帰る）。
 * 返す日の数は span 以下（余った日は使わない）。ただし inn があり、区間の最後の日に宿へ間に合わない場所が残ったときは、
 * その場所をまとめた日を 1 つ足して返す（span + 1 個目。splitByNights が宿のあと、次の区間の頭へ回す）
 */
export type DayPacker<T> = (places: readonly T[], span: number, previous: T | null, first: boolean, firstDay?: number, inn?: T | null) => T[][]

/**
 * 時間で日に分ける。
 * 1. 前から順に、その日の DAY_END_MINUTES までに出られる場所を入れ、越える場所から次の日にする。区間の最後の日で宿（inn）があれば、
 *    宿へ移動して LODGING_ARRIVE_MINUTES までに着けない場所から、宿のあと（span + 1 個目）へ回す。宿がなければ最後の日に残りを全部入れる。
 *    スキー場に SKI_LATEST_ARRIVAL_MINUTES より遅く着くなら、その日にほかの場所があれば次の日にする
 * 2. 場所のある日どうしで、となりの日へ場所を 1 つずつ移し、2 日のうち少ないほうのゆとりが増えるあいだ続ける（前の日だけ詰まらないように）。
 *    ゆとりは、その日の終わり（宿の日は宿に着く目安から宿への移動を引いた時刻、旅の最後の日は 19 時から出発地へ帰る移動を引いた時刻）までの空き
 * 3. 夜景（isEveningPlace）は、19 時までの枠に数えず、順番で来た日の最後に置く
 * スキー場は最低の 4 時間で数える（16 時まで延ばすのは、あとに昼の場所がないときだけで、空いた時間を埋めるだけなので）。
 * 移動は区間の既定の手段の見積もり（人が選んだ手段と Routes の時間は見ない）。1 日目は出発地から、宿のあとの日は宿から、
 * それ以外の日は前の日の最後の場所からの移動を数える。人が直した時刻は見ない。
 * 時刻が決まったイベント（place.event）は、開催日の日（firstDay が区間の 1 日目）に入れ、1 日の終わりを越えても次の日に回さない。
 * 開催日まで日が残っていれば、その日まで日を進める（あいだの日は空になることがある。空の日は splitByNights が捨てる）。イベントのある日は 2 でならさない
 */
export function dayPacker(origin: PlanOrigin, timing: StyleTiming): DayPacker<PlanPlace> {
  const guess = (a: LatLng, b: LatLng) => estimateMinutes(a, b, defaultLegMode(a, b, origin.travelMode ?? 'car'))
  return (places, span, previous, first, firstDay = 1, inn = null) => {
    const segmentStart: LatLng | null = previous?.location ?? (first ? origin.location : null)
    /** その日の終わり（場所を出る時刻の上限）。at は最後に出る場所 */
    const limitOf = (dayIndex: number, at: LatLng): number => {
      if (dayIndex !== span - 1) return DAY_END_MINUTES
      if (inn) return LODGING_ARRIVE_MINUTES - guess(at, inn.location)
      const home = homeOf(origin)
      return home ? DAY_END_MINUTES - guess(at, home) : DAY_END_MINUTES
    }
    /** 1 日を回ってみる。from はその日の始まりの位置。end は最後の昼の場所を出る時刻、at はその位置 */
    const simulate = (day: readonly PlanPlace[], from: LatLng | null) => {
      let now = timing.startMinutes
      let at = from
      for (const place of day) {
        if (isEveningPlace(place)) continue
        const window = windowOf(place, origin)
        if (window) {
          now = window.leave
        } else {
          const arrive = now + (at ? guess(at, place.location) : 0)
          now = arrive + stayMinutesFor(place, timing)
        }
        at = place.location
      }
      return { end: now, at }
    }
    const lastDaytime = (day: readonly PlanPlace[]): LatLng | null => day.filter((place) => !isEveningPlace(place)).at(-1)?.location ?? null

    // 1. 前から詰める
    const groups: PlanPlace[][] = []
    const overflow: PlanPlace[] = []
    let day: PlanPlace[] = []
    let now = timing.startMinutes
    let at: LatLng | null = segmentStart
    let hasPlace = false
    places.forEach((place) => {
      const window = windowOf(place, origin)
      // 宿に間に合わない場所を回し始めたら、あとの場所も宿のあとへ（順番を保つ）。ただし時刻の決まったイベントは開催日から動かさない
      if (overflow.length > 0 && !window) {
        overflow.push(place)
        return
      }
      if (window) {
        // 開催日の日まで進める（区間の最後の日より先には進めない。開催日を過ぎていたら、今の日のまま。buildPlan が違う日と知らせる）
        const target = Math.min(window.day - firstDay, span - 1)
        while (groups.length < target) {
          groups.push(day)
          day = []
        }
        day.push(place)
        now = window.leave
        at = place.location
        hasPlace = true
        return
      }
      if (isEveningPlace(place)) {
        day.push(place)
        return
      }
      const arrive = now + (at ? guess(at, place.location) : 0)
      const stay = stayMinutesFor(place, timing)
      const lastDay = groups.length >= span - 1
      const late = arrive + stay > (lastDay && inn ? limitOf(groups.length, place.location) : DAY_END_MINUTES)
        || (place.category === 'ski' && arrive > SKI_LATEST_ARRIVAL_MINUTES)
      if (late && hasPlace && !lastDay) {
        groups.push(day)
        // 次の日は、前の日の最後の場所から（宿のない夜。#602）
        const morning = timing.startMinutes + (at ? guess(at, place.location) : 0)
        day = [place]
        now = morning + stayMinutesFor(place, timing)
      } else if (late && hasPlace && inn) {
        overflow.push(place)
        return
      } else {
        day.push(place)
        now = arrive + stay
      }
      at = place.location
      hasPlace = true
    })
    if (day.length > 0) groups.push(day)

    // 2. となりの日どうしでならす（場所のある日だけ。イベントのある日は動かさない）
    const slackOf = (parts: PlanPlace[][], index: number): number => {
      const from = index === 0 ? segmentStart : lastDaytime(parts[index - 1]) ?? segmentStart
      const result = simulate(parts[index], from)
      if (!result.at) return Infinity
      return limitOf(index, result.at) - result.end
    }
    const hasEvent = (part: readonly PlanPlace[]) => part.some((place) => windowOf(place, origin))
    const movable = (part: readonly PlanPlace[]) => part.filter((place) => !isEveningPlace(place))
    const lateSkiIn = (parts: PlanPlace[][], index: number) => {
      const from = index === 0 ? segmentStart : lastDaytime(parts[index - 1]) ?? segmentStart
      let now = timing.startMinutes
      let here = from
      return movable(parts[index]).some((place, position) => {
        const arrive = now + (here ? guess(here, place.location) : 0)
        now = arrive + stayMinutesFor(place, timing)
        here = place.location
        return position > 0 && place.category === 'ski' && arrive > SKI_LATEST_ARRIVAL_MINUTES
      })
    }
    for (let round = 0; round < places.length * 4; round += 1) {
      let changed = false
      for (let index = 0; index + 1 < groups.length; index += 1) {
        const a = groups[index]
        const b = groups[index + 1]
        if (hasEvent(a) || hasEvent(b) || movable(a).length === 0 || movable(b).length === 0) continue
        const before = Math.min(slackOf(groups, index), slackOf(groups, index + 1))
        const candidates: PlanPlace[][][] = []
        if (movable(a).length > 1) {
          // a の最後の昼の場所を、b の頭へ
          const moved = movable(a).at(-1) as PlanPlace
          candidates.push([...groups.slice(0, index), a.filter((place) => place !== moved), [moved, ...b], ...groups.slice(index + 2)])
        }
        if (movable(b).length > 1) {
          // b の最初の昼の場所を、a の昼の最後へ
          const moved = movable(b)[0]
          const evening = a.filter(isEveningPlace)
          candidates.push([...groups.slice(0, index), [...movable(a), moved, ...evening], b.filter((place) => place !== moved), ...groups.slice(index + 2)])
        }
        for (const candidate of candidates) {
          if (lateSkiIn(candidate, index) || lateSkiIn(candidate, index + 1)) continue
          const after = Math.min(slackOf(candidate, index), slackOf(candidate, index + 1))
          if (after > before + 1e-9) {
            groups.splice(0, groups.length, ...candidate)
            changed = true
            break
          }
        }
      }
      if (!changed) break
    }

    // 3. 夜景は、その日の最後へ
    const parts = groups.map((part) => [...part.filter((place) => !isEveningPlace(place)), ...part.filter(isEveningPlace)])
    if (overflow.length > 0) parts.push(overflow)
    return parts
  }
}

/** 1 日ぶんの場所。day は何日目か（1 日目が 1。場所の少ない旅では、番号が飛ぶことがある） */
export interface DayGroup<T> {
  day: number
  places: T[]
}

/**
 * 回る順番を日に分ける。宿が決まっている夜（lodging。Route.lodging）は、その宿がその日の最後になり、次の場所から翌日になる。
 * 宿と宿のあいだ（と、最後の宿のあと）の場所は、そのあいだの日数に分ける。分け方は pack（しおりでは時間で分ける dayPacker）。
 * pack がなければ、前から同じ数ずつ分ける（splitIntoDays）。宿がなければ、全部の場所を日数で分ける。
 * - pack で分けるとき、宿に着く目安に間に合わない場所は、宿のあと（次の区間の頭）へ回す（#602）
 * - pack で分けるとき、宿の日に宿しか残らない（区間の場所が、宿の前の日までに収まった）ときは、区間の最後の場所を宿の日へ回す（朝に宿へ着く行を作らない）
 * - 宿を取らない夜（LODGING_SKIP）は、日の分け方を変えない
 * - 泊まる夜は 1 〜 days - 1。それより先の夜、順番にないピン、夜の順と回る順が食い違う宿は、宿として扱わない（ふつうの場所として並ぶ）
 * - 宿より前の場所が日数より少ないときは、宿だけの日ができる（1 日目に 1 か所、2 日目の夜の宿、なら 2 日目は宿だけ）
 * used は、lodging のうち使った分だけ（組み直したあとに保存する形）
 */
export function splitByNights<T extends { id: string }>(
  order: readonly T[],
  days: number,
  lodging: Readonly<Record<string, string>> = {},
  pack?: DayPacker<T>,
): { groups: DayGroup<T>[]; used: Record<string, string> } {
  const used: Record<string, string> = {}
  const cuts: { night: number; index: number }[] = []
  let lastIndex = -1
  for (let night = 1; night < days; night += 1) {
    const value = lodging[String(night)]
    if (typeof value !== 'string') continue
    if (isLodgingSkip(value)) {
      used[String(night)] = value
      continue
    }
    const index = order.findIndex((place) => place.id === value)
    if (index <= lastIndex) continue
    used[String(night)] = value
    cuts.push({ night, index })
    lastIndex = index
  }

  const groups: DayGroup<T>[] = []
  let from = 0
  let firstDay = 1
  // 区間の前の宿（1 つ目の区間は null）
  let previous: T | null = null
  // lastDay は、区間の終わりが宿の夜のときの、その夜の日（宿の日に場所を 1 つ残すため）。最後の区間は null。inn はその夜の宿。
  // 宿に間に合わず、宿のあとへ回す場所を返す（pack が span + 1 個目の日として返したもの。#602）
  const pushDays = (places: readonly T[], span: number, lastDay: number | null, inn: T | null): T[] => {
    if (places.length === 0) return []
    const parts = pack ? pack(places, span, previous, firstDay === 1, firstDay, inn) : splitIntoDays(places, span)
    const carried = pack && parts.length > span ? (parts.pop() ?? []) : []
    // 時間で分けるとき（pack）、区間の場所が 2 つ以上あれば、最後の場所を宿の日へ回す（1 つだけなら、前の日を空にしないよう、そのまま）。
    // 場所の数で分けるときは、今までどおり回さない（宿より前の場所が日数より少ないと、宿だけの日ができる）。
    // 最後の場所が時刻の決まったイベントなら回さない（開催日の日から動かさない）
    const last = parts.at(-1)?.at(-1) as { event?: unknown } | undefined
    const tail = pack && lastDay !== null && parts.length < span && places.length > 1 && !last?.event ? parts.at(-1)?.pop() : undefined
    if (parts.at(-1)?.length === 0) parts.pop()
    // イベントの開催日まで日を進めたときは、あいだに空の日がある。空の日は行を作らない
    parts.forEach((part, index) => {
      if (part.length > 0) groups.push({ day: firstDay + index, places: part })
    })
    if (tail !== undefined && lastDay !== null) groups.push({ day: lastDay, places: [tail] })
    return carried
  }
  // 前の区間で宿に間に合わなかった場所（次の区間の頭に入れる）
  let carry: T[] = []
  for (const cut of cuts) {
    carry = pushDays([...carry, ...order.slice(from, cut.index)], cut.night - firstDay + 1, cut.night, order[cut.index])
    const last = groups[groups.length - 1]
    if (last?.day === cut.night) last.places.push(order[cut.index])
    else groups.push({ day: cut.night, places: [order[cut.index]] })
    from = cut.index + 1
    firstDay = cut.night + 1
    previous = order[cut.index]
  }
  pushDays([...carry, ...order.slice(from)], days - firstDay + 1, null, null)
  return { groups, used }
}

/**
 * 建った宿を、しおりのどの夜の宿にするかを決めて、回る順番に差し込む。
 * - 空いている夜（宿のピンが決まっていない夜。宿を取らないと決めた夜も、宿が建てば宿にする）から選ぶ
 * - want（「宿を探す」を押した夜）が空いていれば、その夜
 * - そうでなければ、空いている夜のうち、その日の最後の場所（その日に場所がなければ、それより前の最後の場所）が宿にいちばん近い夜。同じなら早い夜
 * - 差し込む位置は、その夜までの最後の場所のすぐあと
 * - 空いている夜がなければ null（日帰りの旅、全部の夜の宿が決まっている。呼ぶ側が、ふつうの場所として足す）
 */
export function assignLodging<T extends { id: string; location: LatLng }>(
  order: readonly T[],
  place: T,
  days: number,
  lodging: Readonly<Record<string, string>> = {},
  want: number | null = null,
  pack?: DayPacker<T>,
): { order: T[]; lodging: Record<string, string>; night: number } | null {
  const { groups, used } = splitByNights(order, days, lodging, pack)
  const free: number[] = []
  for (let night = 1; night < days; night += 1) {
    const value = used[String(night)]
    if (value === undefined || isLodgingSkip(value)) free.push(night)
  }
  if (free.length === 0) return null
  // その夜までの最後の場所（差し込む位置の 1 つ前）。なければ null（先頭に差し込む）
  const anchorOf = (night: number): T | null => {
    const before = groups.filter((group) => group.day <= night)
    return before[before.length - 1]?.places.at(-1) ?? null
  }
  let night = want !== null && free.includes(want) ? want : free[0]
  if (night !== want) {
    let nearestKm = Infinity
    for (const candidate of free) {
      const anchor = anchorOf(candidate)
      const km = anchor ? distanceKm(anchor.location, place.location) : Infinity
      if (km < nearestKm - 1e-9) {
        night = candidate
        nearestKm = km
      }
    }
  }
  const anchor = anchorOf(night)
  const index = anchor ? order.findIndex((item) => item.id === anchor.id) + 1 : 0
  return {
    order: [...order.slice(0, index), place, ...order.slice(index)],
    lodging: { ...used, [String(night)]: place.id },
    night,
  }
}

export interface Plan {
  /**
   * 行の ID を、しおりの行の順に（Route.pinIds に保存する形）。渡した順番と違うことがある：夜景はその日の最後へ、宿に間に合わない場所は
   * 宿のあとへ回す（dayPacker。#602）。組み直す機能は、結果を広げて保存するので、保存する順番もしおりの行の順にそろう
   */
  pinIds: string[]
  schedule: RouteStop[]
  totalMoveMinutes: number
  totalDistanceKm: number
  originIncluded: boolean
  /**
   * 区間ごとに選んだ手段のうち、今の順番にある区間の分だけ（順番を入れ替えて、なくなった区間の選択は外す）。
   * legModes か flights を渡したときだけ入る（渡さなければ、保存してある値を変えない）
   */
  legModes?: Record<string, LegMode>
  /**
   * 飛行機の区間の行き方のうち、今の順番にある飛行機の区間の分だけ。legModes か flights を渡したときだけ入る
   * （区間の手段を 1 つも選んでいないしおりでも、既定で飛行機になった区間の便を残すため）
   */
  legFlights?: Record<string, LegFlight>
  /**
   * しおりで人が直した時刻のうち、今のしおりにある行の分だけ（消えた場所の分は外す）。
   * timing.stopTimes を渡したときだけ入る（渡さなければ、保存してある値を変えない）
   */
  stopTimes?: Record<string, number>
  /**
   * 泊まる夜ごとの宿のうち、今のしおりで使った分だけ（消えた宿、日程より先の夜の分は外す）。
   * timing.lodging を渡したときだけ入る（渡さなければ、保存してある値を変えない）
   */
  lodging?: Record<string, string>
}

/**
 * 飛行機の区間の行き方。saved はルートに残してある便（組み直すときはこの所要時間を使う）。
 * plan を渡すと、飛行機の区間の便を時刻表から決める（区間を出発する時刻と日から。時刻表を読んで渡すのは usecase。domain/flightPlanner.ts）。
 * plan で決め直すのは、planKey があればその区間、なければ全部の飛行機の区間（fillMissing なら、決め直す区間はない）。
 * 決め直さない区間は、残してある便に乗れればそれを使い、便が決まっていない・乗れなくなった区間は plan で探す（押さなくても便が出るように。かめの決定、2026-11-20、#482）
 */
export interface FlightChoices {
  saved?: Readonly<Record<string, LegFlight>>
  plan?: (from: LatLng, to: LatLng, departAt: number, day: number) => LegFlight
  /** plan で決め直す区間（キー）。1 つの区間の「飛行機」を押し直しても、ほかの区間の乗れる便は変えない */
  planKey?: string
  /**
   * true なら、残してある便に乗れる区間は便を変えず、便が決まっていない区間と乗れなくなった区間だけを埋める（しおりを作る・組み直すときの形）。
   * plan がなければ（時刻表が取れない）、その区間は距離の式の目安にして残す
   */
  fillMissing?: boolean
}

/**
 * しおりの時刻が決まったイベント 1 つが、組んだしおりで守れているか（buildPlan の eventChecks に入る。保存はしない）
 */
export interface EventCheck {
  /** イベントの行の ID */
  id: string
  /** 開催日の日に並んでいるか */
  onDay: boolean
  /**
   * 前の行をいつもどおりに出て移動したときに、イベントに着くべき時刻まで残る余裕（分）。前の行がなければ、その日の始まりか出発から。
   * 負なら、前の予定がイベントの時間に食い込んでいる（間に合わない）
   */
  slack: number
  /**
   * 前の行を縮めても（いる時間を 0 分まで）、イベントに着くべき時刻に間に合わない分（分）。0 なら間に合う。
   * 前の行の出る時刻を人が直してあれば、その時刻に出るとして数える（直した出る時刻は、イベントの時刻に負けて消えない）
   */
  late: number
  /** イベントに入る移動の時間（分）。自動で組むときの余裕（domain/event.ts の eventBufferMinutes）を決めるのに使う */
  moveIn: number
  /** あとの行の、人が直した着く時刻が、イベントを出る前（となりの行なら、出て移動し終わる前）に入り込んでいる分（分）。0 なら重ならない */
  overlap: number
}

/** イベントの時間と重なっている（間に合わない、あとの行が入り込む、開催日と違う日）か。人が時刻を直すときの確認に使う */
export function eventClashes(checks: readonly EventCheck[]): string[] {
  return checks.filter((check) => !check.onDay || check.late > 0 || check.overlap > 0).map((check) => check.id)
}

/**
 * 自動で組むときに、イベントの守り方が足りない分（0 なら十分）。違う日は大きく数え、そのほかは余裕の足りない分と重なった分を足す。
 * 余裕は移動に応じて増やす（domain/event.ts の eventBufferMinutes）
 */
export function eventShortfall(checks: readonly EventCheck[]): number {
  return checks.reduce(
    (sum, check) => sum + (check.onDay ? 0 : 10_000) + Math.max(0, eventBufferMinutes(check.moveIn) - check.slack) + check.overlap,
    0,
  )
}

/**
 * 回る順番から、日ごとのスケジュール（時刻、場所、滞在時間、次への移動）を作る。
 * - 1 日目は、出発地の位置が分かれば「出発」の行から始める。分からなければ、1 つ目の場所から始める
 * - 2 日目からは、その日の 1 つ目の場所から始める（前の夜の宿が決まっていなければ、宿からの移動は入れない）
 * - 宿が決まっている夜（timing.lodging）は、宿がその日の最後の行になる（splitByNights）。宿の行のいる時間は、着いてから翌朝の
 *   出発（1 日の始まりの時刻）まで。翌日は宿を出るところから始まり、1 つ目の場所には、宿からの移動のあとに着く
 * - 日をまたぐ移動（前の日の最後 → 次の日の最初）は、前の日の最後の行の「次への移動」に入れ、合計にも足す
 * - 帰りの移動は入れない
 * - 区間の手段は、legModes（しおりの移動の行で選んだもの）にあればそれ、なければ旅全体の手段（origin.travelMode）
 * - 移動時間は、車の区間で travel（Routes API の表）にその区間があればそれを、なければその手段の見積もり（estimateMinutes）を使う
 * - 1 日目の出発の行には、出発時間（time）と集合時間（meetTime）を入れる。集合時間は、決めていなければ出発の MEET_LEAD_MINUTES 分前
 * - しおりで人が直した時刻（timing.stopTimes）は、計算より優先する。出発時間を直せば 1 日目がそこから始まり、
 *   場所に着く時刻を直せば、その場所からあとがずれる。同じ日の前の場所にいる時間は、直した時刻に着くように伸び縮みさせる
 *   （移動に間に合わない早い時刻でも、入れた時刻をそのまま使う。いる時間は 0 分で止める）。
 *   ただし前の場所からの区間が飛行機なら、前の場所にいる時間と便は変えず、直した時刻までの余りは着いた先の待ちとみなす。
 *   場所を出る時刻（leaveKey）を直せば、その場所にいる時間を「出る時刻 − 着く時刻」（0 分で止める）にし、そこからあとがずれる。
 *   出る時刻と、次の場所の着く時刻を両方直してあるときは、着く時刻が勝ち、出る時刻は返す stopTimes から外す
 *   （set-stop-time は直すときに片方を外す。建物や行を消して隣り合ったときは、ここで外れる）
 * - 時刻が決まったイベント（place.event。#581）は、着く時刻を「始まり − 早めに着く分」、出る時刻を終わりに固定する。人が直した時刻より優先し、
 *   イベントの行の直した時刻は使わない。前の場所にいる時間は、ほかの直した着く時刻と同じに伸び縮みさせる。イベントの行にいる時間は変えない。
 *   守れているか（間に合うか、あとの行が入り込まないか、開催日の日か）は、eventChecks を渡すとそこに入れる（Plan には入れない。保存しないため）
 */
export function buildPlan(
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  timing: StyleTiming,
  travel?: TravelTable,
  legModes?: LegModes,
  flights?: FlightChoices,
  eventChecks?: EventCheck[],
): Plan {
  const schedule: RouteStop[] = []
  let totalMoveMinutes = 0
  let totalDistanceKm = 0
  const usedModes: Record<string, LegMode> = {}
  const usedFlights: Record<string, LegFlight> = {}
  // 飛行機で組んだ区間（選んだものも、既定で飛行機になったものも）
  const planeKeys = new Set<string>()
  // 区間ごとに選んだ手段があればそれ、なければ旅全体の手段。Routes の表（車の時間）は、車の区間にだけ使う。
  // 飛行機は、決め直す区間と、乗れる便が残っていない区間なら plan、そうでなければ残してある便、どちらもなければ距離の式の目安
  const minutesFor = (from: string, to: string, a: LatLng, b: LatLng, departAt: number, day: number) => {
    const key = travelKey(from, to)
    // 徒歩は、上限より遠い区間では使わない（前に選んだ区間が、順番の入れ替えで遠くなったときは選択を外す）
    const picked = legModes?.[key]
    const tooFar = picked === 'walk' && distanceKm(a, b) > WALK_MAX_KM
    // 飛行機も、下限より近い区間では使わない
    const tooNear = picked === 'plane' && distanceKm(a, b) < PLANE_MIN_KM
    const chosen = tooFar || tooNear ? undefined : picked
    if (chosen) usedModes[key] = chosen
    // 選んでいない区間は、区間の既定（遠い区間と島への区間は飛行機、ほかは旅全体の手段。domain/flight.ts の defaultLegMode）
    const mode = chosen ?? defaultLegMode(a, b, origin.travelMode ?? 'car')
    if (mode === 'plane') {
      planeKeys.add(key)
      const saved = flights?.saved?.[key]
      const plan = flights?.plan
      // 残してある便は、同じ日で出発が遅くなっていなければ使える（目安はいつも使える）。乗れないかもしれなければ null
      const reused = saved ? reuseFlight(saved, departAt, day) : null
      const replan = flights?.planKey !== undefined ? flights.planKey === key : !flights?.fillMissing
      const estimate = (): LegFlight => ({ minutes: estimatedFlightMinutes(a, b), flight: null, fetchedAt: null, departAt, day })
      // 時刻表があれば、決め直す区間と、乗れる便が残っていない区間（まだ探していない、目安のまま、乗れなくなった）の便を探す。
      // 時刻表がなければ、残してあるものを使い、乗れなくなった便は外して目安にする
      const leg = plan && (replan || !reused?.flight)
        ? plan(a, b, departAt, day)
        : reused ?? (saved || flights?.fillMissing ? estimate() : undefined)
      if (leg) {
        usedFlights[key] = leg
        return leg.minutes
      }
    }
    return (mode === 'car' ? travel?.get(key) : undefined) ?? estimateMinutes(a, b, mode)
  }
  const originIncluded = origin.location !== null && order.length > 0
  // 種類の目安を使うとき（stayScale がある）は、時間で日に分ける。ないときは場所の数で分ける
  const pack = timing.stayScale !== undefined ? dayPacker(origin, timing) : undefined
  const { groups, used: usedLodging } = splitByNights(order, days, timing.lodging, pack)
  const lodgingIds = new Set(Object.values(usedLodging).filter((value) => !isLodgingSkip(value)))
  // 人が直した時刻。今のしおりにある行の分だけを残す（集合時間と出発時間は、出発地の位置が分からなくなっても残す）
  const fixedTimes = timing.stopTimes ?? {}
  const usedTimes: Record<string, number> = {}
  const fixedAt = (key: string): number | undefined => {
    const value = fixedTimes[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= DAY_MINUTES) return undefined
    usedTimes[key] = value
    return value
  }
  for (const key of [MEET_KEY, ORIGIN_KEY]) fixedAt(key)

  // 日をまたぐ区間が飛行機のとき、翌日はその到着から始める（翌朝の便で着く前に、翌日の 1 つ目の場所の時刻を出さない）
  let nextDayStart = timing.startMinutes
  // しおりの最後の場所（出発地へ帰る移動の目安を、その行に書く）
  let lastPlace: PlanPlace | null = null
  groups.forEach(({ day, places: group }, dayIndex) => {
    let now = dayIndex === 0 ? timing.startMinutes : nextDayStart
    nextDayStart = timing.startMinutes
    if (dayIndex === 0 && origin.location && group.length > 0) {
      // 出発時間を直していれば、そこから始める。
      // 本当は、電車・バスの区間なら、入れた時刻にいちばん近い電車の発車時刻に合わせたい（出発地の最寄り駅を、入れた時刻の前後で
      // いちばん近く出る電車。同じ近さなら遅いほう。集合時間より前になるなら、集合時間のあとの最初の電車）。
      // いまは電車の時刻表を引く仕組みがない（domain/transit.ts は時刻表を使わない見積もり）ので、入れた時刻をそのまま使う。
      // 飛行機の区間は、この時刻から便を選ぶ（features/set-stop-time が時刻表を読んで flights.plan を渡す）
      now = fixedAt(ORIGIN_KEY) ?? now
      const meet = fixedAt(MEET_KEY) ?? Math.max(0, now - MEET_LEAD_MINUTES)
      const km = distanceKm(origin.location, group[0].location)
      const move = minutesFor(ORIGIN_KEY, group[0].id, origin.location, group[0].location, now, day)
      schedule.push({ day, time: clock(now), pinId: null, name: `${origin.name} 出発`, stayMinutes: 0, moveMinutesToNext: move, meetTime: clock(meet) })
      totalMoveMinutes += move
      totalDistanceKm += km
      now += move
    }
    // 同じ日の、1 つ前の場所の行と、そこに着いた時刻（直した着く時刻に合わせて、いる時間を伸び縮みさせる）。check は、その行がイベントなら守れているかの記録
    let previous: { stop: RouteStop; arrivedAt: number; id: string; check: EventCheck | null } | null = null
    // この日のイベントのうち、いちばん遅く出るもの（あとの行の直した着く時刻が、これより早いと重なる）
    let eventEnd: { leave: number; check: EventCheck } | null = null
    group.forEach((place, index) => {
      const window = windowOf(place, origin, days)
      const fixed = window ? window.arrive : fixedAt(place.id)
      const check: EventCheck | null = window
        ? { id: place.id, onDay: window.day === day, slack: window.arrive - now, late: 0, moveIn: schedule.at(-1)?.moveMinutesToNext ?? 0, overlap: 0 }
        : null
      if (check) eventChecks?.push(check)
      if (fixed !== undefined && previous?.check) {
        // 1 つ前がイベントの行なら、そこにいる時間は変えない。イベントを出て移動し終わるより早く着く時刻は、重なっている
        // （この行もイベントなら、この行の slack が負になるので、ここでは数えない）
        const over = previous.arrivedAt + previous.stop.stayMinutes + (previous.stop.moveMinutesToNext ?? 0) - fixed
        if (!window) previous.check.overlap = Math.max(previous.check.overlap, over)
        else if (check) check.late = Math.max(0, over)
        now = fixed
      } else if (fixed !== undefined) {
        // 前の行より前に終わるイベントがあり、そこを出る前の時刻にしたときも重なっている
        if (!window && eventEnd && fixed < eventEnd.leave) eventEnd.check.overlap = Math.max(eventEnd.check.overlap, eventEnd.leave - fixed)
        // 前の場所からの区間が飛行機のときは、前の場所にいる時間を変えない。便は決まった滞在のあとの出る時刻で選んであり、
        // いる時間を伸ばすと、ここを出る前に発つ便になるため。直した時刻までに余った分は、着いた先の待ちとみなす
        // （便を選び直すと、直した時刻より遅く着く便や、組み直すたびに見え方の変わる便になるので、選び直さない）
        // 選んだ飛行機の区間も、既定で飛行機になった区間（legModes に入らない）も見る
        const flew = previous !== null && planeKeys.has(travelKey(previous.id, place.id))
        // イベントの前の行の出る時刻を人が直してあれば、その時刻を守る（イベントの時刻に合わせて縮めない。重なりは late で知らせる）
        const keepLeave = window !== null && previous !== null && usedTimes[leaveKey(previous.id)] !== undefined
        if (check) {
          // 前の行を（直した出る時刻か、0 分まで縮めて）出て移動し終わる時刻。前の行がなければ、その日の始まりか出発からの移動のあと
          const ready = previous ? previous.arrivedAt + (flew || keepLeave ? previous.stop.stayMinutes : 0) + (previous.stop.moveMinutesToNext ?? 0) : now
          check.late = Math.max(0, ready - fixed)
        }
        if (previous && !flew && !keepLeave) {
          previous.stop.stayMinutes = Math.max(0, fixed - previous.arrivedAt - (previous.stop.moveMinutesToNext ?? 0))
          // 前の場所の直した出る時刻は、この着く時刻に負けて効かないので、残さない（建物や行を消して隣り合ったときも）
          delete usedTimes[leaveKey(previous.id)]
        }
        now = fixed
      }
      // 夜景は、日の入りのあとに着くようにする（前の場所を出る時刻は変えない。待つ分は、しおりのゆとりに出る。#602）
      const evening = fixed === undefined && !window && !lodgingIds.has(place.id) && isEveningPlace(place)
      if (evening) now = Math.max(now, nightStartMinutes(origin.startDate, day))
      // 宿にいる時間は、着いてから翌朝の出発まで（画面は「宿泊」と、翌朝に出る時刻を出す）
      // 着くのが 24 時を過ぎた（now が 1 日の分の数以上）ときも、出るのは翌朝の同じ時刻にする
      const untilMorning = now < DAY_MINUTES ? DAY_MINUTES - now + timing.startMinutes : Math.max(0, timing.startMinutes - (now - DAY_MINUTES))
      // 出る時刻を直していれば、そこまでいる（着く時刻より早ければ、すぐ出る）。宿の行は翌朝に出るので、直した出る時刻は使わない。
      // イベントの行は、終わりの時刻まで（直した出る時刻は使わない）
      const leave = lodgingIds.has(place.id) || window ? undefined : fixedAt(leaveKey(place.id))
      const stayMinutes = lodgingIds.has(place.id)
        ? untilMorning
        : window
          ? window.leave - window.arrive
          : leave !== undefined
            ? Math.max(0, leave - now)
            // スキー場を 16 時まで延ばすのは、その日のあとに昼の場所がないときだけ（あれば最低の 4 時間。#602）
            : stayMinutesFor(place, timing, group.slice(index + 1).some((later) => !isEveningPlace(later) && !lodgingIds.has(later.id)) ? undefined : now)
      const next = group[index + 1] ?? groups[dayIndex + 1]?.places[0]
      let move: number | null = null
      if (next) {
        const km = distanceKm(place.location, next.location)
        // 日をまたぐ区間（その日の最後の場所 → 次の日の最初の場所）は、次の日の始まりに出るとみなす（飛行機の便を翌朝から探すため）
        const crossesDay = index === group.length - 1
        move = minutesFor(
          place.id,
          next.id,
          place.location,
          next.location,
          crossesDay ? timing.startMinutes : now + stayMinutes,
          crossesDay ? day + 1 : day,
        )
        totalMoveMinutes += move
        totalDistanceKm += km
        // 宿から出る翌日も、宿を出る時刻（1 日の始まり）に移動を足した時刻から始める。
        // 宿を取らない夜の翌朝も、前の日の最後の場所から移動して始める（#602。前は移動なしで、翌朝 9 時に次の場所にいた）
        if (crossesDay) nextDayStart = timing.startMinutes + move
      }
      const stop: RouteStop = {
        day,
        time: clock(now),
        pinId: place.pinId ?? place.id,
        name: place.name,
        stayMinutes,
        moveMinutesToNext: move,
        // 複製した行（同じ場所の 2 回目からの訪問）にだけ、行の ID を入れる
        ...(place.pinId ? { stopId: place.id } : {}),
        ...(evening ? { evening: true } : {}),
      }
      lastPlace = place
      schedule.push(stop)
      previous = { stop, arrivedAt: now, id: place.id, check }
      if (window && check && (!eventEnd || window.leave > eventEnd.leave)) eventEnd = { leave: window.leave, check }
      now += stayMinutes + (move ?? 0)
    })
  })

  // 旅の最後の場所から出発地へ帰る移動の目安（行は足さない。最後の日のゆとりから引く。#602）。宿の行が最後なら書かない
  const finalStop = schedule.at(-1)
  const home = lastPlace as PlanPlace | null
  const goal = homeOf(origin)
  if (finalStop && finalStop.pinId !== null && home && goal && !lodgingIds.has(home.id)) {
    finalStop.returnMinutes = estimateMinutes(home.location, goal, defaultLegMode(home.location, goal, origin.travelMode ?? 'car'))
  }
  return {
    pinIds: schedule.flatMap((stop) => (stop.pinId === null ? [] : [stop.stopId ?? stop.pinId])),
    schedule,
    totalMoveMinutes,
    totalDistanceKm: Math.round(totalDistanceKm),
    originIncluded,
    ...(legModes || flights ? { legModes: usedModes, legFlights: usedFlights } : {}),
    ...(timing.stopTimes ? { stopTimes: usedTimes } : {}),
    ...(timing.lodging ? { lodging: usedLodging } : {}),
  }
}

/**
 * 順番どおりに組んだときの、イベントのまわりの良し悪し（小さいほどよい）。short はイベントの守り方が足りない分（eventShortfall）、
 * over はイベントと宿のほかの行が 1 日の終わり（DAY_END_MINUTES）を越えていた分の合計（夜のイベントのあとに場所が並ばないように）。
 * idle は、イベントの前に余裕より多く空いてしまう時間（30 分きざみの数。ほかの場所を全部翌日に回して、イベントの日を待つだけにしないように）。
 * 飛行機の便は時刻表を引かずに、残してある便か目安で見る
 */
function eventCost(order: readonly PlanPlace[], origin: PlanOrigin, days: number, timing: StyleTiming, legModes?: LegModes): Cost {
  const checks: EventCheck[] = []
  const plan = buildPlan(order, origin, days, timing, undefined, legModes, undefined, checks)
  const skipped = new Set([
    ...Object.values(plan.lodging ?? timing.lodging ?? {}).filter((value) => !isLodgingSkip(value)),
    ...order.filter((place) => place.event).map((place) => place.id),
  ])
  const over = plan.schedule.reduce((sum, stop) => {
    const id = stop.stopId ?? stop.pinId
    if (id === null || skipped.has(id) || stop.evening) return sum
    const leave = Number(stop.time.slice(0, 2)) * 60 + Number(stop.time.slice(3, 5)) + stop.stayMinutes
    return sum + Math.max(0, leave - DAY_END_MINUTES)
  }, 0)
  const idle = checks.reduce((sum, check) => sum + Math.floor(Math.max(0, check.slack - eventBufferMinutes(check.moveIn)) / 30), 0)
  return { short: eventShortfall(checks), over, idle }
}

interface Cost {
  short: number
  over: number
  idle: number
}

/** a のほうが b より良いか（short、over、idle の順に比べる） */
const betterCost = (a: Cost, b: Cost): boolean => {
  for (const key of ['short', 'over', 'idle'] as const) {
    if (a[key] < b[key] - 1e-9) return true
    if (a[key] > b[key] + 1e-9) return false
  }
  return false
}

/**
 * 場所を 1 つ足すとき、どこに入れるか（insertionIndex の、時刻が決まったイベントを守る形）。#581。
 * しおりにも足す場所にもイベントがなければ（か、旅の開始日が分からなければ）、insertionIndex と同じ。
 * あれば、入れられる位置を全部組んでみて、イベントの守り方が足りない分（eventShortfall。開催日と違う日、余裕の足りない分、重なった分）が
 * いちばん少ない位置にする。同じなら、1 日の終わりを越える分が少ない位置、次にイベントの前の空き時間が少ない位置、それも同じなら移動（直線距離）がいちばん増えない位置、それも同じなら後ろのほう
 */
export function eventAwareIndex(
  order: readonly PlanPlace[],
  place: PlanPlace,
  origin: PlanOrigin,
  days: number,
  timing: StyleTiming,
  legModes?: LegModes,
): number {
  if (!origin.startDate || !(place.event || order.some((item) => item.event))) return insertionIndex(order, place, origin)
  const before = pathKm(order, origin)
  let best = { index: order.length, cost: { short: Infinity, over: Infinity, idle: Infinity } as Cost, km: Infinity }
  for (let index = order.length; index >= 0; index -= 1) {
    const trial = [...order.slice(0, index), place, ...order.slice(index)]
    const cost = eventCost(trial, origin, days, timing, legModes)
    const km = pathKm(trial, origin) - before
    const tie = !betterCost(cost, best.cost) && !betterCost(best.cost, cost)
    if (betterCost(cost, best.cost) || (tie && km < best.km - 1e-9)) best = { index, cost, km }
  }
  return best.index
}

/**
 * 回る順番を、時刻が決まったイベントを守る形に直す（Gemini や案の順番をそのまま信じない。#581）。
 * 今の順番で守れていて、1 日の終わりを越える行も、イベントの前の余分な空きもなければそのまま。そうでなければ、イベントをいったん外し、開催の早い順に eventAwareIndex で入れ直す。
 * 入れ直したほうが良くなったときだけ、入れ直した順にする
 */
export function settleEvents(
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  timing: StyleTiming,
  legModes?: LegModes,
): PlanPlace[] {
  if (!origin.startDate || !order.some((place) => place.event)) return [...order]
  const now = eventCost(order, origin, days, timing, legModes)
  if (now.short === 0 && now.over === 0 && now.idle === 0) return [...order]
  const startOf = (place: PlanPlace) => (place.event ? `${place.event.date} ${String(place.event.start).padStart(4, '0')}` : '')
  const events = order.filter((place) => place.event).sort((left, right) => startOf(left).localeCompare(startOf(right)))
  let settled = order.filter((place) => !place.event)
  for (const place of events) {
    const index = eventAwareIndex(settled, place, origin, days, timing, legModes)
    settled = [...settled.slice(0, index), place, ...settled.slice(index)]
  }
  return betterCost(eventCost(settled, origin, days, timing, legModes), now) ? settled : [...order]
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
