// 地図の建物（3D の模型）の大きさと、引いてぶつかるときのまとめ方と名札を決める計算。どの印の位置も変えない。
//
// - 建物の大きさは、拡大の度合いとまわりの建物との間隔で決める（buildingSizes）。引くと小さく、寄ってまわりが空いていれば大きく
// - 拡大の度合いで決まる基準の大きさで深く重なる建物どうし（MERGE_RATIO）をつなぎ、つながった組の 1 つを代表にして出し、まとめた数を右上に出す
// - 建物の名札は、十分に寄っているときだけ出す（呼ぶ側が buildingLabels で決める）。出すときも、ぶつかる名札は出さない
//
// 候補のピンと工事中の印は 3D の模型ではないので、まとめない。名札は、ぶつからないものだけを出す。
// 画面の上の位置（px）だけを扱う純粋な計算。地図の種類（Google Maps か地図なしか）は知らない。
// node --test から直接読むため、ほかのファイルを import しない（scripts/map-declutter.test.mjs）。

export type DeclutterKind = 'building' | 'site' | 'pin'

export interface DeclutterItem {
  id: string
  /** 場所の、画面の上の位置（px。北が上） */
  x: number
  y: number
  kind: DeclutterKind
  /** 名札の幅の見込み（px）。estimateLabelWidth で出す */
  labelWidth: number
  /** 大きいほど優先する（代表に選ぶ順、名札を出す順） */
  priority: number
  /** 候補ピンの表示幅（px） */
  pinWidth?: number
}

export interface Placement {
  /** ほかの建物の代表にまとめられて、出さない */
  hidden: boolean
  /** 代表のとき、まとめた建物の数（自分を含む）。まとめていなければ 1 */
  count: number
  /** 名札を出さない */
  labelHidden: boolean
}

export interface DeclutterResult {
  placements: Record<string, Placement>
}

export interface DeclutterOptions {
  /** 模型の絵の幅（px）。まとめるかどうかは、この大きさで決める（zoomedSize） */
  size: number
  /** 建物ごとの、実際に描く絵の幅（px。buildingSizes）。名札の置き場所はこれで決める。ない建物は size */
  sizes?: Readonly<Record<string, number>>
  /** 建物の名札を出すか（十分に寄っているときだけ true） */
  buildingLabels: boolean
  /** 選んでいる印。まとまりの中にあれば代表にする。名札を出すときは、ぶつかっても出す */
  selectedId?: string | null
  /**
   * 建ったばかりの印（青い輪郭線と「建築完了」、S07）。まとまりの中にあれば、選んでいる印の次に代表にする。
   * 建ったばかりの建物がほかの建物の代表にまとめられて、印ごと見えなくなるのを防ぐ
   */
  celebratingId?: string | null
}

/** 模型と模型、名札と名札のあいだに空ける幅（px） */
const GAP = 4
/** 名札の高さ（px）。文字 12px × 行の高さ 1.5、上下の余白、縁 */
const LABEL_HEIGHT = 26
/** 模型のうち、建物が実際に描かれるあたり（絵の幅に対する割合。原点は場所） */
const BODY = { left: -0.38, right: 0.38, top: -0.6, bottom: 0.2 }
/** まとめた数の札（模型の右上）の大きさ（px）。ui/MapBuilding.module.css の .count の高さと同じ */
export const BADGE = 22
/**
 * 外枠が触れる間隔のこの倍より近づいたら、まとめる。1 なら触れたところでまとめ、小さいほど重なるまで待つ。
 * 0.5 は、外枠の半分ほどの重なりまでは両方出す（Takana の依頼、2026-11-07：もう少し近づいてから、重なってからでもよい）
 */
export const MERGE_RATIO = 0.5

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/** 建物の名札の上の端（場所からの px）。模型の下に付ける。ui/MapBuilding.tsx と同じ式 */
export function buildingLabelTop(size: number): number {
  return Math.max(4, Math.round(size * 0.19))
}

/** まとめた数の札が、模型の右上の角にかかる幅（px）。どの建物の札かが分かるよう、少しだけ重ねる */
const BADGE_OVERLAP = 4

/** まとめた数の札の、左上の位置（場所からの px）。ui/MapBuilding.tsx と同じ式 */
export function badgeOffset(size: number): { x: number; y: number } {
  // 見える模型の右上の角（屋根の右上あたり）に、札の左下の角を少しだけかける。
  // 札の中心を角に合わせると、ズームアウトして模型が小さいとき、札（22px）が模型を隠してしまう（#371）
  return { x: Math.round(size * 0.3) - BADGE_OVERLAP, y: Math.round(size * -0.4) - BADGE + BADGE_OVERLAP }
}

/** 「建築完了」の印（S07）の左の端のふだんの位置（場所からの px） */
const DONE_LEFT = 18

/**
 * 「建築完了」の印の左の端（場所からの px）。ui/MapBuilding.tsx が使う。
 * まとめた数の札が出ているときは、札の右の端より GAP だけ右に置き、札を隠さない（PR #380 のレビュー）
 */
export function doneLeft(size: number, count: number): number {
  if (count <= 1) return DONE_LEFT
  return Math.max(DONE_LEFT, badgeOffset(size).x + BADGE + GAP)
}

/**
 * 名札の幅の見込み（px）。文字は 12px。全角は 1 文字 12px、半角は 7px と見る。
 * 左右の余白 10px ずつと縁、顔（18px）と番号（20px）の分を足し、名札の最大の幅（CSS の max-width）で切る
 */
export function estimateLabelWidth(
  name: string,
  extras: { avatar: boolean; order: boolean; maxWidth: number; /** ほかに足す幅（「建築中」の札など） */ extra?: number },
): number {
  let text = 0
  for (const char of name) text += char.charCodeAt(0) < 0x80 ? 7 : 12
  const width = text + 24 + (extras.avatar ? 22 : 0) + (extras.order ? 24 : 0) + (extras.extra ?? 0)
  return Math.min(width, extras.maxWidth)
}

/** 拡大・縮小で大きさを変える区切り（拡大の度合い）と割合。どれも、スマホ（390×844）の見え方で仮に決めた値（Takana の依頼、2026-11-16） */
export const SIZE_CURVE = {
  /**
   * これより引いたら（日本全体が見えるくらい）、基準の farScale 倍。いちばん小さい建物の大きさになる。
   * 面積を 1/8（幅 1/4 の 2 倍の面積）にするため、幅は √2/4 倍（Takana の依頼、2026-11-21）
   */
  far: 5,
  farScale: Math.SQRT2 / 4,
  /** これより寄ったら（市街地のあたり）、基準の大きさ */
  near: 11,
  /** ここから、まわりが空いている建物を大きくし始める */
  growFrom: 12,
  /** いちばん寄ったとき（lib/mercator.ts の MAX_ZOOM）。まわりに建物がなければ、建物が描かれる幅を地図の幅の screenShare 倍にする */
  max: 16,
  screenShare: 0.4,
} as const

/** 0〜1 を、両端でゆるやかに変わる曲線でつなぐ（smoothstep） */
function smooth(from: number, to: number, value: number): number {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * 拡大の度合い zoom での、建物の基準の大きさ（px）。base はいちばん大きく見せる市街地のあたりの大きさ。
 * 引くと小さくする。倍率は対数でつなぐ（拡大の度合いは 1 上がると 2 倍なので、見た目の変わり方がそろう）
 */
export function zoomedSize(base: number, zoom: number): number {
  return base * SIZE_CURVE.farScale ** (1 - smooth(SIZE_CURVE.far, SIZE_CURVE.near, zoom))
}

/** 拡大の度合い zoom で、まわりに建物がないときの大きさ（px）。mapWidth は地図の幅（px） */
export function aloneSize(base: number, zoom: number, mapWidth: number): number {
  if (zoom <= SIZE_CURVE.growFrom) return zoomedSize(base, zoom)
  const largest = Math.max(base, (mapWidth * SIZE_CURVE.screenShare) / (BODY.right - BODY.left))
  return base * (largest / base) ** smooth(SIZE_CURVE.growFrom, SIZE_CURVE.max, zoom)
}

/**
 * 建物ごとの、描く大きさ（px。1px に丸める）。items は建物だけ（画面の上の位置）。
 * 基準の大きさ（zoomedSize）を下限に、まわりの建物とぶつからない大きさ（fitSize）まで、aloneSize を上限に大きくする。
 * 2 つの建物の大きさがどちらも fitSize 以下なので、大きくした建物どうしも重ならない
 */
export function buildingSizes(
  items: readonly { id: string; x: number; y: number }[],
  options: { base: number; zoom: number; mapWidth: number },
): Record<string, number> {
  const floor = zoomedSize(options.base, options.zoom)
  const top = aloneSize(options.base, options.zoom, options.mapWidth)
  const sizes: Record<string, number> = {}
  for (const item of items) {
    let room = top
    for (const other of items) if (other !== item) room = Math.min(room, fitSize(item, other))
    sizes[item.id] = Math.round(Math.max(floor, room))
  }
  return sizes
}

/**
 * 2 つの建物を、同じ大きさで並べたとき、ぶつからない最大の絵の幅（px）。
 * 横にずれていれば幅で、縦にずれていれば高さで離れればよい。描く大きさがこれより大きければ、ぶつかる
 */
export function fitSize(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const width = BODY.right - BODY.left
  const height = BODY.bottom - BODY.top
  return Math.max((Math.abs(a.x - b.x) - GAP) / width, (Math.abs(a.y - b.y) - GAP) / height)
}

/** 印の、模型やピンの形（場所を 0, 0 にした px）。ui/MapPin.module.css、ui/MapBuilding.module.css の寸法に合わせる */
function bodyOf(item: DeclutterItem, size: number, count: number): Rect[] {
  switch (item.kind) {
    case 'building': {
      const body = { left: BODY.left * size, right: BODY.right * size, top: BODY.top * size, bottom: BODY.bottom * size }
      if (count <= 1) return [body]
      const badge = badgeOffset(size)
      return [body, { left: badge.x, right: badge.x + BADGE, top: badge.y, bottom: badge.y + BADGE }]
    }
    case 'site':
      // 工事中の輪（幅 68）と、その上の金づち（高さ 40、上へ 44）
      return [{ left: -34, right: 34, top: -46, bottom: 17 }]
    case 'pin': {
      // 下の端が場所を指す（高さは幅の 1.3 倍）
      const width = item.pinWidth ?? 40
      return [{ left: -width / 2, right: width / 2, top: -width * 1.3, bottom: 0 }]
    }
  }
}

function labelOf(item: DeclutterItem, size: number): Rect {
  const top = item.kind === 'building' ? buildingLabelTop(size) : item.kind === 'site' ? 26 : 6
  const half = item.labelWidth / 2
  return { left: -half, right: half, top, bottom: top + LABEL_HEIGHT }
}

function moved(rect: Rect, item: DeclutterItem): Rect {
  return { left: rect.left + item.x, right: rect.right + item.x, top: rect.top + item.y, bottom: rect.bottom + item.y }
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0
}

const byId = (a: DeclutterItem, b: DeclutterItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * 印の大きさ、まとめ方、名札を出すかを決める。items の順番は結果に影響しない。
 */
export function declutter(items: readonly DeclutterItem[], options: DeclutterOptions): DeclutterResult {
  const { size, buildingLabels, selectedId = null, celebratingId = null } = options
  // 代表に選ぶ順：選んでいるもの、建ったばかりのもの、優先度の高いもの、id の順（拡大・縮小しても入れ替わらない）
  const rank = (item: DeclutterItem) =>
    item.id === selectedId ? Number.POSITIVE_INFINITY : item.id === celebratingId ? Number.MAX_VALUE : item.priority
  const ordered = [...items].sort((a, b) => rank(b) - rank(a) || byId(a, b))

  // ---- 深く重なる建物どうしをつなぎ、つながった組を 1 つにまとめる（少しの重なりはまとめない） ----
  // 組の代表は、組の中でいちばん前の順（選んでいる、優先度、id）。寄ると組は分かれるだけで、
  // 代表は分かれた先でもいちばん前のままなので、見えていた建物が隣と入れ替わって消えることはない
  const buildingList = ordered.filter((item) => item.kind === 'building')
  const parent = buildingList.map((_, index) => index)
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]]
    return index
  }
  for (let i = 0; i < buildingList.length; i += 1) {
    for (let j = i + 1; j < buildingList.length; j += 1) {
      if (fitSize(buildingList[i], buildingList[j]) >= size * MERGE_RATIO) continue
      const a = root(i)
      const b = root(j)
      // 前の順のほうを根にする（根が組の代表）
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
    }
  }
  const representatives: DeclutterItem[] = []
  const members = new Map<string, DeclutterItem[]>()
  const hidden = new Set<string>()
  buildingList.forEach((item, index) => {
    const top = root(index)
    if (top === index) {
      representatives.push(item)
      members.set(item.id, [])
    } else {
      members.get(buildingList[top].id)?.push(item)
      hidden.add(item.id)
    }
  })

  // ---- 名札：ほかの名札や模型とぶつからないものだけ。優先度の高いものから置く ----
  const visible = items.filter((item) => !hidden.has(item.id))
  const sizeOf = (item: DeclutterItem) => (item.kind === 'building' ? (options.sizes?.[item.id] ?? size) : 0)
  const countOf = (item: DeclutterItem) => 1 + (members.get(item.id)?.length ?? 0)
  const bodies = visible.map((item) => ({ item, rects: bodyOf(item, sizeOf(item), countOf(item)).map((rect) => moved(rect, item)) }))
  const placedLabels: Rect[] = []
  const labelHidden = new Set<string>()
  const labelOrder = [...visible].sort((a, b) => rank(b) - rank(a) || byId(a, b))
  for (const item of labelOrder) {
    // 引いているときは、どの建物の名札も出さない（選んでいる建物も）
    if (item.kind === 'building' && !buildingLabels) {
      labelHidden.add(item.id)
      continue
    }
    const label = moved(labelOf(item, sizeOf(item)), item)
    const padded = { left: label.left - GAP / 2, right: label.right + GAP / 2, top: label.top - GAP / 2, bottom: label.bottom + GAP / 2 }
    const blocked =
      placedLabels.some((other) => overlaps(padded, other)) ||
      bodies.some((body) => body.item !== item && body.rects.some((rect) => overlaps(label, rect)))
    if (blocked && item.id !== selectedId) {
      labelHidden.add(item.id)
      continue
    }
    placedLabels.push(padded)
  }

  const placements: Record<string, Placement> = {}
  for (const item of items) {
    const isHidden = hidden.has(item.id)
    placements[item.id] = {
      hidden: isHidden,
      count: isHidden ? 0 : countOf(item),
      labelHidden: isHidden || labelHidden.has(item.id),
    }
  }
  return { placements }
}

/** 確かめ用：見えている印の模型どうしの重なりの面積（px²）と、出している名札がほかとぶつかる面積の合計 */
export function overlapReport(items: readonly DeclutterItem[], result: DeclutterResult, size: number): { bodies: number; labels: number } {
  const visible = items.filter((item) => !result.placements[item.id].hidden)
  const area = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const shapes = visible.map((item) => {
    const placement = result.placements[item.id]
    return {
      item,
      bodies: bodyOf(item, item.kind === 'building' ? size : 0, placement.count).map((rect) => moved(rect, item)),
      label: placement.labelHidden ? null : moved(labelOf(item, item.kind === 'building' ? size : 0), item),
    }
  })
  let bodies = 0
  let labels = 0
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const a = shapes[i]
      const b = shapes[j]
      // 建物どうしの模型（ピンや工事中の印は、大きさを変えない対象なので数えない）
      if (a.item.kind === 'building' && b.item.kind === 'building') bodies += area(a.bodies[0], b.bodies[0])
      if (a.label && b.label) labels += area(a.label, b.label)
      if (a.label) for (const rect of b.bodies) labels += area(a.label, rect)
      if (b.label) for (const rect of a.bodies) labels += area(b.label, rect)
    }
  }
  return { bodies, labels }
}
