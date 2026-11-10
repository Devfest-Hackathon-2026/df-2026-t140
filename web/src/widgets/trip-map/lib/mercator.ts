import type { LatLng } from '@/entities/pin'
import type { MapBounds } from '@/entities/wish'

// 地図の見え方（真ん中と拡大の度合い）と、画面の上の位置の計算。Google Maps と同じメルカトル図法。
// 純粋な計算だけなので、地図なしの表示でも、本物の地図でも同じものを使う。

/** 地図の見え方。zoom は Google Maps と同じ数え方（1 上がると 2 倍に拡大） */
export interface MapView {
  center: LatLng
  zoom: number
}

export interface Size {
  width: number
  height: number
}

/** 地図の端から空けておく幅（上の帯や下の操作欄に隠れないように） */
export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

const TILE = 256
const MAX_LAT = 85

export const MIN_ZOOM = 4
export const MAX_ZOOM = 16

/** 日本全体。最初に出す範囲と、動かせる範囲の目安 */
export const JAPAN: MapBounds = { north: 45.8, south: 30.2, east: 146.2, west: 128.8 }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** 緯度経度 → zoom 0 のときの位置（0〜256） */
function toWorld({ lat, lng }: LatLng): { x: number; y: number } {
  const sin = Math.sin((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180)
  return { x: ((lng + 180) / 360) * TILE, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE }
}

function fromWorld({ x, y }: { x: number; y: number }): LatLng {
  const n = Math.PI - (2 * Math.PI * y) / TILE
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / TILE) * 360 - 180 }
}

/** 緯度経度 → 画面の上の位置（px。左上が 0, 0） */
export function project(view: MapView, size: Size, point: LatLng): { x: number; y: number } {
  const scale = 2 ** view.zoom
  const center = toWorld(view.center)
  const world = toWorld(point)
  return { x: (world.x - center.x) * scale + size.width / 2, y: (world.y - center.y) * scale + size.height / 2 }
}

/** 緯度経度 → 拡大の度合い zoom での、世界全体の絵の上の位置（px）。印どうしの間隔を測るのに使う */
export function worldPixel(point: LatLng, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom
  const world = toWorld(point)
  return { x: world.x * scale, y: world.y * scale }
}

/** 画面の上の位置 → 緯度経度 */
export function unproject(view: MapView, size: Size, pixel: { x: number; y: number }): LatLng {
  const scale = 2 ** view.zoom
  const center = toWorld(view.center)
  return fromWorld({ x: center.x + (pixel.x - size.width / 2) / scale, y: center.y + (pixel.y - size.height / 2) / scale })
}

/** 画面に映っている範囲 */
export function boundsOf(view: MapView, size: Size): MapBounds {
  const topLeft = unproject(view, size, { x: 0, y: 0 })
  const bottomRight = unproject(view, size, { x: size.width, y: size.height })
  return { north: topLeft.lat, south: bottomRight.lat, east: bottomRight.lng, west: topLeft.lng }
}

/** 真ん中を、画面の上で dx, dy（px）だけずらす */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  const scale = 2 ** view.zoom
  const center = toWorld(view.center)
  return { ...view, center: fromWorld({ x: center.x + dx / scale, y: center.y + dy / scale }) }
}

/** 拡大の度合いを決めた幅に収め、真ん中が日本から大きく外れないようにする */
export function clampView(view: MapView): MapView {
  return {
    zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
    center: { lat: clamp(view.center.lat, 22, 47), lng: clamp(view.center.lng, 121, 150) },
  }
}

/**
 * 点が全部入る見え方。padding の内側（上の帯と下の操作欄に隠れないところ）に収める。
 * 点が 1 つなら、その点を真ん中にして maxZoom で映す。
 */
export function viewForPoints(points: readonly LatLng[], size: Size, padding: Padding, maxZoom: number): MapView | null {
  if (points.length === 0) return null
  const worlds = points.map(toWorld)
  const minX = Math.min(...worlds.map((world) => world.x))
  const maxX = Math.max(...worlds.map((world) => world.x))
  const minY = Math.min(...worlds.map((world) => world.y))
  const maxY = Math.max(...worlds.map((world) => world.y))

  const width = Math.max(size.width - padding.left - padding.right, 80)
  const height = Math.max(size.height - padding.top - padding.bottom, 80)
  const zoomX = maxX > minX ? Math.log2(width / (maxX - minX)) : maxZoom
  const zoomY = maxY > minY ? Math.log2(height / (maxY - minY)) : maxZoom
  // 半端な拡大だと地図の文字がぼやけるので、0.5 きざみに切り下げる
  const zoom = clamp(Math.floor(Math.min(zoomX, zoomY, maxZoom) * 2) / 2, MIN_ZOOM, MAX_ZOOM)

  const centered: MapView = { center: fromWorld({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }), zoom }
  // 空けておく幅が上下・左右で違うぶん、真ん中をずらす
  return panBy(centered, (padding.right - padding.left) / 2, (padding.bottom - padding.top) / 2)
}

/** 範囲が全部入る見え方 */
export function viewForBounds(bounds: MapBounds, size: Size, padding: Padding): MapView {
  const corners = [
    { lat: bounds.north, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
  ]
  return viewForPoints(corners, size, padding, MAX_ZOOM) ?? { center: { lat: 37.5, lng: 137.5 }, zoom: 5 }
}

/** その点が、padding の内側の真ん中に来る見え方（拡大の度合いは変えない） */
export function viewCenteredOn(point: LatLng, zoom: number, padding: Padding): MapView {
  return panBy({ center: point, zoom }, (padding.right - padding.left) / 2, (padding.bottom - padding.top) / 2)
}

/** 点が、padding の内側に見えているか */
export function isVisible(view: MapView, size: Size, padding: Padding, point: LatLng): boolean {
  const { x, y } = project(view, size, point)
  return x >= padding.left && x <= size.width - padding.right && y >= padding.top && y <= size.height - padding.bottom
}

/**
 * from から to へなめらかに移る途中の見え方（e は 0〜1。0 で from、1 で to）。
 * 拡大の度合いはまっすぐ変え、真ん中は、行き先の真ん中が画面の上でまっすぐ近づいてくるように決める
 * （緯度経度をそのまま混ぜると、寄りながら動くときに行き先がいったん画面の外へ出るため）
 */
export function viewBetween(from: MapView, to: MapView, e: number): MapView {
  const zoom = from.zoom + (to.zoom - from.zoom) * e
  const a = toWorld(from.center)
  const b = toWorld(to.center)
  // 行き先の真ん中の、画面の上でのずれ（px）を (1 - e) 倍に縮める。いまの拡大の度合いで世界の位置に直す
  const k = ((1 - e) * 2 ** from.zoom) / 2 ** zoom
  return { zoom, center: fromWorld({ x: b.x - (b.x - a.x) * k, y: b.y - (b.y - a.y) * k }) }
}

/** 2 つの見え方の真ん中が、画面の上でどれだけ離れているか（px。2 つのうち引いているほうの拡大の度合いで測る） */
export function viewGap(from: MapView, to: MapView): number {
  const a = toWorld(from.center)
  const b = toWorld(to.center)
  return Math.hypot(b.x - a.x, b.y - a.y) * 2 ** Math.min(from.zoom, to.zoom)
}

/** 場所を 1 つ真ん中にして見せるときの寄り具合の決め（spotZoom） */
export interface SpotZoomRule {
  /** 建物の絵の幅（px）。この gap 倍の間隔まで寄れば、2 つの建物が重ならない */
  size: number
  gap: number
  /** 拡大の度合いの下限と上限 */
  min: number
  max: number
  /** まわりに建物がないとき */
  alone: number
  /** いまの拡大の度合いとの差がこれ以下なら、いまのままにする（少しの違いで寄ったり引いたりを繰り返さない） */
  keep: number
}

/**
 * 場所を真ん中にして見せるときの拡大の度合い。まわりの建物（others）の混み具合で決める（しおりの場所の情報、#224）。
 * - いちばん近い建物と重ならない間隔（size × gap px）まで寄る
 * - そのうえで、いちばん近い建物も padding の内側に入るうちで、いちばん寄る
 *   （混んでいれば寄って重なりを減らし、離れていれば引いて、まわりとの位置関係を見せる）
 * - 両方を満たせないとき（見える所が狭い）は、重ならないほうを選ぶ
 * - min〜max に収め、0.25 きざみにする。まわりに建物がなければ alone
 * - current（いまの拡大の度合い）との差が keep 以下なら current のまま
 */
export function spotZoom(
  spot: LatLng,
  others: readonly LatLng[],
  size: Size,
  padding: Padding,
  rule: SpotZoomRule,
  current: number | null = null,
): number {
  const center = toWorld(spot)
  let nearest: { dx: number; dy: number; distance: number } | null = null
  for (const other of others) {
    const world = toWorld(other)
    const dx = world.x - center.x
    const dy = world.y - center.y
    const distance = Math.hypot(dx, dy)
    // 同じ場所に重なっている建物は、どれだけ寄っても離れないので数えない
    if (distance < 1e-9) continue
    if (!nearest || distance < nearest.distance) nearest = { dx, dy, distance }
  }
  let zoom = rule.alone
  if (nearest) {
    // 重ならない間隔まで寄る拡大の度合い（これより寄るのはよい）
    const apart = Math.ceil(Math.log2((rule.size * rule.gap) / nearest.distance) * 4) / 4
    // いちばん近い建物が、見える所（真ん中から、上下・左右の半分の幅）に入る拡大の度合い（これより引くのはよい）
    const halfWidth = Math.max(size.width - padding.left - padding.right, 80) / 2
    const halfHeight = Math.max(size.height - padding.top - padding.bottom, 80) / 2
    const fitX = Math.abs(nearest.dx) > 0 ? Math.log2(halfWidth / Math.abs(nearest.dx)) : Infinity
    const fitY = Math.abs(nearest.dy) > 0 ? Math.log2(halfHeight / Math.abs(nearest.dy)) : Infinity
    const fit = Math.floor(Math.min(fitX, fitY) * 4) / 4
    // 両方を満たせるときは、近い建物も見える所に入るうちでいちばん寄る（fit）。満たせないときは、重ならないほう（apart）
    zoom = Math.max(apart, fit)
  }
  zoom = clamp(zoom, rule.min, rule.max)
  if (current !== null && Math.abs(zoom - current) <= rule.keep) return clamp(current, rule.min, rule.max)
  return zoom
}
