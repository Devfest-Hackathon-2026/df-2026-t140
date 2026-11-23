import { defaultLegMode } from '../../../domain/flight'
import type { LatLng } from '../../../domain/pin'
import { isLodgingSkip, type Route, type RouteStop } from '../../../domain/route'
import { distanceKm, estimateMinutes, travelKey } from '../../../domain/routePlan'
import type { LegMode, TravelMode } from '../../../domain/travelMode'
import type { MapBounds } from '../../../domain/wish'

// 宿さがしの「どこに泊まるか」の決め（純粋。I/O なし）。Takana の決定（todo/humans/2026-11-22-lodging-search-realistic.md）。
//
// しおりから、その夜の最後の場所（そこを出る時刻）と、翌日の最初の場所と、2 つのあいだの移動を読み、泊まる側を決める。
// - 移動が飛行機か LONG_MOVE_MINUTES より長い夜は、移動の途中に泊まらない。ふだんは最後の場所の側（stay）。
//   夜のうちに移ってもホテルの上限までに着けるときだけ、翌日の場所の側（move）
// - 車の旅で、2 つのあいだも車で移る夜は、移動の長さにかかわらず、道の途中のうち着ける所ならどこでも（route。Takana の依頼、2026-11-22）。
//   探す範囲は、最後の場所から、ホテルの上限までに車で進める所まで（遠い区間を、どちらかの場所の近くに寄せない）
// - それ以外は、2 つの場所のあいだ（between。Youkin06 の依頼、2026-11-21）
// - 翌日の場所がなければ、最後の場所の側（stay）
// 候補は、宿に着く時刻（旅館 18:00、ホテル 21:00）と、寄り道の時間（DETOUR_MAX_MINUTES）でふるい、寄り道の短い順に並べる。

/** 夕食付きの旅館に着く時刻の上限（0 時からの分）。Takana の決定 */
export const RYOKAN_ARRIVE_BY = 18 * 60
/** ホテル（ゲストハウス、貸別荘などを含む）に着く時刻の上限。Takana の決定 */
export const HOTEL_ARRIVE_BY = 21 * 60
/** この長さより長い移動（分）の途中には泊まらない。AI が仮に選んだ（新幹線で 1 時間半を超える移動） */
export const LONG_MOVE_MINUTES = 90
/** 宿へ寄ることで延びてよい道のり（分）。AI が仮に選んだ */
export const DETOUR_MAX_MINUTES = 45
/** 翌日の側に泊まると決めるときに見込む、行き先から宿までの移動（分）。AI が仮に選んだ（近い宿でも、乗り降りを含めて 15 分ほどかかる） */
export const LODGING_HOP_MINUTES = 15
/**
 * その日の予定が遅くまで続く夜（夜景、花火大会など。最後の場所を出てからこの時間では、もうホテルの上限に間に合わない夜）に、
 * 最後の場所から宿までにかけてよい時間（分）。上限はこの分だけ後ろにずらす（予定そのものが遅い夜に、宿の候補が 0 件にならないように）。
 * AI が仮に選んだ（#631 のレビュー）
 */
export const LATE_REACH_MINUTES = 30
/** 泊まる側のまわりの探す範囲の半分の幅（度。緯度 0.14 度で約 15 km）。画面の lodgingSearchBounds と同じ */
const SIDE_LAT = 0.14
const SIDE_LNG = 0.17

/** 宿の種類。ryokan は夕食付きの旅館（着く上限が早い）。それ以外は hotel */
export type LodgingKind = 'ryokan' | 'hotel'

export type LodgingSide = 'stay' | 'move' | 'between' | 'route'

export interface LodgingStop {
  name: string
  location: LatLng
}

/** 宿さがしに使う、その夜のしおりの様子 */
export interface LodgingContext {
  night: number
  /** その日の最後の場所と、そこを出る時刻（0 時からの分） */
  from: LodgingStop & { leaveAt: number }
  /** 翌日の最初の場所。なければ null */
  next: LodgingStop | null
  /** 最後の場所から翌日の場所への移動の手段と、その目安（分）。翌日の場所がなければ null */
  move: { mode: LegMode; minutes: number } | null
  side: LodgingSide
  /** 宿への移動に使う手段（旅全体の手段） */
  tripMode: TravelMode
  /** 探す範囲（泊まる側のまわり） */
  bounds: MapBounds
}

/** 時刻の文字（HH:MM）を 0 時からの分に。読めなければ null */
function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** 2 点の移動の目安（分）。遠い区間（飛行機を既定にする区間）は飛行機で数える */
function legMinutes(from: LatLng, to: LatLng, tripMode: TravelMode): number {
  return estimateMinutes(from, to, defaultLegMode(from, to, tripMode))
}

/** from から to へ、まっすぐ fraction（0〜1）だけ進んだ点 */
function pointAlong(from: LatLng, to: LatLng, fraction: number): LatLng {
  return { lat: from.lat + (to.lat - from.lat) * fraction, lng: from.lng + (to.lng - from.lng) * fraction }
}

/**
 * 車で移る夜に、最後の場所から翌日の場所へ向かう道のうち、ホテルの上限までに進める割合（0〜1）。
 * 移動の目安（minutes）を道のりに比例して割る。上限までに翌日の場所まで行けるなら 1
 */
export function reachableFraction(leaveAt: number, minutes: number): number {
  const budget = hotelArriveBy(leaveAt) - leaveAt
  if (minutes <= 0 || budget >= minutes) return 1
  return Math.max(0, budget / minutes)
}

function boundsAround(points: readonly LatLng[]): MapBounds {
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const lat = (Math.max(...lats) + Math.min(...lats)) / 2
  const lng = (Math.max(...lngs) + Math.min(...lngs)) / 2
  const halfLat = Math.max(SIDE_LAT, (Math.max(...lats) - Math.min(...lats)) / 2)
  const halfLng = Math.max(SIDE_LNG, (Math.max(...lngs) - Math.min(...lngs)) / 2)
  return { north: lat + halfLat, south: lat - halfLat, east: lng + halfLng, west: lng - halfLng }
}

/**
 * しおりから、宿さがしの様子を作る。その夜の最後の場所が分からない（しおりに場所がない）ときは null（地図の範囲で探す）。
 * stops は、ピンの ID から場所の名前と位置を引く（建った場所だけ）。宿の行（route.lodging の値）は、最後の場所にも翌日の場所にもしない
 */
export function lodgingContext(
  route: Pick<Route, 'schedule' | 'legModes' | 'lodging'>,
  night: number,
  stops: (pinId: string) => LodgingStop | null,
  tripMode: TravelMode,
): LodgingContext | null {
  const lodgingIds = new Set(Object.values(route.lodging ?? {}).filter((value) => !isLodgingSkip(value)))
  const rows = route.schedule.flatMap((row: RouteStop) => {
    // 行の ID（区間のキーに使う）は、複製した行なら stopId、ほかはピンの ID。場所はピンの ID で引く
    const id = row.stopId ?? row.pinId
    if (!id || !row.pinId || lodgingIds.has(id)) return []
    const stop = stops(row.pinId)
    return stop ? [{ id, row, stop }] : []
  })
  const before = rows.filter((item) => item.row.day <= night).at(-1)
  if (!before) return null
  const after = rows.find((item) => item.row.day > night) ?? null
  const leaveAt = (minutesOf(before.row.time) ?? 17 * 60) + before.row.stayMinutes
  const from = { ...before.stop, leaveAt }
  if (!after) return { night, from, next: null, move: null, side: 'stay', tripMode, bounds: boundsAround([from.location]) }

  const key = travelKey(before.id, after.id)
  const mode = route.legModes?.[key] ?? defaultLegMode(from.location, after.stop.location, tripMode)
  // 目安の式で数える（候補をふるう lodgingFit と同じ数え方にする）。残してある便（legFlights）は翌朝に出る前提で選んだものなので、夜の判断には使わない
  const minutes = estimateMinutes(from.location, after.stop.location, mode)
  // 車の旅で、2 つのあいだも車で移る夜は、道の途中の着ける所ならどこでも（Takana の依頼、2026-11-22）
  if (tripMode === 'car' && mode === 'car') {
    const reach = pointAlong(from.location, after.stop.location, reachableFraction(leaveAt, minutes))
    return { night, from, next: after.stop, move: { mode, minutes }, side: 'route', tripMode, bounds: boundsAround([from.location, reach]) }
  }
  const long = mode === 'plane' || minutes > LONG_MOVE_MINUTES
  // 翌日の側に移るのは、移ったあと宿までの移動を見込んでも、ホテルの上限に間に合うときだけ
  const side: LodgingSide = !long ? 'between' : leaveAt + minutes + LODGING_HOP_MINUTES <= HOTEL_ARRIVE_BY ? 'move' : 'stay'
  const bounds =
    side === 'between' ? boundsAround([from.location, after.stop.location]) : boundsAround([side === 'move' ? after.stop.location : from.location])
  return { night, from, next: after.stop, move: { mode, minutes }, side, tripMode, bounds }
}

/**
 * ホテルに着く時刻の上限（0 時からの分）。ふつうは HOTEL_ARRIVE_BY。予定そのものが遅くまで続く夜（最後の場所を出てから LATE_REACH_MINUTES では
 * もう HOTEL_ARRIVE_BY に間に合わない夜）は、最後の場所を出てから LATE_REACH_MINUTES まで（境目で許す幅が縮まないように、境目と幅をそろえる）
 */
export function hotelArriveBy(leaveAt: number): number {
  return Math.max(HOTEL_ARRIVE_BY, leaveAt + LATE_REACH_MINUTES)
}

/** 候補の宿 1 つの見立て。arriveAt は宿に着く時刻（0 時からの分）、detour は寄り道で延びる時間（分） */
export interface LodgingFit {
  arriveAt: number
  detour: number
  ok: boolean
}

/**
 * 宿 1 つを、着く時刻と寄り道で見立てる。最後の場所と翌日の場所のあいだは、泊まる側を決めたときと同じ移動（context.move）で数え、
 * 宿のまわりの短い移動は、旅全体の手段（遠ければ飛行機）の目安で数える。
 * - 着く時刻：最後の場所を出る時刻 ＋ 宿までの移動。翌日の側（move）は、夜のうちに翌日の場所の方へ移り（move.minutes）、そこから宿へ
 * - 寄り道：最後の場所 → 宿 → 翌日の場所 が、まっすぐ向かう（move.minutes）より何分長いか。翌日の側は、翌日の場所と宿の行き来。
 *   翌日の場所がなければ、最後の場所から宿までの時間
 * - 道の途中（route）は、2 つのあいだ（between）と同じ数え方。着く時刻の上限と寄り道だけで決め、どちらかの場所の近さは見ない
 * - 泊まる側：長い移動の夜（stay、move）は、泊まる側の場所から宿までも DETOUR_MAX_MINUTES 以内（移動の途中の宿を外す）
 * - ok：旅館は RYOKAN_ARRIVE_BY、ホテルは HOTEL_ARRIVE_BY までに着き、寄り道と泊まる側の近さが上限の中。
 *   予定そのものが遅くまで続く夜は、ホテルの上限を、最後の場所を出てから LATE_REACH_MINUTES までにする
 */
export function lodgingFit(context: LodgingContext, location: LatLng, kind: LodgingKind): LodgingFit {
  const { from, next, move, side, tripMode } = context
  let toLodging: number
  let detour: number
  let near = true
  if (!next || !move) {
    toLodging = legMinutes(from.location, location, tripMode)
    detour = toLodging
    near = side === 'between' || toLodging <= DETOUR_MAX_MINUTES
  } else if (side === 'move') {
    const hop = legMinutes(next.location, location, tripMode)
    toLodging = move.minutes + hop
    detour = hop + legMinutes(location, next.location, tripMode)
    near = hop <= DETOUR_MAX_MINUTES
  } else {
    toLodging = side === 'stay' ? legMinutes(from.location, location, tripMode) : estimateMinutes(from.location, location, move.mode)
    // 宿から翌日の場所へは、2 つのあいだと同じ手段で移る（stay の夜の飛行機など）
    detour = Math.max(0, toLodging + estimateMinutes(location, next.location, move.mode) - move.minutes)
    near = side === 'between' || side === 'route' || toLodging <= DETOUR_MAX_MINUTES
  }
  const arriveAt = from.leaveAt + toLodging
  // 夕食付きの旅館は 18:00 のまま。ホテルは、予定そのものが遅くまで続く夜だけ、最後の場所から LATE_REACH_MINUTES までずらす
  const limit = kind === 'ryokan' ? RYOKAN_ARRIVE_BY : hotelArriveBy(from.leaveAt)
  return { arriveAt, detour, ok: arriveAt <= limit && detour <= DETOUR_MAX_MINUTES && near }
}

/**
 * 候補を、見立てでふるい、寄り道の短い順に並べる。名前で頼まれた先頭の宿（namedMatch）は、ふるわずに先頭に残す（人の指定を優先する）
 */
export function rankLodgings<T extends { location: LatLng; namedMatch?: true; lodgingKind?: LodgingKind }>(
  context: LodgingContext,
  places: readonly T[],
): T[] {
  // ふるわずに残すのは、名前で頼まれた先頭の 1 件だけ（ピンに namedMatch を書くのも先頭だけ。2 件目からは、ふつうの候補としてふるう）
  const namedIndex = places.findIndex((place) => place.namedMatch)
  const fitted = places.map((place, index) => {
    const plain = index !== namedIndex && place.namedMatch ? (({ namedMatch: _named, ...rest }) => rest as T)(place) : place
    return { place: plain, index, fit: lodgingFit(context, place.location, place.lodgingKind ?? 'hotel') }
  })
  const named = fitted.filter((item) => item.index === namedIndex)
  const rest = fitted
    .filter((item) => item.index !== namedIndex && item.fit.ok)
    .sort((left, right) => left.fit.detour - right.fit.detour || left.index - right.index)
  return [...named, ...rest].map((item) => item.place)
}

/** 1 回の宿さがしで、Places で確かめる候補の数の上限（テキスト検索の 1 日 30 回を、建てる場所の確かめと分け合うため）。AI が仮に選んだ */
export const LODGING_CHECKS_MAX = 3
/** Gemini の位置から、Places で見つかった宿までの許せる遠さ（km）。これより遠ければ、同じ名前の別の宿とみなして外す。AI が仮に選んだ */
export const LODGING_SHIFT_MAX_KM = 20

/** Places で確かめた宿（findLodging の結果のうち、使うところ） */
export interface CheckedLodging {
  placeId: string
  location: LatLng
  lodging: boolean
  ryokan: boolean
  parking: boolean | null
}

/**
 * Places で確かめた結果から、候補を残すか決める。残すなら、位置を Places のものにし、placeId と宿の種類を添えて返す。外すなら null。
 * - 宿の種類でない、Gemini の位置から LODGING_SHIFT_MAX_KM より遠い、は外す
 * - 車の旅（needParking）で、駐車場がないと分かったら外す（分からなければ残す）
 * - しおりの様子があれば、Places の位置で着く時刻と寄り道を確かめ直す（名前で頼まれた宿は確かめ直さない）
 */
export function acceptLodging<T extends { location: LatLng; namedMatch?: true; lodgingKind?: LodgingKind }>(
  context: LodgingContext | null,
  place: T,
  found: CheckedLodging,
  needParking: boolean,
): (T & { placeId: string; lodgingKind: LodgingKind }) | null {
  if (!found.lodging) return null
  if (distanceKm(place.location, found.location) > LODGING_SHIFT_MAX_KM) return null
  if (needParking && found.parking === false) return null
  const lodgingKind: LodgingKind = place.lodgingKind ?? (found.ryokan ? 'ryokan' : 'hotel')
  if (context && !place.namedMatch && !lodgingFit(context, found.location, lodgingKind).ok) return null
  return { ...place, location: found.location, placeId: found.placeId, lodgingKind }
}

/** 時刻の文字（HH:MM）。24 時を過ぎたら翌日の時刻 */
export function clockText(minutes: number): string {
  const day = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`
}
