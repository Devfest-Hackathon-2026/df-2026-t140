import type { RegionId } from './regions'
import { regionRings } from './regionShapes'

export interface LatLng {
  lat: number
  lng: number
}

const centers = new Map<RegionId, LatLng>()

/** 地方のまん中（地方の形を囲む四角の中心）。地図の名札と、出発地からの線の行き先に使う */
export function regionCenter(id: RegionId): LatLng {
  const known = centers.get(id)
  if (known) return known
  const points = regionRings(id).flat()
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const center = { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lng: (Math.max(...lngs) + Math.min(...lngs)) / 2 }
  centers.set(id, center)
  return center
}
