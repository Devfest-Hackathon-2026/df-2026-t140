// 出発地の駅の表を作る。国土数値情報「鉄道データ」（N02、国土交通省、CC BY 4.0 互換）の駅（*_Station.geojson）から、
// 駅名ごとに 1 つの位置（同じ名前の駅がいくつかあるときは、路線がいちばん多く集まる駅）を取り出し、
// 画面と Functions の両方に同じ表を書く（docs/records/credits.md）。
// 使い方：node scripts/build-stations.mjs <N02-xx_Station.geojson のパス>
// もとのデータはリポジトリに入れない（一時フォルダに置いて、このスクリプトに渡す）
import { readFileSync, writeFileSync } from 'node:fs'

const source = process.argv[2]
if (!source) {
  console.error('使い方：node scripts/build-stations.mjs <N02-xx_Station.geojson>')
  process.exit(1)
}
const { features } = JSON.parse(readFileSync(source, 'utf8'))

// 駅名 → グループ（300m 以内の同じ名前の駅のまとまり。N02_005g）→ 位置の点
const byName = new Map()
for (const { properties: p, geometry } of features) {
  const name = String(p.N02_005).normalize('NFKC').trim()
  if (!name) continue
  const groups = byName.get(name) ?? new Map()
  const group = groups.get(p.N02_005g) ?? { points: [], lines: 0 }
  const coords = geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat()
  group.points.push(...coords)
  group.lines += 1
  groups.set(p.N02_005g, group)
  byName.set(name, groups)
}

const rows = []
for (const [name, groups] of byName) {
  // 路線がいちばん多く集まるまとまり（同じ数なら最初のもの）
  const best = [...groups.values()].sort((a, b) => b.lines - a.lines)[0]
  const lng = best.points.reduce((sum, [x]) => sum + x, 0) / best.points.length
  const lat = best.points.reduce((sum, [, y]) => sum + y, 0) / best.points.length
  rows.push(`${name}\t${lat.toFixed(4)}\t${lng.toFixed(4)}`)
}
rows.sort()

const body = `// このファイルは scripts/build-stations.mjs が作る。手で直さない。
// 出典：「国土数値情報（鉄道データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html）を加工して作成。
// 駅名ごとに 1 つの位置（緯度、経度）。1 行に「駅名<TAB>緯度<TAB>経度」
export const STATION_ROWS = ${JSON.stringify(rows.join('\n'))}
`
for (const out of ['web/src/entities/trip/model/stationData.ts', 'functions/src/domain/stationData.ts']) writeFileSync(out, body)
console.log(`${rows.length} 駅を書きました`)
