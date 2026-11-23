// しおりの電車・バスの見積もり（functions/src/domain/transit.ts）と、旅の移動手段を、Emulator なしで確かめる。
// scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { transitMinutes, transitRawMinutes, railMinutes } = require('../functions/lib/domain/transit.js')
const { buildPlan, estimateMinutes, moveMinutes, distanceKm, STYLE_TIMINGS } = require('../functions/lib/domain/routePlan.js')
const { travelModeOf, isTravelMode } = require('../functions/lib/domain/travelMode.js')
const { tripOrigin } = require('../functions/lib/domain/tripOrigin.js')
const { routeWithMode } = require('../functions/lib/features/change-travel-mode/logic.js')
const { shioriTravel } = require('../functions/lib/features/shiori-travel/usecase.js')

// 実験（https://claude.ai/artifact/SMziadbQQhUX29sAeAP4jG）の区間の一部。正解は公式の時刻表・アクセス案内から組み立てた door-to-door の分
const LEGS = [
  { name: '浅草寺→東京スカイツリー', from: [35.71477, 139.79665], to: [35.71005, 139.81071], truth: 16 },
  { name: '新宿御苑→東京ディズニーランド', from: [35.68507, 139.70955], to: [35.63266, 139.88142], truth: 56 },
  { name: '京都駅→伏見稲荷大社', from: [34.98546, 135.75776], to: [34.96694, 135.77306], truth: 10 },
  { name: '三ノ宮駅→姫路城', from: [34.69484, 135.19494], to: [34.83938, 134.6941], truth: 62 },
  { name: '別府駅→由布院駅', from: [33.27954, 131.50026], to: [33.26262, 131.35509], truth: 56 },
  { name: '那覇空港→首里城公園', from: [26.19583, 127.64583], to: [26.21814, 127.71689], truth: 47 },
]
const at = ([lat, lng]) => ({ lat, lng })

test('電車・バス：実験の 35 区間で、平均の誤差が実験の M4 と同じ（7.2 分）で、34 区間が 30 分以内', () => {
  const { legs } = JSON.parse(readFileSync(new URL('./data/transit-legs.json', import.meta.url), 'utf8'))
  const local = legs.filter((leg) => !leg.longDistance)
  assert.equal(local.length, 35)
  const errors = local.map((leg) => transitRawMinutes(at(leg.fromLatLng), at(leg.toLatLng)) - leg.truthMinutes)
  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length
  assert.ok(Math.abs(mae - 7.2) < 0.1, `平均の誤差 ${mae.toFixed(2)} 分`)
  assert.equal(errors.filter((value) => Math.abs(value) <= 30).length, 34)
})

test('電車・バス：実験の区間で、実際との差が 30 分以内', () => {
  for (const leg of LEGS) {
    const minutes = transitRawMinutes(at(leg.from), at(leg.to))
    assert.ok(Math.abs(minutes - leg.truth) <= 30, `${leg.name}：見積もり ${minutes.toFixed(1)} 分、正解 ${leg.truth} 分`)
  }
})

test('電車・バス：新幹線の区間は、車の直線の式より大幅に短く見積もる', () => {
  const tokyo = { lat: 35.68083, lng: 139.76694 }
  const kyoto = { lat: 34.98546, lng: 135.75776 }
  const minutes = transitMinutes(tokyo, kyoto)
  assert.ok(minutes >= 120 && minutes <= 200, `東京駅→京都駅：${minutes} 分`)
  assert.ok(minutes < moveMinutes(distanceKm(tokyo, kyoto)))
})

test('電車・バス：駅から遠い観光地は、近くの駅までバスで行く形で見積もる', () => {
  const omiya = { lat: 35.9064, lng: 139.6239 }
  const sakyu = { lat: 35.5409, lng: 134.229 }
  const rail = railMinutes(omiya, sakyu)
  assert.ok(rail !== null, '鳥取砂丘まで線路でつながる')
  // 高速バスの式（およそ 800 分）ではなく、新幹線・特急と最後のバスで 6〜7 時間
  assert.ok(rail >= 300 && rail <= 450, `大宮→鳥取砂丘：${rail.toFixed(0)} 分`)
})

test('電車・バス：となりの場所は歩きの見積もり、5 分きざみに切り上げる', () => {
  const kenrokuen = { lat: 36.56214, lng: 136.6625 }
  const museum = { lat: 36.56083, lng: 136.65819 }
  const minutes = transitMinutes(kenrokuen, museum)
  assert.equal(minutes % 5, 0)
  assert.ok(minutes <= 15, `兼六園→21世紀美術館：${minutes} 分`)
})

test('移動手段：前からの旅は車、決まった値以外は受け付けない', () => {
  assert.equal(travelModeOf({}), 'car')
  assert.equal(travelModeOf({ travelMode: 'transit' }), 'transit')
  assert.equal(travelModeOf({ travelMode: 'plane' }), 'plane')
  assert.equal(travelModeOf({ travelMode: 'ship' }), 'car')
  assert.equal(isTravelMode('ship'), false)
  assert.equal(isTravelMode('car'), true)
  assert.equal(isTravelMode('plane'), true)
  assert.equal(tripOrigin({ origin: '東京駅' }).travelMode, 'car')
  assert.equal(tripOrigin({ origin: '東京駅', travelMode: 'transit' }).travelMode, 'transit')
})

test('移動手段：しおりの移動時間は、旅の移動手段の見積もりで出す', () => {
  const tokyo = { lat: 35.68124, lng: 139.76712 }
  const places = [
    { id: 'kyoto', name: '京都駅', location: { lat: 34.98539, lng: 135.75879 }, uid: 'u' },
    { id: 'inari', name: '伏見稲荷大社', location: { lat: 34.96714, lng: 135.77267 }, uid: 'u' },
  ]
  const car = buildPlan(places, { name: '東京駅', location: tokyo }, 1, STYLE_TIMINGS.shortest)
  const transit = buildPlan(places, { name: '東京駅', location: tokyo, travelMode: 'transit' }, 1, STYLE_TIMINGS.shortest)
  assert.equal(car.schedule[0].moveMinutesToNext, moveMinutes(distanceKm(tokyo, places[0].location)))
  assert.equal(transit.schedule[0].moveMinutesToNext, estimateMinutes(tokyo, places[0].location, 'transit'))
  assert.ok(transit.totalMoveMinutes < car.totalMoveMinutes)
  // Routes の表にある区間は、そちらを使う（車の旅で、しおりを開いたとき）
  const table = new Map([['@origin>kyoto', 999]])
  assert.equal(buildPlan(places, { name: '東京駅', location: tokyo }, 1, STYLE_TIMINGS.shortest, table).schedule[0].moveMinutesToNext, 999)
})

test('移動手段の選び直し：回る順番を保ち、時刻を計算し直す', () => {
  const route = { pinIds: ['inari', 'kyoto'], style: 'shortest', revision: 4 }
  const pins = [
    { id: 'kyoto', name: '京都駅', location: { lat: 34.98539, lng: 135.75879 }, uid: 'u' },
    { id: 'inari', name: '伏見稲荷大社', location: { lat: 34.96714, lng: 135.77267 }, uid: 'u' },
  ]
  const origin = { name: '東京駅', location: { lat: 35.68124, lng: 139.76712 } }
  const car = routeWithMode(route, pins, { ...origin, travelMode: 'car' }, 1)
  const transit = routeWithMode(route, pins, { ...origin, travelMode: 'transit' }, 1)
  assert.deepEqual(transit.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId), ['inari', 'kyoto'])
  assert.equal(transit.revision, 5)
  assert.notEqual(transit.totalMoveMinutes, car.totalMoveMinutes)
})

test('移動手段：電車・バスの旅では、しおりを開いても車の Routes を呼ばない（合言葉の確かめより先に断る）', async () => {
  const calls = []
  const doc = (data) => ({ get: async () => ({ exists: Boolean(data), data: () => data }) })
  const route = { pinIds: ['a'], style: 'shortest', revision: 0, schedule: [], totalMoveMinutes: 0 }
  const db = (travelMode) => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ origin: '東京駅', startDate: '2026-11-21', endDate: null, travelMode }) }),
        collection: (name) => ({ doc: () => doc(name === 'members' ? {} : route), where: () => ({ get: async () => ({ docs: [] }) }) }),
      }),
    }),
  })
  const routesApi = {
    sampleMode: () => (calls.push('sampleMode'), true),
    enabled: () => (calls.push('enabled'), true),
    legs: async () => (calls.push('legs'), null),
  }
  const aiGate = { isOpenToAll: async () => (calls.push('gate'), true), isUnlocked: async () => true }
  const input = { tripId: 't', routeId: 'shiori', uid: 'u1' }
  assert.deepEqual(await shioriTravel({ db: db('transit'), aiGate, routesApi }, input), { status: 'estimate', reason: 'transit' })
  assert.deepEqual(calls, [])
  // 車の旅では、今までどおり Routes の側へ進む（ここでは開発環境の見本）
  const car = await shioriTravel({ db: db('car'), aiGate, routesApi }, input)
  assert.equal(car.status, 'routes')
  assert.ok(calls.includes('sampleMode'))
})

// ---- 区間ごとの手段（しおりの移動の行。features/change-leg-mode） ----
const { routeWithLegMode } = require('../functions/lib/features/change-leg-mode/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')

const KYOTO = [
  { id: 'kyoto', name: '京都駅', location: { lat: 34.98546, lng: 135.75776 }, uid: 'u' },
  { id: 'inari', name: '伏見稲荷大社', location: { lat: 34.96694, lng: 135.77306 }, uid: 'u' },
  { id: 'kinkaku', name: '金閣寺', location: { lat: 35.03937, lng: 135.72924 }, uid: 'u' },
]
const TOKYO = { name: '東京駅', location: { lat: 35.68083, lng: 139.76694 }, travelMode: 'transit' }

test('区間ごとの手段：選んだ区間だけその手段で計算し、ほかの区間は旅全体の手段のまま', () => {
  const base = buildPlan(KYOTO, TOKYO, 1, STYLE_TIMINGS.shortest)
  const walk = buildPlan(KYOTO, TOKYO, 1, STYLE_TIMINGS.shortest, undefined, { 'kyoto>inari': 'walk' })
  const row = (plan, id) => plan.schedule.find((stop) => stop.pinId === id)
  assert.equal(row(walk, 'kyoto').moveMinutesToNext, estimateMinutes(KYOTO[0].location, KYOTO[1].location, 'walk'))
  assert.ok(row(walk, 'kyoto').moveMinutesToNext > row(base, 'kyoto').moveMinutesToNext, '徒歩は電車より長い')
  assert.equal(walk.schedule[0].moveMinutesToNext, base.schedule[0].moveMinutesToNext, '出発地からの区間は旅全体の手段のまま')
  assert.deepEqual(walk.legModes, { 'kyoto>inari': 'walk' })
  // legModes を渡さなければ、結果に legModes を入れない（保存してある値を消さない）
  assert.equal('legModes' in base, false)
})

test('区間ごとの手段：Routes の表（車の時間）は、車の区間にだけ使う', () => {
  const table = new Map([['kyoto>inari', 999], ['inari>kinkaku', 888]])
  const car = { ...TOKYO, travelMode: 'car' }
  const plan = buildPlan(KYOTO, car, 1, STYLE_TIMINGS.shortest, table, { 'kyoto>inari': 'transit' })
  const row = (id) => plan.schedule.find((stop) => stop.pinId === id)
  assert.notEqual(row('kyoto').moveMinutesToNext, 999)
  assert.equal(row('inari').moveMinutesToNext, 888)
})

test('区間ごとの手段：選び直し、外し、今のしおりにない区間は断る', () => {
  const route = { style: 'shortest', revision: 2, legModes: { 'inari>kinkaku': 'car' } }
  const set = routeWithLegMode(route, KYOTO, TOKYO, 1, 'kyoto', 'inari', 'walk')
  assert.deepEqual(set.legModes, { 'inari>kinkaku': 'car', 'kyoto>inari': 'walk' })
  assert.equal(set.revision, 3)
  const cleared = routeWithLegMode({ ...route, legModes: set.legModes }, KYOTO, TOKYO, 1, 'kyoto', 'inari', null)
  assert.deepEqual(cleared.legModes, { 'inari>kinkaku': 'car' })
  assert.equal(routeWithLegMode(route, KYOTO, TOKYO, 1, '@origin', 'kyoto', 'car').legModes['@origin>kyoto'], 'car')
  // 隣り合っていない 2 つ、逆向きは今のしおりの区間ではない
  assert.equal(routeWithLegMode(route, KYOTO, TOKYO, 1, 'kyoto', 'kinkaku', 'walk'), 'stale')
  assert.equal(routeWithLegMode(route, KYOTO, TOKYO, 1, 'inari', 'kyoto', 'walk'), 'stale')
})

test('区間ごとの手段：順番を入れ替えて区間がなくなったら、その区間の選択を外す', () => {
  const route = { style: 'shortest', revision: 0, pinIds: ['kyoto', 'inari', 'kinkaku'], legModes: { 'kyoto>inari': 'walk', 'inari>kinkaku': 'car' } }
  const swapped = moveStop(route, KYOTO, TOKYO, 1, 'kyoto', 'inari')
  assert.deepEqual(swapped.pinIds, ['inari', 'kyoto', 'kinkaku'])
  // inari>kyoto、kyoto>kinkaku になり、前の区間はどちらも残らない
  assert.deepEqual(swapped.legModes, {})
})

test('区間ごとの手段：直線 10 km より遠い区間では徒歩を選べず、前に選んだ徒歩も使わない', () => {
  const route = { style: 'shortest', revision: 0, legModes: {} }
  // 東京駅 → 京都駅は 10 km よりずっと遠い。京都駅 → 伏見稲荷大社は 10 km より近い
  assert.equal(routeWithLegMode(route, KYOTO, TOKYO, 1, '@origin', 'kyoto', 'walk'), 'too-far')
  assert.notEqual(routeWithLegMode(route, KYOTO, TOKYO, 1, 'kyoto', 'inari', 'walk'), 'too-far')
  // 順番が変わって遠くなった区間に徒歩が残っていても、旅全体の手段で計算し、選択を外す
  const far = buildPlan(KYOTO, TOKYO, 1, STYLE_TIMINGS.shortest, undefined, { '@origin>kyoto': 'walk' })
  const base = buildPlan(KYOTO, TOKYO, 1, STYLE_TIMINGS.shortest)
  assert.equal(far.schedule[0].moveMinutesToNext, base.schedule[0].moveMinutesToNext)
  assert.deepEqual(far.legModes, {})
})

test('区間ごとの手段：旅全体の手段を切り替えると、同じ手段になった区間の選択は外し、違う区間の選択は残す', () => {
  const pins = KYOTO.map((place) => ({ ...place }))
  const route = { pinIds: ['kyoto', 'inari', 'kinkaku'], style: 'shortest', revision: 0, legModes: { 'kyoto>inari': 'car', 'inari>kinkaku': 'walk' } }
  const changed = routeWithMode(route, pins, { ...TOKYO, travelMode: 'car' }, 1)
  assert.deepEqual(changed.legModes, { 'inari>kinkaku': 'walk' })
})
