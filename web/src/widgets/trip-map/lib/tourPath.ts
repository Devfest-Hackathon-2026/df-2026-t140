// しおりの再生（ツアー）で車が走る道の計算。区間の道に沿った位置と向き、建物の縁で止まるための詰め。

import type { LatLng } from '@/entities/pin'

/** 1 区間の道（場所から次の場所まで）。距離は、点ごとの累計（m） */
export interface TourLeg {
  points: LatLng[]
  /** points[i] までの累計の距離（m）。最初は 0 */
  distances: number[]
  /** 区間の長さ（m） */
  length: number
}

/** 車の位置と向き。heading は走る向き（度。北が 0 で、時計回り。東が 90）。distance は区間の始まりからの道のり（m） */
export interface CarPlace {
  point: LatLng
  heading: number
  distance: number
}

/** 向きを見るときに、前後をどれだけ離して比べるか（詰めたあとの道の長さに対する割合）。道の細かい曲がりで向きがばたつかないように */
const HEADING_SPAN = 0.02

/** 2 点のあいだの距離（m。球面のおおよそ） */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function makeLeg(points: readonly LatLng[]): TourLeg {
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + distanceMeters(points[index - 1], points[index]))
  }
  return { points: [...points], distances, length: distances[distances.length - 1] ?? 0 }
}

/** a から b へ向かう向き（度。北が 0 で、時計回り）。地図の上での見た目の向き（経度の幅は緯度で縮める） */
export function bearing(a: LatLng, b: LatLng): number {
  const dx = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const dy = b.lat - a.lat
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI
  return (degrees + 360) % 360
}

/** 区間の始まりから distance（m）進んだ位置 */
function pointAt(leg: TourLeg, distance: number): LatLng {
  const { points, distances, length } = leg
  const target = Math.min(length, Math.max(0, distance))
  let index = 1
  while (index < points.length - 1 && distances[index] < target) index += 1
  const from = points[index - 1]
  const to = points[index]
  const span = distances[index] - distances[index - 1]
  const t = span > 0 ? (target - distances[index - 1]) / span : 1
  return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t }
}

/**
 * 区間の、進んだ割合 progress（0〜1）の位置と、そこで走っている向き。
 * trim（m）は、両端の場所から詰める道のり。建物の真ん中ではなく縁から走り出し、縁で止まる。
 * 区間が短くて詰めきれないときは、真ん中まで詰める
 */
export function placeAlong(leg: TourLeg, progress: number, trim = 0): CarPlace {
  const { points, length } = leg
  const first = points[0]
  const last = points[points.length - 1] ?? first
  if (points.length < 2 || length === 0) return { point: last, heading: 90, distance: length }
  const start = Math.min(Math.max(0, trim), length / 2)
  const usable = length - 2 * start
  const distance = start + Math.min(1, Math.max(0, progress)) * usable
  // 向きは、少し手前から少し先までの向き。端では、はみ出さないように内側へずらす
  const span = Math.max(usable, length * 0.01) * HEADING_SPAN
  const behind = Math.max(0, Math.min(distance - span, length - 2 * span))
  return { point: pointAt(leg, distance), heading: bearing(pointAt(leg, behind), pointAt(leg, behind + 2 * span)), distance }
}

/** 空港を経由する飛行機の区間で、空を飛ぶところ（区間の始まりからの距離 m）。その前後（空港まで、空港から）は地上を走る */
export interface AirSpan {
  from: number
  to: number
}

/** 再生の今の乗り物の位置。onGround は空港の前後の地上を走っているか。flown は空を飛ぶところをどれだけ進んだか（0〜1） */
export interface TourMotion {
  place: CarPlace
  onGround: boolean
  flown: number
}

/**
 * 空港を経由する区間で、空港の前後の地上の区間に、少なくとも再生の時間のこの割合を回す。
 * 遠くへ飛ぶ区間では、空港まで（東京駅から羽田など）は全体の 1〜2% の長さしかなく、そのままでは地上の乗り物が見えないため
 */
const GROUND_SHARE = 0.15
/** 地上の区間に回す時間の合計の上限（割合）。空を飛ぶところに、少なくとも残りの時間を回す */
const GROUND_SHARE_MAX = 0.6

/** 区間の lo〜hi（m）の中の、distance の位置と向き。向きは、lo〜hi の長さに合わせて前後を比べる */
function placeWithin(leg: TourLeg, distance: number, lo: number, hi: number): CarPlace {
  const [low, high] = hi - lo >= 1 ? [lo, hi] : [0, leg.length]
  const span = (high - low) * HEADING_SPAN
  const behind = Math.max(low, Math.min(distance - span, high - 2 * span))
  return { point: pointAt(leg, distance), heading: bearing(pointAt(leg, behind), pointAt(leg, behind + 2 * span)), distance }
}

/**
 * 再生の、進んだ割合 progress（0〜1）での乗り物の位置。air がなければ placeAlong と同じで、区間の全部を 1 つの乗り物で走る（flown は progress）。
 * air があるときは、空港まで → 空 → 空港から の 3 つに分けて進む。両端の詰め（trim）は、地上の区間の半分までに抑える
 * （空港が近いと、詰めただけで空に入ってしまうため）。地上の区間には、少なくとも再生の時間の GROUND_SHARE を回す
 */
export function tourMotion(leg: TourLeg, progress: number, trim = 0, air?: AirSpan | null): TourMotion {
  const { length } = leg
  if (!air || leg.points.length < 2 || length === 0 || !(air.to > air.from)) {
    return { place: placeAlong(leg, progress, trim), onGround: false, flown: Math.min(1, Math.max(0, progress)) }
  }
  const from = Math.min(Math.max(0, air.from), length)
  const to = Math.min(Math.max(from, air.to), length)
  const trimIn = Math.max(0, Math.min(trim, from / 2))
  const trimOut = Math.max(0, Math.min(trim, (length - to) / 2))
  const groundIn = from - trimIn
  const groundOut = length - trimOut - to
  const usable = groundIn + (to - from) + groundOut
  // 地上の区間の時間の割合。道のりの割合が GROUND_SHARE より小さければ GROUND_SHARE にする（地上の区間がないときは 0）
  let shareIn = groundIn > 0 ? Math.max(GROUND_SHARE, groundIn / usable) : 0
  let shareOut = groundOut > 0 ? Math.max(GROUND_SHARE, groundOut / usable) : 0
  if (shareIn + shareOut > GROUND_SHARE_MAX) {
    const scale = GROUND_SHARE_MAX / (shareIn + shareOut)
    shareIn *= scale
    shareOut *= scale
  }
  const p = Math.min(1, Math.max(0, progress))
  if (shareIn > 0 && p < shareIn) {
    return { place: placeWithin(leg, trimIn + (p / shareIn) * groundIn, trimIn, from), onGround: true, flown: 0 }
  }
  if (shareOut > 0 && p > 1 - shareOut) {
    const t = (p - (1 - shareOut)) / shareOut
    return { place: placeWithin(leg, to + t * groundOut, to, length - trimOut), onGround: true, flown: 1 }
  }
  const flown = (p - shareIn) / Math.max(1e-9, 1 - shareIn - shareOut)
  return { place: placeWithin(leg, from + flown * (to - from), from, to), onGround: false, flown: Math.min(1, Math.max(0, flown)) }
}

/** 拡大の度合い 0、赤道での、1px あたりの長さ（m） */
const METERS_PER_PIXEL_AT_ZOOM_0 = 156_543.03392

/**
 * 区間を走るときの寄り具合（拡大の度合い）。建物と建物のあいだ（区間の両端のまっすぐな距離）が、画面の上で
 * screenPx（px）の長さに見える度合いを返す。区間に長さがなければ null（呼ぶ側が決めた寄り具合にする）
 */
export function legZoom(leg: TourLeg, screenPx: number): number | null {
  const first = leg.points[0]
  const last = leg.points[leg.points.length - 1]
  if (!first || !last) return null
  const distance = distanceMeters(first, last)
  if (distance < 1 || screenPx <= 0) return null
  const metersPerPixelAt0 = METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((((first.lat + last.lat) / 2) * Math.PI) / 180)
  return Math.log2((metersPerPixelAt0 * screenPx) / distance)
}

/** 道の端と建物の場所が、画面の上でこれより近ければ（px）、その建物の前で止まる道とみなす */
const LEG_END_REACH_PX = 24

/**
 * 区間の両端にある建物のうち、いちばん大きいものの大きさ（px）。車は、この大きさの建物の縁で止まる。
 * buildings は建物の場所と、描いている大きさ。metersPerPixel は、いまの拡大の度合いでの 1px あたりの長さ（m）。
 * どちらの端にも建物がなければ null（集合場所など）
 */
export function legEndSize(
  leg: TourLeg,
  buildings: readonly { location: LatLng; size: number }[],
  metersPerPixel: number,
): number | null {
  const first = leg.points[0]
  const last = leg.points[leg.points.length - 1]
  if (!first || !last || metersPerPixel <= 0) return null
  const reach = LEG_END_REACH_PX * metersPerPixel
  let found: number | null = null
  for (const building of buildings) {
    const near = distanceMeters(building.location, first) <= reach || distanceMeters(building.location, last) <= reach
    if (near) found = Math.max(found ?? 0, building.size)
  }
  return found
}
