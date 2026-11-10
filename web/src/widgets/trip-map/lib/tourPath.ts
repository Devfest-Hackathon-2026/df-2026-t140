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

/** 車の位置と向き。heading は走る向き（度。北が 0 で、時計回り。東が 90） */
export interface CarPlace {
  point: LatLng
  heading: number
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
  if (points.length < 2 || length === 0) return { point: last, heading: 90 }
  const start = Math.min(Math.max(0, trim), length / 2)
  const usable = length - 2 * start
  const distance = start + Math.min(1, Math.max(0, progress)) * usable
  // 向きは、少し手前から少し先までの向き。端では、はみ出さないように内側へずらす
  const span = Math.max(usable, length * 0.01) * HEADING_SPAN
  const behind = Math.max(0, Math.min(distance - span, length - 2 * span))
  return { point: pointAt(leg, distance), heading: bearing(pointAt(leg, behind), pointAt(leg, behind + 2 * span)) }
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
