import { type LatLng, REGION_IDS, REGION_NAMES, REGION_PREFECTURES, type RegionId, regionCenter, regionRings } from '@/entities/trip'
import type { MapBounds } from '@/entities/wish'
import { type MapView, project, type Size, worldPixel } from './mercator'
import { regionsBounds } from './regionBounds'
import { PREFECTURES } from './viewLabel'

/** 県だけを選んだときに、県のまわりとして映す幅（度） */
const PREFECTURE_SPAN = 0.6

/** 選んだ場所の行き先。地方をまるごと選んだら地方、県だけを選んだらその県 */
export interface PickedTarget {
  id: string
  name: string
  /** 行き先がある地方。県だけを選んだときにまとめるのは、同じ地方の県どうしだけ */
  region: RegionId
  /** 地方をまるごと選んだとき true。名札を動かすとき、地方の陸の上だけに置く */
  wholeRegion?: boolean
  point: LatLng
  bounds: MapBounds
}

/**
 * 選んだ県から、地図で名札を立てる行き先を作る（旅をつくる画面）。
 * 地方の県がすべて選ばれていれば地方を 1 つ、一部だけなら選んだ県を 1 つずつ。北から南の順
 */
export function pickedTargets(picked: readonly string[]): PickedTarget[] {
  return REGION_IDS.flatMap((id: RegionId) => {
    const inside = REGION_PREFECTURES[id]
    const chosen = inside.filter((name) => picked.includes(name))
    if (chosen.length === 0) return []
    if (chosen.length === inside.length) {
      return [{ id, name: REGION_NAMES[id], region: id, wholeRegion: true, point: regionCenter(id), bounds: regionsBounds([id])! }]
    }
    return chosen.flatMap((name) => {
      const found = PREFECTURES.find((prefecture) => prefecture.name === name)
      if (!found) return []
      const point = { lat: found.lat, lng: found.lng }
      return [
        {
          id: name,
          name,
          region: id,
          point,
          bounds: {
            north: point.lat + PREFECTURE_SPAN,
            south: point.lat - PREFECTURE_SPAN,
            east: point.lng + PREFECTURE_SPAN,
            west: point.lng - PREFECTURE_SPAN,
          },
        },
      ]
    })
  })
}

/** 名札の高さと、名札どうしのすき間（px）。名札は小さめ（字 12px）にして、重なりにくくする */
const LABEL_HEIGHT = 30
const LABEL_SPACE = 4

// 「熊本県」→「熊本」。北海道はそのまま
const shortName = (name: string) => (name === '北海道' ? name : name.replace(/[都府県]$/, ''))

// 名札の幅の見積もり（px）。字が 12px、左右の余白が 9px ずつ、ふちが 2px ずつ
const labelWidth = (name: string) => [...name].length * 12 + 22

interface Box {
  name: string
  x: number
  y: number
}

// 名札どうしが重なるか（名札は点の上に立つので、点どうしの縦のずれで見る）
const collide = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < (labelWidth(a.name) + labelWidth(b.name)) / 2 + LABEL_SPACE && Math.abs(a.y - b.y) < LABEL_HEIGHT + LABEL_SPACE

interface Group {
  members: PickedTarget[]
  name: string
  /** 名札を立てる所（画面の上の位置。拡大の度合いでの世界の座標） */
  x: number
  y: number
}

function groupName(members: readonly PickedTarget[]): string {
  if (members.length === 1) return members[0].name
  const names = members.map((member) => shortName(member.name))
  return names.length <= 2 ? names.join('・') : `${names.slice(0, 2).join('・')} +${names.length - 2}`
}

/**
 * その拡大の度合いで、名札が重なってしまう行き先を 1 つにまとめる。
 * place は、行き先の名札を実際に立てる所（家から離したあとの位置）。名札の幅は名前の長さから見積もり、
 * まとめると名札が広がって別の名札に重なることがあるので、重ならなくなるまで繰り返す。
 * まとめた行き先は、真ん中を平均の位置にし、名前を「熊本・大分」「熊本・大分 +2」のように縮める。寄ると、また分かれる
 */
export function clusterTargets(
  targets: readonly PickedTarget[],
  zoom: number,
  place: (point: LatLng) => LatLng = (point) => point,
): PickedTarget[] {
  let groups: Group[] = targets.map((target) => {
    const { x, y } = worldPixel(place(target.point), zoom)
    return { members: [target], name: target.name, x, y }
  })
  // 違う地方どうしはまとめない（まとめると、どこへ行くのか分からなくなる。重なる名札は labelsToShow で省く）
  const overlaps = (a: Group, b: Group) => a.members[0].region === b.members[0].region && collide(a, b)
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (!overlaps(groups[i], groups[j])) continue
        const members = [...groups[i].members, ...groups[j].members]
        const center = average(members.map((member) => member.point))
        const { x, y } = worldPixel(place(center), zoom)
        groups = [...groups.slice(0, i), { members, name: groupName(members), x, y }, ...groups.slice(i + 1, j), ...groups.slice(j + 1)]
        merged = true
        break outer
      }
    }
  }
  return groups.map(({ members, name }) =>
    members.length === 1
      ? members[0]
      : {
          id: members.map((member) => member.id).join('+'),
          name,
          region: members[0].region,
          point: average(members.map((member) => member.point)),
          bounds: {
            north: Math.max(...members.map((member) => member.bounds.north)),
            south: Math.min(...members.map((member) => member.bounds.south)),
            east: Math.max(...members.map((member) => member.bounds.east)),
            west: Math.min(...members.map((member) => member.bounds.west)),
          },
        },
  )
}

function average(points: readonly LatLng[]): LatLng {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

/** 出発地の家と名前の札が占める所（px。家の足もとの点からの左右と上下） */
const HOUSE_BOX = { half: 40, above: 70, below: 24 }

/** 名札を横や下へずらすときの、名札と点のあいだ（px）。名札が点のすぐ隣に来るくらい */
const LABEL_NUDGE = 4

/** 名札の置き場所。点からのずれ（px）。0, 0 は点の真上（名札の下の三角が点を指す） */
export interface LabelOffset {
  dx: number
  dy: number
  /** 点の横や下に置いた（三角で点を指さない） */
  beside?: boolean
}

/**
 * 名札を立てられる所（行き先の範囲の中の割合。左から、上から）。最初は行き先の点そのもの。
 * 真ん中に近い所から順に試す
 */
const ANCHORS: readonly (readonly [number, number])[] = [
  [0.5, 0.5],
  [0.5, 0.32],
  [0.5, 0.68],
  [0.32, 0.5],
  [0.68, 0.5],
  [0.35, 0.35],
  [0.65, 0.35],
  [0.35, 0.65],
  [0.65, 0.65],
]

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/**
 * 行き先の名札を、重ならないように置く。返すのは、置けた名札の ID とずれ（置けなかった名札は入れない）。
 * まず点の真上に置き、ほかの名札や出発地の家に重なるなら、点のすぐ隣（右、左、下）、
 * それでも重なるなら、同じ地方や県の範囲の中のほかの所へ動かす。線で引っぱる所までは動かさない。
 * どこも重なるときだけ、その名札を出さない。
 * 遠い行き先から順に置く（遠いほどまわりが空いていて、真上に置きやすい）
 */
/**
 * 名札を置く画面。渡すと、いまの見え方の画面の上で位置を出し（傾けた分、縦を縮める）、見えている所
 * （上の帯から下のシートまで）からはみ出す置き方を避ける。渡さなければ、拡大の度合いだけで位置を見積もる
 */
export interface LabelScreen {
  view: MapView
  size: Size
  /** 上の帯と、下のシートの高さ（px） */
  top: number
  bottom: number
  /** 地図の傾き（度） */
  tilt: number
}

export function placeLabels(
  targets: readonly PickedTarget[],
  zoom: number,
  place: (point: LatLng) => LatLng,
  home: LatLng | null,
  screen?: LabelScreen,
): Map<string, LabelOffset> {
  // 画面の上の位置。傾けた地図は、画面の真ん中から上下へ、およそ cos(傾き) 倍に縮んで見える
  const squash = screen ? Math.cos((screen.tilt * Math.PI) / 180) : 1
  const toScreen = (point: LatLng) => {
    if (!screen) return worldPixel(point, zoom)
    const { x, y } = project(screen.view, screen.size, point)
    return { x, y: screen.size.height / 2 + (y - screen.size.height / 2) * squash }
  }
  const visible: Rect | null = screen
    ? { left: 8, right: screen.size.width - 8, top: screen.top + 8, bottom: screen.size.height - screen.bottom - 8 }
    : null
  const house = home ? toScreen(home) : null
  const far = (target: PickedTarget) => (home ? Math.hypot(target.point.lat - home.lat, target.point.lng - home.lng) : 0)
  const taken: Rect[] = house
    ? [{ left: house.x - HOUSE_BOX.half, right: house.x + HOUSE_BOX.half, top: house.y - HOUSE_BOX.above, bottom: house.y + HOUSE_BOX.below }]
    : []
  const offsets = new Map<string, LabelOffset>()
  for (const target of [...targets].sort((a, b) => far(b) - far(a))) {
    // 名札の印は、行き先の点（家から離したあとの位置）に立つ。名札は、その地方や県の中のほかの所へも動かせる
    // （地方の中なら、どの地方の名札か分かる。線で引っぱらない）
    const origin = toScreen(place(target.point))
    const width = labelWidth(target.name)
    const side = width / 2 + LABEL_NUDGE
    const { north, south, east, west } = target.bounds
    // 地方の名札は、地方の陸の上の所にだけ動かす（島まで含めた範囲の四角には、海が多い）
    const onLand = (point: LatLng) => !target.wholeRegion || insideRegion(target.region, point)
    const anchors = ANCHORS.flatMap(([fx, fy], index) => {
      if (index === 0) return [origin]
      const point = { lat: north - fy * (north - south), lng: west + fx * (east - west) }
      return onLand(point) ? [toScreen(point)] : []
    })
    // 名札の下のふちの位置（印からのずれ）。点の真上（三角で指す）と、点のすぐ横と下
    const candidates: (LabelOffset & { beside: boolean })[] = anchors.flatMap((anchor) => {
      const [ax, ay] = [anchor.x - origin.x, anchor.y - origin.y]
      return [
        { dx: ax, dy: ay, beside: false },
        { dx: ax + side, dy: ay + LABEL_HEIGHT / 2, beside: true },
        { dx: ax - side, dy: ay + LABEL_HEIGHT / 2, beside: true },
        { dx: ax, dy: ay + LABEL_HEIGHT + LABEL_NUDGE, beside: true },
      ]
    })
    const rectOf = ({ dx, dy }: LabelOffset): Rect => ({
      left: origin.x + dx - width / 2 - LABEL_SPACE / 2,
      right: origin.x + dx + width / 2 + LABEL_SPACE / 2,
      top: origin.y + dy - LABEL_HEIGHT - LABEL_SPACE / 2,
      bottom: origin.y + dy + LABEL_SPACE / 2,
    })
    let best = candidates[0]
    let bestOverlap = Infinity
    for (const candidate of candidates) {
      const rect = rectOf(candidate)
      // 見えている所からはみ出す分も、重なりと同じように避ける（重めに数える）
      const outside = visible ? ((rect.right - rect.left) * (rect.bottom - rect.top) - overlapArea(rect, visible)) * 2 : 0
      const overlap = taken.reduce((sum, other) => sum + overlapArea(rect, other), 0) + outside
      if (overlap < bestOverlap) {
        best = candidate
        bestOverlap = overlap
      }
      if (overlap === 0) break
    }
    if (bestOverlap > 0) continue
    taken.push(rectOf(best))
    offsets.set(target.id, { dx: best.dx, dy: best.dy, beside: best.beside })
  }
  return offsets
}

// 点が地方の形の中にあるか（どれかの輪の中。輪の線を横切る数で見る）
function insideRegion(id: RegionId, point: LatLng): boolean {
  return regionRings(id).some((ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [a, b] = [ring[i], ring[j]]
      if (a.lat > point.lat !== b.lat > point.lat && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
    }
    return inside
  })
}
