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
/** 沖縄まで入れた日本全体。日本の外まで動かしたときに戻る見え方 */
export const WHOLE_JAPAN: MapBounds = { north: 45.6, south: 25.9, east: 146.0, west: 127.4 }

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

/** 上の帯（top px）と下のシート（bottom px）のあいだに見えている所の、四隅の緯度経度（左上、右上、左下、右下） */
export function visibleCorners(view: MapView, size: Size, top: number, bottom: number): LatLng[] {
  const upper = Math.min(top, size.height)
  const lower = Math.max(upper, size.height - bottom)
  return [
    { x: 0, y: upper },
    { x: size.width, y: upper },
    { x: 0, y: lower },
    { x: size.width, y: lower },
  ].map((pixel) => unproject(view, size, pixel))
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

/**
 * 地図の真ん中を置いてよい範囲（日本と、そのまわりの海）。沖縄・小笠原の手前から北海道まで。
 * 西は与那国島（122.9）の先まで入れる（沖縄を選んで寄ると、真ん中が沖縄本島より西に来るため）
 */
const JAPAN_CENTER = { north: 46, south: 24, east: 148, west: 122.5 }
/** 朝鮮半島と大陸の側。この経度より西で、この緯度より北は日本の外とみなす（対馬は入る） */
const MAINLAND_WEST = { lng: 129.4, lat: 34.6 }

/**
 * 地図の真ん中が日本の外へ出ていたら、いちばん近い日本の側の位置を返す（中なら null）。
 * 人が日本の外まで動かしたとき、地図を日本へ戻すのに使う
 */
export function backToJapan(center: LatLng): LatLng | null {
  let lat = clamp(center.lat, JAPAN_CENTER.south, JAPAN_CENTER.north)
  let lng = clamp(center.lng, JAPAN_CENTER.west, JAPAN_CENTER.east)
  if (lng < MAINLAND_WEST.lng && lat > MAINLAND_WEST.lat) {
    // 半島・大陸の側：東（日本海の向こうの本州・九州）へ寄せる。北すぎるところは北海道の西の海まで下げる
    lng = MAINLAND_WEST.lng
    lat = Math.min(lat, 42)
  }
  return lat === center.lat && lng === center.lng ? null : { lat, lng }
}

/** 拡大の度合いを決めた幅に収め、真ん中が日本の外へ出ないようにする。minZoom は、いちばん引けるところ（旅のエリアで決めたもの。なければ MIN_ZOOM） */
export function clampView(view: MapView, minZoom: number = MIN_ZOOM): MapView {
  return { zoom: clamp(view.zoom, minZoom, MAX_ZOOM), center: backToJapan(view.center) ?? view.center }
}

/**
 * 旅の地図で、いちばん引けるところの拡大の度合い（Takana の依頼、2026-11-22）。
 * 旅のエリアの点が、padding の内側（上の帯と下のシートに隠れないところ）に全部収まる拡大の度合いから、さらに slack 段引いたところ。
 * ぎりぎりに収めると、少し動かしただけでエリアの端が隠れるので、余裕を持たせる（0.5 段で約 1.4 倍の広さ。実装した AI が仮に選んだ）。
 * 点がなければ null（引ける所を限らない）
 */
export function areaMinZoom(points: readonly LatLng[], size: Size, padding: Padding, slack = 0.5): number | null {
  if (points.length < 2) return null
  const fit = viewForPoints(points, size, padding, MAX_ZOOM)
  return fit ? clamp(fit.zoom - slack, MIN_ZOOM, MAX_ZOOM) : null
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

/**
 * いまいる所から先に引いて、引きながら行き先へ動く見え方（e は 0〜1）。
 * viewBetween は画面の上のずれを縮めるので、寄ったまま遠くへ戻ると、途中の土地（北海道など）を大きく映しながら流れていく。
 * こちらは拡大の度合いを先に下げ、真ん中は世界の上で少し遅れて動かすので、その場から引いて見える
 */
export function viewZoomingOut(from: MapView, to: MapView, e: number): MapView {
  const zoomed = 1 - (1 - Math.min(1, e / 0.6)) ** 2
  const moved = Math.min(1, Math.max(0, (e - 0.15) / 0.85))
  const m = moved < 0.5 ? 2 * moved * moved : 1 - (-2 * moved + 2) ** 2 / 2
  const a = toWorld(from.center)
  const b = toWorld(to.center)
  return {
    zoom: from.zoom + (to.zoom - from.zoom) * zoomed,
    center: fromWorld({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m }),
  }
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
