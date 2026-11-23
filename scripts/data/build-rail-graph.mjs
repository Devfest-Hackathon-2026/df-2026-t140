// 国土数値情報「鉄道データ」（N02）から、しおりの電車・バスの見積もり（functions/src/domain/transit.ts）が使う
// 駅と線路のつながりを作り、functions/src/domain/railGraph.ts に書き出す。外部の API は呼ばない。
//
// 使い方：
//   1. https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html から N02-24_GML.zip を落として展開する
//   2. node scripts/data/build-rail-graph.mjs <展開したフォルダの UTF-8 フォルダ>
//      （N02-24_RailroadSection.geojson と N02-24_Station.geojson がある所）
//
// 作り方（実験は https://claude.ai/artifact/SMziadbQQhUX29sAeAP4jG の M4。docs/architecture/decisions.md）：
// - 線路の区間の両端を節点にし、同じ路線（事業者＋路線名）の区間を辺にする。長さは折れ線をたどった長さ
// - 駅は、同じ路線の、駅の真ん中にいちばん近い節点に結び付ける。駅のグループ（N02_005g）が同じ駅どうしは乗り換えられる
// - 路線は種類（新幹線、JR、私鉄、地下鉄、路面電車、ケーブルカー、モノレール）に分け、種類ごとの速さで乗る
//
// 出典：「国土数値情報（鉄道データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html）。
// 2020 年以降のデータはオープンデータ（CC BY 4.0）。docs/records/credits.md
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('使い方：node scripts/data/build-rail-graph.mjs <N02 の UTF-8 フォルダ>')
  process.exit(1)
}
const out = new URL('../../functions/src/domain/railGraph.ts', import.meta.url)

const sections = JSON.parse(readFileSync(join(dir, 'N02-24_RailroadSection.geojson'), 'utf8')).features
const stations = JSON.parse(readFileSync(join(dir, 'N02-24_Station.geojson'), 'utf8')).features

const R = 6371
const rad = (d) => (d * Math.PI) / 180
function km(a, b) {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const nodeKey = (pt) => `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`

// 地下鉄の事業者（N02 では普通鉄道と同じ区分なので、事業者で見分ける）
const SUBWAY_OPS = new Set(['東京地下鉄', '東京都', '大阪市高速電気軌道', '札幌市', '名古屋市', '横浜市', '京都市', '神戸市', '福岡市', '仙台市'])
/** 路線の種類。N02_001 は軌道の種類、N02_002 は事業者の種類（1 新幹線、2 JR） */
function lineClass(track, kind, operator, name) {
  if (kind === '1') return 'shinkansen'
  if (track === '13') return 'cable'
  if (track === '21') return SUBWAY_OPS.has(operator) ? 'subway' : 'tram'
  if (['14', '15', '16', '22', '23', '24', '25'].includes(track)) return 'monorail'
  if (kind === '2') return 'jr'
  if (SUBWAY_OPS.has(operator) || /\d+号線/.test(name)) return 'subway'
  return 'private'
}
const CLASSES = ['shinkansen', 'jr', 'private', 'subway', 'tram', 'cable', 'monorail']

const lineIndex = new Map()
const lines = []
const nodeIndex = new Map()
const edges = new Map() // `${line}|${u}|${v}` → meters
function lineOf(p) {
  const id = `${p.N02_004}|${p.N02_003}`
  if (!lineIndex.has(id)) {
    lineIndex.set(id, lines.length)
    lines.push([p.N02_004, p.N02_003, CLASSES.indexOf(lineClass(p.N02_001, p.N02_002, p.N02_004, p.N02_003))])
  }
  return lineIndex.get(id)
}
function nodeOf(pt) {
  const key = nodeKey(pt)
  if (!nodeIndex.has(key)) nodeIndex.set(key, { id: nodeIndex.size, pt: [Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5))] })
  return nodeIndex.get(key).id
}

const lineNodes = new Map() // line → Set<node>
for (const f of sections) {
  const line = lineOf(f.properties)
  const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]
  for (const coords of parts) {
    let length = 0
    for (let i = 0; i + 1 < coords.length; i += 1) length += km(coords[i], coords[i + 1])
    const u = nodeOf(coords[0])
    const v = nodeOf(coords[coords.length - 1])
    if (u === v) continue
    const key = `${line}|${Math.min(u, v)}|${Math.max(u, v)}`
    const meters = Math.round(length * 1000)
    if (!edges.has(key) || meters < edges.get(key)) edges.set(key, meters)
    if (!lineNodes.has(line)) lineNodes.set(line, new Set())
    lineNodes.get(line).add(u).add(v)
  }
}
const nodePt = []
for (const { id, pt } of nodeIndex.values()) nodePt[id] = pt

// 駅：同じ路線の節点のうち、駅の真ん中にいちばん近いもの
const groupIndex = new Map()
const stationRows = []
for (const f of stations) {
  const p = f.properties
  const line = lineIndex.get(`${p.N02_004}|${p.N02_003}`)
  if (line === undefined || !lineNodes.has(line)) continue
  const coords = f.geometry.coordinates
  const mid = coords.length > 2 ? coords[Math.floor(coords.length / 2)] : [(coords[0][0] + coords.at(-1)[0]) / 2, (coords[0][1] + coords.at(-1)[1]) / 2]
  let best = -1
  let bestKm = Infinity
  for (const node of lineNodes.get(line)) {
    const d = km(mid, nodePt[node])
    if (d < bestKm) { bestKm = d; best = node }
  }
  if (!groupIndex.has(p.N02_005g)) groupIndex.set(p.N02_005g, groupIndex.size)
  stationRows.push([groupIndex.get(p.N02_005g), line, best, Math.round(mid[1] * 1e5), Math.round(mid[0] * 1e5)])
}

const edgeRows = [...edges.entries()].map(([key, meters]) => [...key.split('|').map(Number), meters])
const b64 = (rows) => Buffer.from(new Int32Array(rows.flat()).buffer).toString('base64')

const body = `// このファイルは scripts/data/build-rail-graph.mjs が作る。手で直さない。
// 駅と線路のつながり（domain/transit.ts が使う）。
// 出典：「国土数値情報（鉄道データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html）をもとに加工して作成。
// オープンデータ（CC BY 4.0）。docs/records/credits.md
//
// 路線は [事業者, 路線名, 種類]。種類は RAIL_CLASSES の番号。
// 線路（EDGES）は Int32 を 4 つずつ [路線, 節点, 節点, 長さ（m）]。駅（STATIONS）は 5 つずつ [グループ, 路線, 節点, 緯度×1e5, 経度×1e5]。
// どちらもリトルエンディアンの Int32Array を base64 にしたもの。

export const RAIL_CLASSES = ${JSON.stringify(CLASSES)} as const
export const RAIL_LINES: readonly (readonly [string, string, number])[] = ${JSON.stringify(lines)}
export const RAIL_NODE_COUNT = ${nodePt.length}
export const RAIL_EDGES = '${b64(edgeRows)}'
export const RAIL_STATIONS = '${b64(stationRows)}'
`
writeFileSync(out, body)
console.log(`路線 ${lines.length}、線路 ${edgeRows.length}、節点 ${nodePt.length}、駅 ${stationRows.length}（グループ ${groupIndex.size}）、${(body.length / 1024).toFixed(0)} KB`)
