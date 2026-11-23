import { type RegionId, regionRings } from '@/entities/trip'
import type { MapBounds } from '@/entities/wish'
import { JAPAN, type MapView, type Size, viewForBounds } from './mercator'

/** 旅をつくる画面で出発のあと、旅の地図の見え方へ寄るのにかける時間（ms） */
export const DIVE_MS = 1300

const cache = new Map<RegionId, MapBounds>()

function boundsOfRegion(id: RegionId): MapBounds {
  const known = cache.get(id)
  if (known) return known
  const points = regionRings(id).flat()
  const bounds = {
    north: Math.max(...points.map((point) => point.lat)),
    south: Math.min(...points.map((point) => point.lat)),
    east: Math.max(...points.map((point) => point.lng)),
    west: Math.min(...points.map((point) => point.lng)),
  }
  cache.set(id, bounds)
  return bounds
}

/** 地方をすべて囲む範囲（自前の地方の形から求める）。地方が 1 つもなければ null */
export function regionsBounds(ids: readonly RegionId[]): MapBounds | null {
  if (ids.length === 0) return null
  const each = ids.map(boundsOfRegion)
  return {
    north: Math.max(...each.map((bounds) => bounds.north)),
    south: Math.min(...each.map((bounds) => bounds.south)),
    east: Math.max(...each.map((bounds) => bounds.east)),
    west: Math.min(...each.map((bounds) => bounds.west)),
  }
}

/**
 * 建物がまだない旅の地図の、最初の見え方。旅の地方が全部入るように映す（地方を絞っていない旅は日本全体）。
 * 旅をつくる画面で「ここへ出発！」を押したあとの地図も、ここへ向かって動く（着いた所が、そのまま旅の地図の最初の見え方になる）
 */
export function tripStartView(ids: readonly RegionId[], size: Size): MapView {
  return viewForBounds(regionsBounds(ids) ?? JAPAN, size, { top: 90, right: 44, bottom: 150, left: 44 })
}
