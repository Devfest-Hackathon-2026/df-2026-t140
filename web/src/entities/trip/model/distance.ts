import type { LatLng } from './regionCenter'

/** 2 点のあいだの、地球の表面に沿ったまっすぐな距離（km）。道のりではない */
export function distanceKm(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (to.lat - from.lat) * rad
  const dLng = (to.lng - from.lng) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}
