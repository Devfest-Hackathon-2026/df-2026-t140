// 電車・バスの移動時間の見積もり（純粋。I/O なし）。時刻表も外部の API も使わない。
// 国土数値情報の駅と線路のつながり（domain/railGraph.ts）で乗り換えを探し、バスの式・歩きと比べて速いほうを取る。
// 実験の M4（https://claude.ai/artifact/SMziadbQQhUX29sAeAP4jG、docs/architecture/decisions.md）をそのまま移したもの。
// 全国 35 区間で、平均の誤差は 7.2 分、実際との差が 30 分以内の区間は 34（係数は全区間で合わせた値。scripts/data/transit-legs.json）。
// 山の乗り物、観光地の市バスの乗り継ぎ、特急・高速バスは外れやすい。画面では「目安」と書く
import type { LatLng } from './pin'
import type * as RailGraphData from './railGraph'

/**
 * 駅と線路のデータ（約 730 KB）は、はじめて電車・バスを見積もるときに読む。routePlan を使うすべての Function が
 * 起動のたびに読まないように、一番上では import しない（型だけを読む）
 */
function railData(): typeof RailGraphData {
  return require('./railGraph') as typeof RailGraphData
}

/** 見積もりの係数。実験で合わせた値（fit_all） */
export const TRANSIT_PARAMS = {
  /** 歩きの道のりは、直線距離のこの倍 */
  walkDetour: 1.3,
  walkKmh: 4.5,
  /** この距離（km）までの駅に歩いて乗れる */
  accessKm: 2.5,
  /** 路線の種類ごとの速さに掛ける倍率（新幹線には掛けない） */
  speedFactor: 1.5,
  /** 乗り換え 1 回の分 */
  transfer: 11,
  /** 同じ事業者どうしの乗り換え（直通に近い）の分 */
  transferSame: 3,
  /** 最初に乗るまでの分（駅の中の歩き、待ち） */
  board: 6,
  /** 路線バスの式：直線 ×1.3 ÷ 速さ ＋ 分 */
  busKmh: 18,
  busMinutes: 15,
  /** 高速バスの式 */
  highwayBusKmh: 50,
  highwayBusMinutes: 35,
} as const

/** 路線の種類ごとの速さ（km/h。駅に止まる時間を含めた目安） */
const CLASS_KMH: Record<(typeof RailGraphData.RAIL_CLASSES)[number], number> = {
  shinkansen: 200, jr: 50, private: 42, subway: 30, tram: 13, cable: 8, monorail: 28,
}

/** 乗り換えに歩ける、別のグループの駅どうしの距離（km） */
const TRANSFER_WALK_KM = 0.4

/** 2 点の直線距離（km）。routePlan の distanceKm と同じ式（循環 import を避けて、ここにも置く） */
function km(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

interface Station { group: number; line: number; node: number; at: LatLng }
interface Arc { to: number; minutes: number; kind: 'ride' | 'alight' | 'board' | 'walk'; line: number }

/**
 * 探索の状態。0 〜 S-1 は「路線 × 節点」（その路線に乗っている）。S 以上は「駅のグループ × 降りた路線の事業者」
 * （乗り換えの駅にいて、同じ事業者なら直通に近い）。事業者の番号 0 は「歩いて来た」
 */
interface Graph {
  stations: Station[]
  /** 路線 × 節点 の状態の番号 */
  stateOf: Map<string, number>
  rideArcs: Arc[][]
  /** グループから乗れる状態、グループから歩ける別のグループ */
  boardOf: Map<number, number[]>
  walkOf: Map<number, { group: number; km: number }[]>
  /** 状態 → 降りられる駅のグループ */
  alightOf: Map<number, number[]>
  lineOfState: number[]
  operatorOfLine: number[]
  operatorCount: number
  /** 駅を 0.05 度の升目に分けた索引（近くの駅を探すため） */
  cells: Map<string, number[]>
}

let cached: Graph | null = null

function decode(b64: string): Int32Array {
  const bytes = Buffer.from(b64, 'base64')
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

const CELL = 0.05
const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`

/** 駅と線路のつながりを読み込む（はじめて使うときに 1 回だけ） */
function graph(): Graph {
  if (cached) return cached
  const stateOf = new Map<string, number>()
  const lineOfState: number[] = []
  const rideArcs: Arc[][] = []
  const state = (line: number, node: number) => {
    const key = `${line}:${node}`
    let id = stateOf.get(key)
    if (id === undefined) {
      id = lineOfState.length
      stateOf.set(key, id)
      lineOfState.push(line)
      rideArcs.push([])
    }
    return id
  }
  const { RAIL_CLASSES, RAIL_EDGES, RAIL_LINES, RAIL_STATIONS } = railData()
  const edges = decode(RAIL_EDGES)
  for (let i = 0; i < edges.length; i += 4) {
    const [line, u, v, meters] = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]]
    const cls = RAIL_CLASSES[RAIL_LINES[line][2]]
    const kmh = CLASS_KMH[cls] * (cls === 'shinkansen' ? 1 : TRANSIT_PARAMS.speedFactor)
    const minutes = (meters / 1000 / kmh) * 60
    const a = state(line, u)
    const b = state(line, v)
    rideArcs[a].push({ to: b, minutes, kind: 'ride', line })
    rideArcs[b].push({ to: a, minutes, kind: 'ride', line })
  }

  const operators = new Map<string, number>()
  const operatorOfLine = RAIL_LINES.map(([operator]) => {
    if (!operators.has(operator)) operators.set(operator, operators.size + 1)
    return operators.get(operator) as number
  })

  const raw = decode(RAIL_STATIONS)
  const stations: Station[] = []
  const boardOf = new Map<number, number[]>()
  const alightOf = new Map<number, number[]>()
  const groupAt = new Map<number, LatLng>()
  const cells = new Map<string, number[]>()
  for (let i = 0; i < raw.length; i += 5) {
    const station = { group: raw[i], line: raw[i + 1], node: raw[i + 2], at: { lat: raw[i + 3] / 1e5, lng: raw[i + 4] / 1e5 } }
    const id = stations.length
    stations.push(station)
    const s = state(station.line, station.node)
    boardOf.set(station.group, [...(boardOf.get(station.group) ?? []), s])
    alightOf.set(s, [...(alightOf.get(s) ?? []), station.group])
    if (!groupAt.has(station.group)) groupAt.set(station.group, station.at)
    const key = cellKey(station.at.lat, station.at.lng)
    cells.set(key, [...(cells.get(key) ?? []), id])
  }

  // 別のグループでも、400 m 以内の駅は歩いて乗り換えられる
  const walkOf = new Map<number, { group: number; km: number }[]>()
  const groupCells = new Map<string, number[]>()
  for (const [group, at] of groupAt) {
    const key = cellKey(at.lat, at.lng)
    groupCells.set(key, [...(groupCells.get(key) ?? []), group])
  }
  for (const [group, at] of groupAt) {
    const [cy, cx] = [Math.floor(at.lat / CELL), Math.floor(at.lng / CELL)]
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const other of groupCells.get(`${cy + dy},${cx + dx}`) ?? []) {
          if (other === group) continue
          const d = km(at, groupAt.get(other) as LatLng)
          if (d <= TRANSFER_WALK_KM) walkOf.set(group, [...(walkOf.get(group) ?? []), { group: other, km: d }])
        }
      }
    }
  }
  cached = { stations, stateOf, rideArcs, boardOf, walkOf, alightOf, lineOfState, operatorOfLine, operatorCount: operators.size + 1, cells }
  return cached
}

const walkMinutes = (distance: number) => ((distance * TRANSIT_PARAMS.walkDetour) / TRANSIT_PARAMS.walkKmh) * 60
/** 路線バスと高速バスの式の速いほう */
const busMinutes = (distance: number) => Math.min(
  ((distance * 1.3) / TRANSIT_PARAMS.busKmh) * 60 + TRANSIT_PARAMS.busMinutes,
  ((distance * 1.3) / TRANSIT_PARAMS.highwayBusKmh) * 60 + TRANSIT_PARAMS.highwayBusMinutes,
)

/** at から radius km 以内の駅と、そこまでの直線距離（近い順） */
function nearStations(g: Graph, at: LatLng, radius: number): { station: Station; km: number }[] {
  const spanLat = Math.ceil(radius / 111 / CELL) + 1
  const spanLng = Math.ceil(radius / (111 * Math.cos((at.lat * Math.PI) / 180)) / CELL) + 1
  const [cy, cx] = [Math.floor(at.lat / CELL), Math.floor(at.lng / CELL)]
  const found: { station: Station; km: number }[] = []
  for (let dy = -spanLat; dy <= spanLat; dy += 1) {
    for (let dx = -spanLng; dx <= spanLng; dx += 1) {
      for (const id of g.cells.get(`${cy + dy},${cx + dx}`) ?? []) {
        const station = g.stations[id]
        const d = km(at, station.at)
        if (d <= radius) found.push({ station, km: d })
      }
    }
  }
  return found.sort((left, right) => left.km - right.km)
}

/** 駅まで歩けない（accessKm 以内に駅がない）とき、バスで行く駅を探す範囲（km）と、候補の数 */
const FEEDER_KM = 20
const FEEDER_STATIONS = 8

/**
 * 乗り降りする駅の候補と、その駅までの分。accessKm 以内に駅があれば歩き。なければ FEEDER_KM 以内の近い駅まで路線バス
 * （観光地の多くは駅から離れている。鳥取砂丘、白川郷など）
 */
function accessStations(g: Graph, at: LatLng): { station: Station; minutes: number }[] {
  const walkable = nearStations(g, at, TRANSIT_PARAMS.accessKm)
  if (walkable.length > 0) return walkable.map(({ station, km: d }) => ({ station, minutes: walkMinutes(d) }))
  return nearStations(g, at, FEEDER_KM).slice(0, FEEDER_STATIONS).map(({ station, km: d }) => ({ station, minutes: Math.min(walkMinutes(d), busMinutes(d)) }))
}

/** 小さい順に取り出す二分ヒープ */
class Heap {
  private items: [number, number][] = []
  get size() { return this.items.length }
  push(cost: number, state: number) {
    const items = this.items
    items.push([cost, state])
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent][0] <= items[i][0]) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }
  pop(): [number, number] {
    const items = this.items
    const top = items[0]
    const last = items.pop() as [number, number]
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l][0] < items[m][0]) m = l
        if (r < items.length && items[r][0] < items[m][0]) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i], items[m]]
        i = m
      }
    }
    return top
  }
}


/**
 * 線路で行ったときの分（駅まで・駅からの歩きかバス、乗る前の分を含む）。近くに駅がない、線路でつながらないときは null。
 * 乗る路線を「路線 × 節点」、乗り換えの駅を「グループ × 降りた事業者」として、最短の時間を探す（ダイクストラ法）
 */
export function railMinutes(from: LatLng, to: LatLng): number | null {
  const g = graph()
  const start = accessStations(g, from)
  const goal = accessStations(g, to)
  if (start.length === 0 || goal.length === 0) return null
  const S = g.lineOfState.length
  const hub = (group: number, operator: number) => S + group * g.operatorCount + operator
  const goalCost = new Map<number, number>()
  for (const { station, minutes } of goal) {
    const s = g.stateOf.get(`${station.line}:${station.node}`) as number
    goalCost.set(s, Math.min(goalCost.get(s) ?? Infinity, minutes))
  }
  const dist = new Map<number, number>()
  const heap = new Heap()
  for (const { station, minutes } of start) {
    const s = g.stateOf.get(`${station.line}:${station.node}`) as number
    const cost = minutes + TRANSIT_PARAMS.board
    if (cost < (dist.get(s) ?? Infinity)) {
      dist.set(s, cost)
      heap.push(cost, s)
    }
  }
  let best = Infinity
  const relax = (to: number, cost: number) => {
    if (cost < (dist.get(to) ?? Infinity)) {
      dist.set(to, cost)
      heap.push(cost, to)
    }
  }
  while (heap.size > 0) {
    const [cost, s] = heap.pop()
    if (cost > (dist.get(s) ?? Infinity) || cost >= best) continue
    if (s < S) {
      const end = goalCost.get(s)
      if (end !== undefined && cost + end < best) best = cost + end
      for (const arc of g.rideArcs[s]) relax(arc.to, cost + arc.minutes)
      const operator = g.operatorOfLine[g.lineOfState[s]]
      for (const group of g.alightOf.get(s) ?? []) relax(hub(group, operator), cost)
    } else {
      const group = Math.floor((s - S) / g.operatorCount)
      const arrivedBy = (s - S) % g.operatorCount
      for (const board of g.boardOf.get(group) ?? []) {
        const same = arrivedBy !== 0 && g.operatorOfLine[g.lineOfState[board]] === arrivedBy
        relax(board, cost + (same ? TRANSIT_PARAMS.transferSame : TRANSIT_PARAMS.transfer))
      }
      for (const { group: other, km: d } of g.walkOf.get(group) ?? []) relax(hub(other, 0), cost + walkMinutes(d))
    }
  }
  return Number.isFinite(best) ? best : null
}

/** 電車・バス・歩きのうち、いちばん速い見積もり（分。丸めない） */
export function transitRawMinutes(from: LatLng, to: LatLng): number {
  const d = km(from, to)
  return Math.min(railMinutes(from, to) ?? Infinity, busMinutes(d), walkMinutes(d))
}

/** しおりに書く徒歩の移動時間（分。5 分きざみに切り上げ）。電車・バスの見積もりと同じ歩きの式 */
export function walkOnlyMinutes(from: LatLng, to: LatLng): number {
  return Math.ceil(walkMinutes(km(from, to)) / 5) * 5
}

/** しおりに書く電車・バスの移動時間（分。5 分きざみに切り上げ。車の moveMinutes と同じきざみ） */
export function transitMinutes(from: LatLng, to: LatLng): number {
  return Math.ceil(transitRawMinutes(from, to) / 5) * 5
}
