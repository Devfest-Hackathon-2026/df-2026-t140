// 地図を引いたときの建物のまとめ方と名札（web/src/widgets/trip-map/lib/declutter.ts）の確かめ。
// 実在の場所の緯度経度を、Google Maps と同じメルカトル図法で画面の上の位置にして使う。
// node --test scripts/map-declutter.test.mjs（Node 24 は .ts の型を外して読める）
import assert from 'node:assert/strict'
import test from 'node:test'
import { declutter, estimateLabelWidth, fitSize, MERGE_RATIO, overlapReport } from '../web/src/widgets/trip-map/lib/declutter.ts'

// 建物の大きさ（いつも同じ）。みんなの地図は 140 × 0.81 = 113px、しおりの画面は 110 × 0.81 = 89px（ui/TripMap.tsx）
const SIZES = [89, 113]
/** 建物の名札を出す拡大の度合い（model/useDeclutter.ts の BUILDING_LABEL_MIN_ZOOM と同じ） */
const LABEL_ZOOM = 13
const options = (size, zoom, extra = {}) => ({ size, buildingLabels: zoom >= LABEL_ZOOM, ...extra })

/** 緯度経度 → 拡大の度合い zoom での画面の上の位置（px） */
function pixel(lat, lng, zoom) {
  const sin = Math.sin((lat * Math.PI) / 180)
  const scale = 256 * 2 ** zoom
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale }
}

function item(id, name, lat, lng, kind, zoom) {
  // 本番（model/useDeclutter.ts）と同じ見込み：顔あり、工事中は「建築中」の札、建物の 1 つは番号付き
  const labelWidth = estimateLabelWidth(name, {
    avatar: true,
    order: kind === 'building' && id.length % 2 === 0,
    maxWidth: kind === 'pin' ? 170 : 190,
    extra: kind === 'site' ? 52 : 0,
  })
  const priority = kind === 'building' ? 3 : kind === 'site' ? 2 : 1
  return { id, kind, labelWidth, priority, ...pixel(lat, lng, zoom) }
}

// 東京の近い 6 か所（建物 4、工事中 1、候補 1）
const TOKYO = [
  ['sensoji', '浅草寺', 35.7148, 139.7967, 'building'],
  ['skytree', '東京スカイツリー', 35.7101, 139.8107, 'building'],
  ['ueno', '上野恩賜公園', 35.7156, 139.7745, 'building'],
  ['akiba', '秋葉原電気街', 35.6984, 139.7731, 'site'],
  ['ryogoku', '両国国技館', 35.6969, 139.7932, 'building'],
  ['tokyo', '東京駅', 35.6812, 139.7671, 'pin'],
]

// 信州の 8 か所（複数人の台本の場所と、その近く）
const SHINSHU = [
  ['hakkotsu', '白骨温泉', 36.153, 137.63, 'building'],
  ['kamikochi', '上高地', 36.249, 137.638, 'building'],
  ['matsumoto', '松本城', 36.239, 137.969, 'building'],
  ['hakuba', '白馬八方尾根スキー場', 36.702, 137.832, 'building'],
  ['togakushi', '戸隠そば', 36.741, 138.085, 'building'],
  ['zenkoji', '善光寺', 36.662, 138.188, 'pin'],
  ['bessho', '別所温泉', 36.348, 138.156, 'pin'],
  ['obasute', '姨捨の夜景', 36.51, 138.096, 'pin'],
]

const at = (places, zoom) => places.map(([id, name, lat, lng, kind]) => item(id, name, lat, lng, kind, zoom))
const ZOOMS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
const SETS = [
  ['東京', TOKYO],
  ['信州', SHINSHU],
]
const buildingsOf = (items) => items.filter((entry) => entry.kind === 'building')

test('どの拡大でも、出している建物どうしは深く重ならず、出している名札はほかの名札や印と重ならない（数字を出す）', () => {
  for (const [label, places] of SETS) {
    for (const size of SIZES) {
      for (const zoom of ZOOMS) {
        const items = at(places, zoom)
        const result = declutter(items, options(size, zoom))
        const report = overlapReport(items, result, size)
        const shown = buildingsOf(items).filter((entry) => !result.placements[entry.id].hidden)
        const labels = items.filter((entry) => !result.placements[entry.id].labelHidden).length
        if (size === 126) {
          console.log(
            `${label} zoom ${zoom}（${size}px）: 建物 ${shown.length}/${buildingsOf(items).length} を表示、` +
              `まとめ ${shown.map((entry) => result.placements[entry.id].count).filter((n) => n > 1).join(',') || 'なし'}、名札 ${labels}/${items.length}`,
          )
        }
        // 建物どうしは、外枠が触れる間隔の MERGE_RATIO 倍までは近づいてよい（少しの重なりは許す）
        for (const a of shown) for (const b of shown) if (a !== b) assert.ok(fitSize(a, b) >= size * MERGE_RATIO, `${label} zoom ${zoom}（${size}px）：模型が深く重なった`)
        assert.equal(report.labels, 0, `${label} zoom ${zoom}（${size}px）：名札が重なった`)
      }
    }
  }
})

test('引いたら、どの建物の名札も出さない（選んでいる建物も）。寄れば出す', () => {
  for (const [, places] of SETS) {
    for (const zoom of ZOOMS) {
      const items = at(places, zoom)
      const selectedId = buildingsOf(items)[0].id
      const result = declutter(items, options(126, zoom, { selectedId }))
      const shownLabels = buildingsOf(items).filter((entry) => !result.placements[entry.id].labelHidden)
      if (zoom < LABEL_ZOOM) assert.deepEqual(shownLabels, [], `zoom ${zoom} で建物の名札が出た`)
    }
  }
  // zoom 16 なら、東京の建物は離れていて、名札が全部出る
  const items = at(TOKYO, 16)
  const result = declutter(items, options(126, 16))
  for (const entry of buildingsOf(items)) assert.deepEqual(result.placements[entry.id], { hidden: false, count: 1, labelHidden: false })
})

test('まとめるのは、深く重なるときだけ。数の合計は建物の数と合う', () => {
  for (const [, places] of SETS) {
    for (const size of SIZES) {
      for (const zoom of ZOOMS) {
        const items = at(places, zoom)
        const result = declutter(items, options(size, zoom))
        const buildings = buildingsOf(items)
        const shown = buildings.filter((entry) => !result.placements[entry.id].hidden)
        const total = shown.reduce((sum, entry) => sum + result.placements[entry.id].count, 0)
        assert.equal(total, buildings.length)
        // まとめられた建物は、どれかの建物と深く重なる
        for (const entry of buildings.filter((b) => result.placements[b.id].hidden)) {
          assert.ok(buildings.some((other) => other !== entry && fitSize(entry, other) < size * MERGE_RATIO), `${entry.id} はまとめなくてよかった`)
        }
      }
    }
  }
})

test('外枠の半分より浅い重なり（4 割）ならまとめず、深く重なれば 1 つを出して右上に 2 を出す', () => {
  // 外枠の 4 割ほどの重なり（間隔が外枠の幅の 0.6 倍）なら、両方出す
  const touching = [
    { id: 'a', kind: 'building', labelWidth: 80, priority: 3, x: 500, y: 500 },
    { id: 'b', kind: 'building', labelWidth: 80, priority: 3, x: 500 + 126 * 0.76 * 0.6 + 4, y: 500 },
  ]
  const apart = declutter(touching, options(126, 12))
  assert.equal(apart.placements.a.hidden, false)
  assert.equal(apart.placements.b.hidden, false)

  const twin = [
    { id: 'a', kind: 'building', labelWidth: 80, priority: 3, x: 500, y: 500 },
    { id: 'b', kind: 'building', labelWidth: 80, priority: 3, x: 530, y: 502 },
  ]
  const result = declutter(twin, options(126, 16))
  assert.deepEqual(result.placements.a, { hidden: false, count: 2, labelHidden: false })
  assert.equal(result.placements.b.hidden, true)
})

test('選んでいる建物がまとまりの中にあれば、それを代表にする', () => {
  const items = at(TOKYO, 11)
  const plain = declutter(items, options(126, 11))
  const hiddenId = Object.keys(plain.placements).find((id) => plain.placements[id].hidden)
  assert.ok(hiddenId, '前提：zoom 11 なら東京の建物はまとまる')
  const selected = declutter(items, options(126, 11, { selectedId: hiddenId }))
  assert.equal(selected.placements[hiddenId].hidden, false)
  assert.ok(selected.placements[hiddenId].count > 1)
})

test('建ったばかりの建物は、まとまりの中でも代表になる。選んでいる建物があれば、そちらが先', () => {
  const items = at(TOKYO, 11)
  const plain = declutter(items, options(113, 11))
  const hidden = Object.keys(plain.placements).filter((id) => plain.placements[id].hidden)
  assert.ok(hidden.length >= 2, '前提：zoom 11 なら東京の建物はまとまる')
  const celebrated = declutter(items, options(113, 11, { celebratingId: hidden[0] }))
  assert.equal(celebrated.placements[hidden[0]].hidden, false)
  assert.ok(celebrated.placements[hidden[0]].count > 1)
  // 同じまとまりに選んでいる建物があれば、選んでいるほうを代表にする
  const both = declutter(items, options(113, 11, { celebratingId: hidden[0], selectedId: hidden[1] }))
  assert.equal(both.placements[hidden[1]].hidden, false)
})

test('寄るほど、まとまりは増えず、見えていた建物は消えない', () => {
  for (const [, places] of SETS) {
    for (const size of SIZES) {
      let previous = null
      for (let zoom = 5; zoom <= 16; zoom += 0.25) {
        const items = at(places, zoom)
        const result = declutter(items, options(size, zoom))
        if (previous) {
          for (const entry of buildingsOf(items)) {
            if (!previous.placements[entry.id].hidden) assert.equal(result.placements[entry.id].hidden, false, `${entry.id} が寄ったのに隠れた（zoom ${zoom}）`)
          }
        }
        previous = result
      }
    }
  }
})

test('3 棟が一列に並んでも、寄ったときに見えていた建物が隣と入れ替わって消えない', () => {
  // その大きさでぎりぎりぶつかる、ふぞろいな間隔で横に 3 棟。少しずつ寄せる
  const size = 126
  const xs = [0, 0.95 * size * MERGE_RATIO * 0.76, 1.75 * size * MERGE_RATIO * 0.76]
  for (let scale = 0.9; scale <= 1.6; scale += 0.01) {
    const row = ['p', 'q', 'r'].map((id, index) => ({ id, kind: 'building', labelWidth: 60, priority: 3, x: xs[index] * scale, y: 0 }))
    const near = row.map((entry) => ({ ...entry, x: entry.x * 1.05 }))
    const before = declutter(row, options(size, 16))
    const after = declutter(near, options(size, 16))
    for (const id of ['p', 'q', 'r']) {
      if (!before.placements[id].hidden) assert.equal(after.placements[id].hidden, false, `${id} が寄ったのに隠れた（${scale.toFixed(2)}）`)
    }
  }
})

test('同じ入力なら同じ結果になり、並び順にもよらない', () => {
  const items = at(SHINSHU, 9)
  assert.deepEqual(declutter(items, options(126, 9)), declutter([...items].reverse(), options(126, 9)))
})

test('名札の幅の見込みは、最大の幅で止まる', () => {
  assert.equal(estimateLabelWidth('東京駅', { avatar: false, order: false, maxWidth: 190 }), 36 + 24)
  assert.equal(estimateLabelWidth('とても長い名前の場所がここに入ります本当に長い', { avatar: true, order: true, maxWidth: 190 }), 190)
})
